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

  // 3️⃣ Process each subscription
  for (const sub of subscriptions) {
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
      if (diffSec < 0 || diffSec > 30) {
        console.log(
          `⏳ Not time yet. now=${now.toISOString()}, orderCreateTime=${orderCreateTime.toISOString()}, diffSec=${diffSec}`
        );
        continue;
      }

      console.log({
        now: now.toISOString(),
        orderCreateTime: orderCreateTime.toISOString(),
        diffMs: now.getTime() - orderCreateTime.getTime(),
      });

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
       const lastName =
        nameParts.length > 1
    ? nameParts.slice(1).join(" ")
    : "User"; // fallback if no last name
const numericVariantId = sub.variantId?.toString().includes("gid://")
  ? sub.variantId.split("/").pop()
  : sub.variantId;
      const shopifyOrderData = {
        order: {
        line_items: [
  {
    variant_id: Number(numericVariantId),
    quantity: sub.quantity,
  },
],
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
console.log("Variant ID from DB:", sub.variantId);
console.log("Converted Variant ID:", numericVariantId);
      // console.log("📦 Shopify Order Payload:", JSON.stringify(shopifyOrderData, null, 2));

      const shopifyRes = await createShopifyOrder(shopifyOrderData);

      // 👇 FULL response (readable)
// console.log(
//   "🛒 Shopify Full Response:\n",
//   JSON.stringify(shopifyRes, null, 2)
// );
      const shopifyOrderId = shopifyRes?.order?.id?.toString() || null;
       const shopifyOrder = shopifyRes.order;
      console.log(`✅ Shopify order ${shopifyOrderId} created for subscription ${sub.id}`);

      // ===============================
// 🧾 GENERATE INVOICE
// ===============================

// 1️⃣ Invoice Number
const invoiceNumber = `INV-${shopifyOrder.order_number}`;

// 2️⃣ Generate PDF Buffer
// const invoiceBuffer = await generateInvoiceBuffer(
//   shopifyOrder,
//   sub,
//   sub.customer,
//   invoiceNumber,
//   shippingDate
// );

const invoiceBuffer = await generateInvoiceBuffer(
  shopifyOrder,
  sub,
  sub.customer,
  invoiceNumber,
  shippingDate,
  prisma  // 👈 pass prisma here
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
    invoiceUrl,      // ✅ saved
    invoiceNumber,   // ✅ saved
  },
});




      // 📧 SEND ORDER CREATED EMAIL
// try {
//   const orderLink = `https://pbwfoods.com/account/orders/${shopifyOrder.token.toString()}`;

//   await sendEmail({
//     to: sub.customer.email,
//     subject: `Order Confirmed: PBW${shopifyOrder.order_number.toString()}`,
//     html: `
//       <h2>Order Confirmed 🎉</h2>

//       <p>Hi ${sub.customer.name || "there"},</p>

//       <p>Your order for <strong>${sub.product}</strong> has been successfully created.</p>

//       <p>
//         <strong>Order Number:</strong> PBW${shopifyOrder.order_number.toString()}<br/>
//         <strong>Delivery Date:</strong>
//         ${shippingDate.toLocaleDateString("en-IN", {
//           weekday: "short",
//           day: "2-digit",
//           month: "short",
//           year: "numeric",
//         })}
//       </p>

//       <p>
//         <a href="${orderLink}"
//            style="
//              display:inline-block;
//              padding:10px 18px;
//              background:#5e8046;
//              color:#ffffff;
//              text-decoration:none;
//              border-radius:6px;
//              font-weight:600;
//            ">
//           View Order
//         </a>
//       </p>

//       <p>If you need help, just reply to this email.</p>

//       <p>— PBW Foods 💚</p>
//     `,
//   });

//   console.log("📧 Order confirmation email sent");
// } catch (err) {
//   console.error("❌ Failed to send order email:", err);
// }

      // 🛑 LAST ORDER? → CANCEL IMMEDIATELY
      // if (sub.subscriptionEndDate && shippingDate >= sub.subscriptionEndDate) {
      //   await prisma.subscription.update({
      //     where: { id: sub.id },
      //     data: { status: "cancelled", nextShippingDate: null },
      //   });
      //   console.log(`🏁 Last order done → subscription ${sub.id} auto-cancelled`);
      //   continue;
      // }

      // ===============================
// 🧮 CHECK TOTAL DELIVERY LIMIT
// ===============================
const deliveriesPerWeek = sub.deliveryDays.split(",").length;
const isMonthly = sub.frequency === "Once a Month" || sub.frequency === "Twice a Month";

const totalAllowedOrders = isMonthly
  ? Math.round(sub.period / 4) * deliveriesPerWeek  // per month × months
  : deliveriesPerWeek * sub.period;                  // per week × weeks

const createdOrdersCount = await prisma.shopifyOrder.count({
  where: { subscriptionId: sub.id },
});

// 🚫 If quota reached → cancel immediately
if (createdOrdersCount >= totalAllowedOrders) {
  await prisma.subscription.update({
    where: { id: sub.id },
    data: { status: "cancelled", nextShippingDate: null },
  });

  console.log(
    `🏁 ${createdOrdersCount}/${totalAllowedOrders} orders done → subscription cancelled`
  );
  continue;
}


      
      // ➡️ CALCULATE NEXT SHIPPING DATE
const deliveryDays = sub.deliveryDays.split(",");
// const isMonthly = sub.frequency === "Once a Month" || sub.frequency === "Twice a Month";

let nextDate;

if (isMonthly) {
  if (sub.frequency === "Once a Month") {
    // Jump ~28 days ahead and find the matching weekday
    nextDate = addDays(shippingDate, 28);
    for (let i = 0; i < 7; i++) {
      if (deliveryDays.some(d => dayMap[d] === nextDate.getDay())) break;
      nextDate = addDays(nextDate, 1);
    }
  } else {
    // "Twice a Month" — jump ~14 days ahead and find matching weekday
    nextDate = addDays(shippingDate, 14);
    for (let i = 0; i < 7; i++) {
      if (deliveryDays.some(d => dayMap[d] === nextDate.getDay())) break;
      nextDate = addDays(nextDate, 1);
    }
  }
} else {
  // Existing weekly logic
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

  console.log("🕒 Scheduler run completed");
}

