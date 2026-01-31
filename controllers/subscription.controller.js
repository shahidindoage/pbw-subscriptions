import razorpay from "../config/razorpay.js";
import { subscriptionsDB } from "../models/subscription.store.js";
import { productPlanMap } from "../utils/productPlanMap.js";

export const createSubscription = async (req, res) => {
  try {
    const { name, email, contact, product, frequency } = req.body;

    if (!productPlanMap[product]) {
      return res.status(400).json({ error: "Product plan not found" });
    }

    // Check active subscription
    const activeSub = subscriptionsDB.find(
      s => s.email === email && s.status !== "cancelled"
    );

    if (activeSub) {
      return res.status(400).json({
        error: "You already have an active subscription"
      });
    }

    // Get / Create Razorpay customer
    const customers = await razorpay.customers.all({ email });
    const customer = customers.items.length
      ? customers.items[0]
      : await razorpay.customers.create({ name, email, contact });

    // Create subscription
    const subscription = await razorpay.subscriptions.create({
      plan_id: productPlanMap[product],
      customer_notify: 1,
      total_count: 12,
      customer_id: customer.id,
      notes: { product, frequency }
    });

    subscriptionsDB.push({
      customer_name: name,
      email,
      contact,
      product,
      frequency,
      razorpay_subscription_id: subscription.id,
      status: subscription.status
    });

    res.json({ subscription });
  } catch (err) {
    console.error("❌ Subscription creation failed:", err);
    res.status(500).json({ error: "Subscription creation failed" });
  }
};

export const listSubscriptions = (_, res) => {
  res.render("subscriptions", { subscriptions: subscriptionsDB });
};
