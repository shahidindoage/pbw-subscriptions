import axios from "axios";
import { getShopifyToken } from "./shopifyTokenManager.js";
import prisma from "./prisma.js";
import { generateRegularInvoiceBuffer } from "./generateRegularInvoice.js";
import { uploadInvoiceToDropbox } from "./dropbox.js";

/**
 * Check if order is subscription-related
 */
function isSubscriptionOrder(order) {
  // Check note attributes
  if (order.note_attributes && Array.isArray(order.note_attributes)) {
    const hasSubscriptionId = order.note_attributes.some(
      attr => attr.name === "SubscriptionId" || attr.name === "subscription_id"
    );
    if (hasSubscriptionId) return true;
  }

  // Check order note
  if (order.note && typeof order.note === 'string') {
    if (order.note.toLowerCase().includes("subscription")) {
      return true;
    }
  }

  // Check tags
  if (order.tags && typeof order.tags === 'string') {
    if (order.tags.toLowerCase().includes("subscription")) {
      return true;
    }
  }

  return false;
}

/**
 * Fetch orders from Shopify and process regular orders
 */
export async function syncShopifyOrders({
  limit = 50,
  sinceId = null,
  createdAtMin = null,
  status = "any",
  fulfillmentStatus = "shipped" // ← Only fetch fulfilled orders by default
} = {}) {
  try {
    const accessToken = await getShopifyToken();
    const shopifyStore = process.env.SHOPIFY_STORE;

    console.log("🔄 Fetching fulfilled orders from Shopify...");

    // Build query parameters
    const params = {
      limit,
      status,
      fulfillment_status: fulfillmentStatus, // ← Add fulfillment status filter
     fields: "id,order_number,name,email,created_at,total_price,subtotal_price,total_tax,currency,financial_status,fulfillment_status,line_items,shipping_lines,total_shipping_price_set,total_discounts,current_total_discounts,discount_codes,total_line_items_price,shipping_address,billing_address,customer,note,note_attributes,tags"
    };

    if (sinceId) params.since_id = sinceId;
    if (createdAtMin) params.created_at_min = createdAtMin;

    const response = await axios.get(
      `https://${shopifyStore}/admin/api/2024-01/orders.json`,
      {
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
        params
      }
    );

    const orders = response.data.orders || [];
    console.log(`📦 Found ${orders.length} fulfilled orders`);
// ✅ Save orders JSON to file
// const folderPath = path.join(process.cwd(), "shopify-data");

// if (!fs.existsSync(folderPath)) {
//   fs.mkdirSync(folderPath, { recursive: true });
// }

// const filePath = path.join(folderPath, "orders.json");

// fs.writeFileSync(
//   filePath,
//   JSON.stringify(orders, null, 2),
//   "utf8"
// );

// console.log(`📁 Orders saved to ${filePath}`);
    let processed = 0;
    let skipped = 0;
    let errors = 0;

    for (const order of orders) {
      try {
        // Skip subscription orders
        if (isSubscriptionOrder(order)) {
          console.log(`⏭️  Order ${order.name} is subscription - skipping`);
          skipped++;
          continue;
        }

        // Check if already processed
        const existing = await prisma.regularOrder.findUnique({
          where: { shopifyOrderId: order.id.toString() }
        });

        if (existing) {
          console.log(`⏭️  Order ${order.name} already processed`);
          skipped++;
          continue;
        }

        // Process regular order
        await processRegularOrder(order);
        processed++;

      } catch (error) {
        console.error(`❌ Error processing order ${order.name}:`, error.message);
        errors++;
      }
    }

    console.log(`\n✅ Sync complete:`);
    console.log(`   Processed: ${processed}`);
    console.log(`   Skipped: ${skipped}`);
    console.log(`   Errors: ${errors}`);

    return { processed, skipped, errors, total: orders.length };

  } catch (error) {
    console.error("❌ Failed to sync Shopify orders:", error.response?.data || error.message);
    throw error;
  }
}

