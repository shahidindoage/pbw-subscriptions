import prisma from "../utils/prisma.js";
import pLimit from "p-limit";
import { createShopifyOrder } from "../utils/createShopifyOrder.js";
import { addDays, subHours, differenceInSeconds } from "date-fns";
import { sendEmail } from "../utils/email.js";
import { generateInvoiceBuffer } from "../utils/generateInvoice.js";
import { uploadInvoice } from "../utils/uploadInvoice.js";
import { uploadInvoiceToDropbox } from "../utils/dropbox.js";
// import { uploadInvoiceToShopify } from "../utils/shopifyUploadInvoice.js";
async function ensureDbConnection() {
  try {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
    console.log("✅ DB connected");
  } catch (err) {
    console.log("❌ DB failed, retrying...");

    await prisma.$disconnect();
    await new Promise(res => setTimeout(res, 3000));

    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;

    console.log("✅ DB reconnected");
  }
}
function getFrequencyCount(frequency) {
  const freq = frequency.toLowerCase();

  if (freq.includes("once") && freq.includes("week")) return 1;
  if (freq.includes("twice") && freq.includes("week")) return 2;
  if (freq.includes("thrice") && freq.includes("week")) return 3;

  if (freq.includes("once") && freq.includes("month")) return 1;
  if (freq.includes("twice") && freq.includes("month")) return 2;

  return 1; // fallback safety
}

function isMonthlyFrequency(frequency) {
  return frequency.toLowerCase().includes("month");
}

function calculatePerOrderDiscount(sub) {
  const totalDiscount = Number(sub.discountAmount || 0);

  if (!totalDiscount) return 0;

  const freqCount = getFrequencyCount(sub.frequency);
  const isMonthly = isMonthlyFrequency(sub.frequency);

  let totalDeliveries = 0;

  if (isMonthly) {
    const months = sub.period / 4; // convert weeks → months
    totalDeliveries = freqCount * months;
  } else {
    totalDeliveries = freqCount * sub.period;
  }

  if (!totalDeliveries || totalDeliveries <= 0) return 0;

  return totalDiscount / totalDeliveries;
}

async function retryShopify(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}
/**
 * Scheduler:
 * - Creates Shopify orders exactly 24 hours before nextShippingDate
 * - 48 hours for Monday shipping
 * - Moves nextShippingDate forward
 * - Auto-cancels subscription after last order
 * - Skips paused, canceled, expired subscriptions
 */

let isSchedulerRunning = false;

export async function runSubscriptionScheduler({ testMode = false } = {}) {
  if (isSchedulerRunning) {
    console.log("⏭️ Scheduler already running, skipping this tick");
    return;
  }

  isSchedulerRunning = true;

  try {
  // const now = new Date("2026-04-07T09:00:00+05:30");

  await ensureDbConnection(); // ⭐ ADD THIS LINE
  const now = new Date();
  console.log("🕒 Scheduler running at:", now.toISOString());

  // 1️⃣ Fetch active subscriptions
  let subscriptions;

try {
  subscriptions = await prisma.subscription.findMany({
    where: { status: "active" },
    include: { customer: true },
  });
} catch (err) {
  console.log("⚠️ First query failed, retrying...");

  await ensureDbConnection();

  subscriptions = await prisma.subscription.findMany({
    where: { status: "active" },
    include: { customer: true },
  });
}

  if (!subscriptions.length) {
    console.log("No subscriptions to process.");
    return;
  }

  console.log(`Found ${subscriptions.length} subscriptions`);

  // 2️⃣ Prepare dayMap once (use everywhere)
const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const limit = pLimit(2); // max 2 Shopify calls at once

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

        // Create order only if within ±120 seconds of target
        if (diffSec < 0 || diffSec > 600) {
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

        const perOrderDiscount = calculatePerOrderDiscount(sub);  

        const shopifyOrderData = {
          order: {
            line_items: [{
              variant_id: Number(numericVariantId),
              quantity: sub.quantity,
            }],
            ...(perOrderDiscount > 0 && {
  discount_codes: [{
    code: sub.promoCode || "DISCOUNT",
    amount: perOrderDiscount.toFixed(2),
    type: "fixed_amount"
  }]
}),
            customer: { first_name: firstName, last_name: lastName, email: sub.customer.email },
            financial_status: "paid",
            fulfillment_status: "unfulfilled",
            note: `Subscription order (${sub.product})`,
            note_attributes: [
              { name: "SubscriptionId", value: sub.id },
              { name: "ShippingDate", value: shippingDate.toISOString() },
              { name: "Frequency", value: sub.frequency },
              { name: "delivery Fee", value: sub.deliveryFee },
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

       const shopifyRes = await limit(() =>
  retryShopify(async () => {
    const res = await createShopifyOrder(shopifyOrderData);
    await new Promise(r => setTimeout(r, 500));
    return res;
  })
);

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
  } finally {
    isSchedulerRunning = false;
  }
}
