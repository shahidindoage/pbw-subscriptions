import crypto from "crypto";
import prisma from "../utils/prisma.js";
import { generateRegularInvoiceBuffer } from "../utils/generateRegularInvoice.js";
import { uploadInvoiceToDropbox } from "../utils/dropbox.js";

/**
 * Verify Shopify webhook signature
 */
function verifyShopifyWebhook(body, hmacHeader) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  
  if (!secret) {
    console.error("⚠️ SHOPIFY_WEBHOOK_SECRET not set in .env");
    return false;
  }

  const hash = crypto
    .createHmac("sha256", secret)
    .update(body, "utf8")
    .digest("base64");

  return hash === hmacHeader;
}

/**
 * Check if order is subscription-related
 */
function isSubscriptionOrder(order) {
  // Check note attributes for subscription marker
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
 * Handle Shopify order creation webhook
 */
export async function handleShopifyOrderCreate(req, res) {
  try {
    // 1️⃣ Verify webhook signature
    const hmacHeader = req.headers["x-shopify-hmac-sha256"];
    const rawBody = req.rawBody || JSON.stringify(req.body);

    if (!verifyShopifyWebhook(rawBody, hmacHeader)) {
      console.error("❌ Invalid Shopify webhook signature");
      return res.status(401).json({ error: "Invalid signature" });
    }

    const order = req.body;
    console.log(`📦 Shopify Order Created: ${order.name || order.id}`);

    // 2️⃣ Check if it's a subscription order
    if (isSubscriptionOrder(order)) {
      console.log("⏭️ Subscription order detected - skipping invoice generation");
      return res.status(200).json({ 
        message: "Subscription order - handled by scheduler" 
      });
    }

    // 3️⃣ Check if already processed
    const existing = await prisma.regularOrder.findUnique({
      where: { shopifyOrderId: order.id.toString() }
    });

    if (existing) {
      console.log("⏭️ Order already processed");
      return res.status(200).json({ message: "Already processed" });
    }

    // 4️⃣ Extract customer info
    const customerEmail = order.email || order.customer?.email || null;
    const customerName = order.customer?.first_name && order.customer?.last_name
      ? `${order.customer.first_name} ${order.customer.last_name}`
      : order.billing_address?.name || null;
    const customerPhone = order.phone || order.customer?.phone || 
      order.billing_address?.phone || null;

    // 5️⃣ Save order to database
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
        currency: order.currency || "INR",
        financialStatus: order.financial_status || null,
        fulfillmentStatus: order.fulfillment_status || null,
        shippingAddress: order.shipping_address || null,
        billingAddress: order.billing_address || null,
        orderCreatedAt: new Date(order.created_at),
      }
    });

    console.log(`✅ Regular order saved: ${regularOrder.id}`);

    // 6️⃣ Generate invoice
    const invoiceNumber = `INV-${order.order_number || order.id}`;
    
    try {
      const invoiceBuffer = await generateRegularInvoiceBuffer(
        regularOrder,
        invoiceNumber
      );

      // 7️⃣ Upload to Dropbox
      const invoiceUrl = await uploadInvoiceToDropbox(
        invoiceBuffer,
        `regular-orders/${invoiceNumber}.pdf`
      );

      // 8️⃣ Update order with invoice URL
      await prisma.regularOrder.update({
        where: { id: regularOrder.id },
        data: {
          invoiceUrl,
          invoiceNumber,
        }
      });

      console.log(`✅ Invoice generated and uploaded: ${invoiceUrl}`);
    } catch (invoiceError) {
      console.error("❌ Invoice generation failed:", invoiceError);
      // Don't fail the whole webhook - order is still saved
    }

    res.status(200).json({ 
      message: "Order processed successfully",
      orderId: regularOrder.id 
    });

  } catch (error) {
    console.error("❌ Webhook processing error:", error);
    res.status(500).json({ 
      error: "Webhook processing failed",
      details: error.message 
    });
  }
}

/**
 * Handle Shopify order update webhook (optional)
 */
export async function handleShopifyOrderUpdate(req, res) {
  try {
    const hmacHeader = req.headers["x-shopify-hmac-sha256"];
    const rawBody = req.rawBody || JSON.stringify(req.body);

    if (!verifyShopifyWebhook(rawBody, hmacHeader)) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    const order = req.body;

    // Skip subscription orders
    if (isSubscriptionOrder(order)) {
      return res.status(200).json({ message: "Subscription order - skipping" });
    }

    // Update existing order
    const existing = await prisma.regularOrder.findUnique({
      where: { shopifyOrderId: order.id.toString() }
    });

    if (existing) {
      await prisma.regularOrder.update({
        where: { shopifyOrderId: order.id.toString() },
        data: {
          financialStatus: order.financial_status || existing.financialStatus,
          fulfillmentStatus: order.fulfillment_status || existing.fulfillmentStatus,
          totalPrice: order.total_price || existing.totalPrice,
          updatedAt: new Date(),
        }
      });
      console.log(`✅ Order updated: ${order.name}`);
    }

    res.status(200).json({ message: "Order updated" });

  } catch (error) {
    console.error("❌ Update webhook error:", error);
    res.status(500).json({ error: "Update failed" });
  }
}
