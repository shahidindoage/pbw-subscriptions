import prisma from "../utils/prisma.js";
import { createShopifyOrder } from "../utils/createShopifyOrder.js";
import { addDays, subHours, differenceInSeconds } from "date-fns";
import { sendEmail } from "../utils/email.js";
import { generateInvoiceBuffer } from "../utils/generateInvoice.js";
import { uploadInvoice } from "../utils/uploadInvoice.js";
import { uploadInvoiceToDropbox } from "../utils/dropbox.js";
// import { uploadInvoiceToShopify } from "../utils/shopifyUploadInvoice.js";

/**
 * Scheduler:
 * - Creates Shopify orders exactly 24 hours before nextShippingDate
 * - 48 hours for Monday shipping
 * - Moves nextShippingDate forward
 * - Auto-cancels subscription after last order
 * - Skips paused, canceled, expired subscriptions
 */
export async function runSubscriptionScheduler({ testMode = false } = {}) {
  // ⏱️ Use real time in production "2026-02-20T12:00:00+05:30"
  const now = new Date();

  console.log("🕒 Scheduler running at:", now.toISOString());

  // 1️⃣ Fetch active subscriptions
  const subscriptions = await prisma.subscription.findMany({
    where: { status: "active" },
    include: { customer: true },
  });

  if (!subscriptions.length) {
    console.log("No subscriptions to process.");
    return;
  }

  console.log(`Found ${subscriptions.length} subscriptions`);

  // 2️⃣ Prepare dayMap once (use everywhere)
const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// 3️⃣ Group by customer email → sequential per customer, parallel across customers
const customerMap = new Map();
for (const sub of subscriptions) {
  const email = sub.customer.email;
  if (!customerMap.has(email)) customerMap.set(email, []);
  customerMap.get(email).push(sub);
}

const customerGroups = [...customerMap.values()];
const BATCH_SIZE = 5;

for (let i = 0; i < customerGroups.length; i += BATCH_SIZE) {
  const batch = customerGroups.slice(i, i + BATCH_SIZE);

  console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} customer groups)`);

  await Promise.allSettled(
    batch.map(async (customerSubs) => {
      for (const sub of customerSubs) {
        try {
        // ⛔ Skip paused
        if (sub.pausedAt) {
          console.log(`⏸ Paused subscription ${sub.id}`);
          continue;
        }

        // ⛔ Skip expired (hard stop)
        if (sub.subscriptionEndDate && now >= sub.subscriptionEndDate) {
          await prisma.subscription.update({
            where: { id: sub.id },
            data: { status: "cancelled", nextShippingDate: null },
          });
          console.log(`🛑 Subscription ${sub.id} expired → auto-cancelled`);
          continue;
        }

        const shippingDate = sub.nextShippingDate;
        if (!shippingDate) continue;

        // Determine how many hours before to create order
        let hoursBefore = 24; // default
        if (shippingDate.getDay() === dayMap["Mon"]) {
          hoursBefore = 48; // Monday → 48h before
        }

        const orderCreateTime = subHours(shippingDate, hoursBefore);
        const diffSec = differenceInSeconds(now, orderCreateTime);

        // Create order only if within ±30 seconds of target
        if (diffSec < 0 || diffSec > 90) {
          console.log(
            `⏳ Not time yet for ${sub.id}. diffSec=${diffSec}`
          );
          continue;
        }

        // 🛑 Prevent duplicate orders
        const existingOrder = await prisma.shopifyOrder.findFirst({
          where: { subscriptionId: sub.id, shippingDate },
        });
        if (existingOrder) continue;

        // ===============================
        // 🛒 CREATE SHOPIFY ORDER
        // ===============================
        const addr = sub.address || {};
        const fullName = addr.name || sub.customer.name || "Customer";
        const nameParts = (fullName || "Customer User").trim().split(/\s+/);

        const firstName = nameParts[0] || "Customer";
        const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "User";
        const numericVariantId = sub.variantId?.toString().includes("gid://")
          ? sub.variantId.split("/").pop()
          : sub.variantId;

        const shopifyOrderData = {
          order: {
            line_items: [{
              variant_id: Number(numericVariantId),
              quantity: sub.quantity,
            }],
            customer: { first_name: firstName, last_name: lastName, email: sub.customer.email },
            financial_status: "paid",
            fulfillment_status: "unfulfilled",
            note: `Subscription order (${sub.product})`,
            note_attributes: [
              { name: "SubscriptionId", value: sub.id },
              { name: "ShippingDate", value: shippingDate.toISOString() },
              { name: "Frequency", value: sub.frequency },
            ],
            shipping_address: {
              first_name: firstName,
              last_name: lastName,
              address1: addr.line1 || "",
              address2: addr.line2 || "",
              city: addr.city || "",
              province: addr.state || "",
              province_code: addr.stateCode || "DL",
              zip: addr.pincode || "",
              country: "India",
              country_code: "IN",
              phone: addr.phone || sub.customer.contact || "9999999999",
            },
            billing_address: {
              first_name: firstName,
              last_name: lastName,
              address1: addr.line1 || "",
              address2: addr.line2 || "",
              city: addr.city || "",
              province: addr.state || "",
              province_code: addr.stateCode || "DL",
              zip: addr.pincode || "",
              country: "India",
              country_code: "IN",
              phone: addr.phone || sub.customer.contact || "9999999999",
            },
            send_receipt: false,
            send_fulfillment_receipt: false,
          },
        };

        const shopifyRes = await createShopifyOrder(shopifyOrderData);
        const shopifyOrderId = shopifyRes?.order?.id?.toString() || null;
        const shopifyOrder = shopifyRes.order;
        console.log(`✅ Shopify order ${shopifyOrderId} created for subscription ${sub.id}`);

        // ===============================
        // 🧾 GENERATE INVOICE
        // ===============================
        const invoiceNumber = `INV-${shopifyOrder.order_number}`;
        const invoiceBuffer = await generateInvoiceBuffer(
          shopifyOrder,
          sub,
          sub.customer,
          invoiceNumber,
          shippingDate,
          prisma
        );

        const invoiceUrl = await uploadInvoiceToDropbox(
          invoiceBuffer,
          `${invoiceNumber}.pdf`
        );

        console.log("✅ Invoice URL:", invoiceUrl);

        // ===============================
        // 💾 SAVE SHOPIFY ORDER WITH INVOICE
        // ===============================
        await prisma.shopifyOrder.create({
          data: {
            subscriptionId: sub.id,
            shopifyOrderId,
            order_number: shopifyOrder.order_number.toString(),
            order_status_url: shopifyOrder.token.toString(),
            shippingDate,
            status: "created",
            shippingAddress: addr,
            billingAddress: addr,
            invoiceUrl,
            invoiceNumber,
          },
        });

        // ===============================
        // 🧮 CHECK TOTAL DELIVERY LIMIT
        // ===============================
        const deliveriesPerWeek = sub.deliveryDays.split(",").length;
        const isMonthly = sub.frequency === "Once a Month" || sub.frequency === "Twice a Month";

        const totalAllowedOrders = isMonthly
          ? Math.round(sub.period / 4) * deliveriesPerWeek
          : deliveriesPerWeek * sub.period;

        const createdOrdersCount = await prisma.shopifyOrder.count({
          where: { subscriptionId: sub.id },
        });

        // 🚫 If quota reached → cancel immediately
        if (createdOrdersCount >= totalAllowedOrders) {
          await prisma.subscription.update({
            where: { id: sub.id },
            data: { status: "cancelled", nextShippingDate: null },
          });
          console.log(`🏁 ${createdOrdersCount}/${totalAllowedOrders} orders done → subscription cancelled`);
          continue;
        }

        // ➡️ CALCULATE NEXT SHIPPING DATE
        const deliveryDays = sub.deliveryDays.split(",");
        let nextDate;

        if (isMonthly) {
          if (sub.frequency === "Once a Month") {
            nextDate = addDays(shippingDate, 28);
            for (let i = 0; i < 7; i++) {
              if (deliveryDays.some(d => dayMap[d] === nextDate.getDay())) break;
              nextDate = addDays(nextDate, 1);
            }
          } else {
            nextDate = addDays(shippingDate, 14);
            for (let i = 0; i < 7; i++) {
              if (deliveryDays.some(d => dayMap[d] === nextDate.getDay())) break;
              nextDate = addDays(nextDate, 1);
            }
          }
        } else {
          nextDate = addDays(shippingDate, 1);
          for (let i = 0; i < 14; i++) {
            if (deliveryDays.some(d => dayMap[d] === nextDate.getDay())) break;
            nextDate = addDays(nextDate, 1);
          }
        }

        await prisma.subscription.update({
          where: { id: sub.id },
          data: { nextShippingDate: nextDate },
        });

        console.log(`➡️ Next shipping date set to ${nextDate.toISOString()}`);
      } catch (err) {
        console.error(`❌ Error processing subscription ${sub.id}`, err);
      }
    }
    })
  );
}

console.log("🕒 Scheduler run completed");
}