/**
 * Process a single regular order
 */
async function processRegularOrder(order) {
  console.log(`📝 Processing regular order: ${order.name}`);

  // Extract customer info
  const customerEmail = order.email || order.customer?.email || null;
  const customerName = order.customer?.first_name && order.customer?.last_name
    ? `${order.customer.first_name} ${order.customer.last_name}`
    : order.billing_address?.name || null;
  const customerPhone = order.phone || order.customer?.phone || 
    order.billing_address?.phone || null;

  // Save order to database
  const regularOrder = await prisma.regularOrder.create({
    data: {
      shopifyOrderId: order.id.toString(),
      orderNumber: order.order_number?.toString() || null,
      orderName: order.name || null,
      customerEmail,
      customerName,
      customerPhone,
      lineItems: order.line_items || [],
      totalPrice: order.total_price || "0",
      subtotalPrice: order.subtotal_price || order.total_price || "0",
      totalTax: order.total_tax || "0",
      totalDiscount: order.total_discounts || "0",
      shippingFee:  order.total_shipping_price_set.shop_money.amount || "0",
      currency: order.currency || "INR",
      financialStatus: order.financial_status || null,
      fulfillmentStatus: order.fulfillment_status || null,
      shippingAddress: order.shipping_address || null,
      billingAddress: order.billing_address || null,
      orderCreatedAt: new Date(order.created_at),
    }
  });

  console.log(`✅ Order saved to database: ${regularOrder.id}`);

  // Generate invoice
  const invoiceNumber = `INV-${order.order_number || order.id}`;
  
  try {
    const invoiceBuffer = await generateRegularInvoiceBuffer(
      regularOrder,
      invoiceNumber
    );

    // Upload to Dropbox
    const invoiceUrl = await uploadInvoiceToDropbox(
      invoiceBuffer,
      `regular-orders/${invoiceNumber}.pdf`
    );

    // Update order with invoice
    await prisma.regularOrder.update({
      where: { id: regularOrder.id },
      data: {
        invoiceUrl,
        invoiceNumber,
      }
    });

    console.log(`✅ Invoice generated: ${invoiceNumber}`);
  } catch (invoiceError) {
    console.error(`⚠️  Invoice generation failed for ${order.name}:`, invoiceError.message);
    // Order is still saved, just without invoice
  }

  return regularOrder;
}

/**
 * Sync recent fulfilled orders (last 7 days)
 */
export async function syncRecentOrders() {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  return await syncShopifyOrders({
    createdAtMin: sevenDaysAgo.toISOString(),
    limit: 250,
    fulfillmentStatus: "fulfilled" // ← Only fulfilled orders
  });
}

/**
 * Sync all fulfilled orders (use with caution - can be slow)
 */
export async function syncAllOrders() {
  console.log("⚠️  Syncing ALL fulfilled orders - this may take a while...");
  
  let hasMore = true;
  let sinceId = null;
  let totalProcessed = 0;

  while (hasMore) {
    const result = await syncShopifyOrders({
      limit: 250,
      sinceId,
      fulfillmentStatus: "fulfilled" // ← Only fulfilled orders
    });

    totalProcessed += result.processed;

    if (result.total < 250) {
      hasMore = false;
    } else {
      // Get the last order ID for pagination
      const response = await axios.get(
        `https://${process.env.SHOPIFY_STORE}/admin/api/2024-01/orders.json`,
        {
          headers: {
            "X-Shopify-Access-Token": await getShopifyToken(),
          },
          params: { limit: 1, order: "id asc", since_id: sinceId }
        }
      );
      
      if (response.data.orders.length > 0) {
        sinceId = response.data.orders[0].id;
      } else {
        hasMore = false;
      }
    }
  }

  console.log(`\n🎉 All orders synced! Total processed: ${totalProcessed}`);
  return totalProcessed;
}