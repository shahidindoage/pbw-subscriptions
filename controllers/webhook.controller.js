import crypto from "crypto";
import { subscriptionsDB } from "../models/subscription.store.js";

export const razorpayWebhook = (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

  try {
    const shasum = crypto.createHmac("sha256", secret);
    shasum.update(req.body);
    const digest = shasum.digest("hex");

    if (digest !== req.headers["x-razorpay-signature"]) {
      return res.status(400).send("Invalid signature");
    }

    const event = JSON.parse(req.body.toString());
    console.log("📩 Webhook:", event.event);

    if (event.event === "subscription.charged") {
      const id = event.payload.subscription.entity.id;
      const sub = subscriptionsDB.find(s => s.razorpay_subscription_id === id);
      if (sub) sub.status = "active";
    }

    if (event.event === "subscription.cancelled") {
      const id = event.payload.subscription.entity.id;
      const sub = subscriptionsDB.find(s => s.razorpay_subscription_id === id);
      if (sub) sub.status = "cancelled";
    }

    res.send("OK");
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(500).send("Webhook error");
  }
};
