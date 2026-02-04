import prisma from "../utils/prisma.js";
import { createShopifyOrder } from "../utils/createShopifyOrder.js";
import { addDays, subHours } from "date-fns";

/**
 * Scheduler:
 * - Creates Shopify orders exactly 24 hours before nextShippingDate
 * - Moves nextShippingDate forward
 * - Auto-cancels subscription after last order
 * - Skips paused, canceled, expired subscriptions
 */
export async function runSubscriptionScheduler({ testMode = false } = {}) {
  // ⏱️ Use real time in production
  const now = new Date();

  // 🧪 Test time (remove in prod)
  // const now = new Date("2026-02-15T12:00:00Z");

  console.log("🕒 Scheduler running at:", now.toISOString());

  // 1️⃣ Fetch active subscriptions
  const subscriptions = await prisma.subscription.findMany({
    where: {
      status: "active",
      ...(testMode
        ? {}
        : {
            nextShippingDate: {
              lte: addDays(now, 1), // within next 24 hours
            },
          }),
    },
    include: {
      customer: true,
    },
  });

  if (!subscriptions.length) {
    console.log("No subscriptions to process.");
    return;
  }

  console.log(`Found ${subscriptions.length} subscriptions`);

  // 2️⃣ Process each subscription
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
          data: {
            status: "cancelled",
            nextShippingDate: null,
          },
        });

        console.log(`🛑 Subscription ${sub.id} expired → auto-cancelled`);
        continue;
      }

      const shippingDate = sub.nextShippingDate;
      if (!shippingDate) continue;

      // 🕐 Order creation window
      const orderCreateTime = subHours(shippingDate, 24);

      // Not yet time
      if (now < orderCreateTime) {
        continue;
      }

      // 🛑 Prevent duplicate orders
      const existingOrder = await prisma.shopifyOrder.findFirst({
        where: {
          subscriptionId: sub.id,
          shippingDate,
        },
      });

      if (existingOrder) {
        continue;
      }

      // ===============================
      // 🛒 CREATE SHOPIFY ORDER
      // ===============================
      const addr = sub.address || {};

      const shopifyOrderData = {
        order: {
          line_items: [
            {
              variant_id: sub.variantId || 0,
              quantity: sub.quantity,
            },
          ],
          customer: {
            first_name: addr.name?.split(" ")[0] || "Customer",
            last_name: addr.name?.split(" ")[1] || "",
            email: sub.customer.email,
          },
          financial_status: "paid",
          fulfillment_status: "unfulfilled",
          note: `Subscription order (${sub.product})`,
          note_attributes: [
            { name: "SubscriptionId", value: sub.id },
            { name: "ShippingDate", value: shippingDate.toISOString() },
            { name: "Frequency", value: sub.frequency },
          ],
          shipping_address: {
            first_name: addr.name || "Customer",
            address1: addr.line1 || "",
            address2: addr.line2 || "",
            city: addr.city || "",
            province: addr.state || "",
            zip: addr.pincode || "",
            phone: addr.phone || sub.customer.contact || "",
            country: "India",
          },
          billing_address: {
            first_name: addr.name || "Customer",
            address1: addr.line1 || "",
            address2: addr.line2 || "",
            city: addr.city || "",
            province: addr.state || "",
            zip: addr.pincode || "",
            phone: addr.phone || sub.customer.contact || "",
            country: "India",
          },
        },
      };

      const shopifyRes = await createShopifyOrder(shopifyOrderData);
      const shopifyOrderId = shopifyRes?.order?.id?.toString() || null;

      console.log(
        `✅ Shopify order ${shopifyOrderId} created for subscription ${sub.id}`
      );

      // ===============================
      // 🧾 SAVE ORDER RECORD
      // ===============================
      await prisma.shopifyOrder.create({
        data: {
          subscriptionId: sub.id,
          shopifyOrderId,
          shippingDate,
          status: "created",
          shippingAddress: addr,
          billingAddress: addr,
        },
      });

      // ===============================
      // 🛑 LAST ORDER? → CANCEL IMMEDIATELY
      // ===============================
      if (
        sub.subscriptionEndDate &&
        shippingDate >= sub.subscriptionEndDate
      ) {
        await prisma.subscription.update({
          where: { id: sub.id },
          data: {
            status: "cancelled",
            nextShippingDate: null,
          },
        });

        console.log(
          `🏁 Last order done → subscription ${sub.id} auto-cancelled`
        );
        continue;
      }

      // ===============================
      // ➡️ CALCULATE NEXT SHIPPING DATE
      // ===============================
      const deliveryDays = sub.deliveryDays.split(",");
      const dayMap = {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
      };

      let nextDate = addDays(shippingDate, 1);

      for (let i = 0; i < 14; i++) {
        if (deliveryDays.some(d => dayMap[d] === nextDate.getDay())) {
          break;
        }
        nextDate = addDays(nextDate, 1);
      }

      await prisma.subscription.update({
        where: { id: sub.id },
        data: {
          nextShippingDate: nextDate,
        },
      });

      console.log(
        `➡️ Next shipping date set to ${nextDate.toISOString()}`
      );
    } catch (err) {
      console.error(`❌ Error processing subscription ${sub.id}`, err);
    }
  }

  console.log("🕒 Scheduler run completed");
}
