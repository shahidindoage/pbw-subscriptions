import express from "express";
import bodyParser from "body-parser";
import Razorpay from "razorpay";
import dotenv from "dotenv";
import cors from "cors";
import prisma from "./utils/prisma.js"; // Prisma client
import session from "express-session";
import crypto from "crypto";
import axios from "axios";
import { createShopifyOrder } from "./utils/createShopifyOrder.js";


dotenv.config();

const app = express();

app.set("view engine", "ejs");
app.set("views", "./views");

// ===== Middleware =====
app.use(cors());
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
  })
);

// ===== Razorpay Client =====
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY,
  key_secret: process.env.RAZORPAY_SECRET,
});


// Admin routes

// Middleware to protect admin routes
function isAdmin(req, res, next) {
  if (req.session.adminId) return next();  // check adminId, not admin
  return res.redirect("/admin/login");
}

app.get("/admin/logout", (req, res) => {
  if (req.session.adminId) {
    delete req.session.adminId;  // remove only adminId
  }
  res.redirect("/admin/login");
});


app.get("/admin/login", (req, res) => {
  res.render("admin-login", { error: null });
});
app.post("/admin/login", (req, res) => {
  const { username, password } = req.body;

  if (
    username === process.env.ADMIN_USER &&
    password === process.env.ADMIN_PASS
  ) {
    req.session.adminId = true;
    return res.redirect("/admin/dashboard");
  }

  res.render("admin-login", { error: "Invalid credentials" });
});

app.get("/admin/dashboard", isAdmin, async (req, res) => {
  const customers = await prisma.customer.findMany({
    include: { subscriptions: true },
  });

  const subscriptions = await prisma.subscription.findMany({
    include: { customer: true },
    orderBy: { createdAt: "desc" },
  });

  res.render("admin-dashboard", {
    page: "customers", // default view
    customers,
    subscriptions,
  });
});

app.get("/admin/subscriptions", isAdmin, async (req, res) => {
  const subscriptions = await prisma.subscription.findMany({
    include: { customer: true },
    orderBy: { createdAt: "desc" },
  });

  res.render("admin-dashboard", {
    page: "subscriptions",
    customers: [],
    subscriptions,
  });
});

app.get("/admin/customers", isAdmin, async (req, res) => {
  const customers = await prisma.customer.findMany({
    include: { subscriptions: true },
  });

  res.render("admin-dashboard", {
    page: "customers",
    customers,
    subscriptions: [],
  });
});
app.post("/admin/subscription/:id/action", async (req, res) => {
  if (!req.session.adminId) return res.redirect("/admin/login");

  const { id } = req.params;
  const { action } = req.body;

  let status;

  if (action === "stop") status = "stopped";
  if (action === "resume") status = "active";
  if (action === "cancel") status = "cancelled";

  if (!status) return res.redirect("/admin/subscriptions");

  await prisma.subscription.update({
    where: { id },
    data: {
      status,
      cancelledAt: status === "cancelled" ? new Date() : null,
    },
  });

  res.redirect("/admin/subscriptions");
});

// Customer routes 


app.get("/customer/login", (req, res) => {
  res.render("customer/login", { error: null });
});

app.post("/customer/login", async (req, res) => {
  const { email, password } = req.body;
  const customer = await prisma.customer.findUnique({ where: { email } });

  if (!customer || customer.password !== password) {
    return res.render("customer/login", { error: "Invalid credentials" });
  }

  req.session.customerId = customer.id;
  res.redirect("/customer/dashboard");
});



function customerAuth(req, res, next) {
  if (!req.session.customerId) {
    return res.redirect("/customer/login");
  }
  next();
}
app.get("/customer/dashboard", async (req, res) => {
  try {
    // Get email from query string (iframe)
    const { email } = req.query;

    if (!email) {
      return res.status(400).send("Email required");
    }

    // Fetch customer from DB with only active subscriptions
    const customer = await prisma.customer.findUnique({
  where: { email },
  include: {
    subscriptions: {
      orderBy: { createdAt: "desc" },
      where: { status: { in: ["active", "stopped"] } }, // include stopped too
    },
  },
});


    if (!customer) {
      return res.send("No customer found for this email");
    }

    // Ensure subscriptions array exists
    customer.subscriptions = customer.subscriptions || [];

    res.render("customer/dashboard", { customer });
  } catch (err) {
    console.error("Error fetching customer:", err);
    res.status(500).send("Server error");
  }
});



app.post("/customer/subscription/:id/stop", async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.subscription.update({
      where: { id },
      data: { status: "stopped" },
    });
    res.redirect("/customer/dashboard?email=" + encodeURIComponent(req.query.email));
  } catch (err) {
    console.error("Stop subscription error:", err);
    res.status(500).send("Failed to stop subscription");
  }
});

app.post("/customer/subscription/:id/resume", async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.subscription.update({
      where: { id },
      data: { status: "active" },
    });
    res.redirect("/customer/dashboard?email=" + encodeURIComponent(req.query.email));
  } catch (err) {
    console.error("Resume subscription error:", err);
    res.status(500).send("Failed to resume subscription");
  }
});

app.post("/customer/subscription/:id/cancel", async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.subscription.update({
      where: { id },
      data: {
        status: "cancelled",
        cancelledAt: new Date(),
      },
    });
    res.redirect("/customer/dashboard?email=" + encodeURIComponent(req.query.email));
  } catch (err) {
    console.error("Cancel subscription error:", err);
    res.status(500).send("Failed to cancel subscription");
  }
});

app.get("/customer/logout", (req, res) => {
  if (req.session.customerId) {
    delete req.session.customerId; // remove only customerId
  }
  res.redirect("/customer/login");
});

// ===== Helper: get or create Razorpay customer =====
async function getOrCreateRazorpayCustomer(name, email, contact) {
  const existing = await razorpay.customers.all({ email });
  if (existing.items.length > 0) return existing.items[0];

  return await razorpay.customers.create({ name, email, contact: contact || null });
}

// ===== Check Active Subscription =====
app.post("/check-subscription", async (req, res) => {
  try {
    const { email, product } = req.body;
    if (!email || !product) return res.status(400).json({ error: "Missing fields" });

    const customer = await prisma.customer.findUnique({
      where: { email },
      include: { subscriptions: true },
    });

    if (!customer) return res.json({ exists: false });

    // Only active subscriptions (not cancelled/failed)
    const sub = customer.subscriptions.find(
  (s) => s.product === product && ["active", "stopped"].includes(s.status)
);

if (sub) {
  return res.json({
    exists: true,
    subscription_id: sub.id,
    frequency: sub.frequency,
    status: sub.status, // 👈 IMPORTANT
  });
}

return res.json({ exists: false });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Check subscription failed" });
  }
});

// ===== Create Subscription (Normal Razorpay Payment) =====
app.post("/create-subscription", async (req, res) => {
  try {
    const {
      name,
      email,
      contact,
      product,
      variantId,
      frequency,   // 1,2,3 from frontend
      quantity,
      period,
      deliveryDays,
      totalAmount,
      deliveryFee,
      address 
    } = req.body;

    // ===== 1️⃣ Get or create customer =====
    let dbCustomer = await prisma.customer.findUnique({ where: { email } });
    const rzCustomer = await getOrCreateRazorpayCustomer(name, email, contact);

    if (!dbCustomer) {
      const randomPassword = crypto.randomBytes(4).toString("hex"); // 8-character random password

  dbCustomer = await prisma.customer.create({
    data: {
      name,
      email,
      contact: contact || null,
      razorpayId: rzCustomer.id,
      password: randomPassword, // store plain password
    },
  });
    } else if (!dbCustomer.razorpayId) {
      dbCustomer = await prisma.customer.update({
        where: { email },
        data: { razorpayId: rzCustomer.id, name, contact: contact || null },
      });
    }

    // ===== 2️⃣ Cancel previous subscriptions if exists =====
    // const previousSubs = await prisma.subscription.findMany({
    //   where: {
    //     customerId: dbCustomer.id,
    //     product,
    //     status: { not: "cancelled" },
    //   },
    // });

    // for (let sub of previousSubs) {
    //   await prisma.subscription.update({
    //     where: { id: sub.id },
    //     data: { status: "cancelled", cancelledAt: new Date() },
    //   });
    // }
// Cancel previous subscriptions efficiently
// await prisma.subscription.updateMany({
//   where: {
//     customerId: dbCustomer.id,
//     product,
//     status: { not: "cancelled" },
//   },
//   data: {
//     status: "cancelled",
//     cancelledAt: new Date(),
//   },
// });

    // ===== 3️⃣ Create Razorpay Order =====
    const order = await razorpay.orders.create({
      amount: Math.round(totalAmount * 100), // in paise
      currency: "INR",
      receipt: `rcpt_${Date.now()}`,
      notes: {
        product,
        frequency: frequency.toString(),
        quantity: quantity.toString(),
        period: period.toString(),
        deliveryDays: deliveryDays?.join(",") || "",
        totalAmount: totalAmount.toString(),
        deliveryFee: deliveryFee.toString(),
      },
    });



    // ===== 5️⃣ Store subscription in DB =====
    const sub = await prisma.subscription.create({
      data: {
        razorpayOrderId: order.id,
        product,
        frequency: frequency.toString(),
        quantity,
        period,
        deliveryDays: deliveryDays?.join(",") || null,
        totalAmount,
        deliveryFee,
        status: "pending",
        customerId: dbCustomer.id,
        isOneTimePurchase: false,
      },
    });



     // ===== 5️⃣ Create Shopify order (sample address) =====
    try {
      const shopifyOrderData = {
  order: {
    line_items: [
      {
        variant_id: variantId,
        quantity,
      },
    ],

    customer: {
      first_name: name.split(" ")[0] || "Test",
      last_name: name.split(" ")[1] || "Customer",
      email
    },

    financial_status: "paid",
    fulfillment_status: "unfulfilled",

    // ✅ Simple note (visible in order page)
    note: `Subscription Details:
Product: ${product}
Frequency: ${frequency}
Quantity: ${quantity}
Period: ${period}
Delivery Days: ${deliveryDays?.join(", ") || "N/A"}
Total Amount: ${totalAmount}
Delivery Fee: ${deliveryFee}`,

    // ✅ Structured notes (Best practice for apps)
    note_attributes: [
      { name: "Product", value: product },
      { name: "Frequency", value: frequency?.toString() },
      { name: "Quantity", value: quantity?.toString() },
      { name: "Period", value: period?.toString() },
      { name: "Delivery Days", value: deliveryDays?.join(",") || "" },
      { name: "Total Amount", value: totalAmount?.toString() },
      { name: "Delivery Fee", value: deliveryFee?.toString() },
    ],

    shipping_address: {
      first_name:
        address?.name?.split(" ")[0] ||
        name.split(" ")[0] ||
        "Customer",

      last_name: address?.name?.split(" ")[1] || "",

      phone: address?.phone || contact || "",

      address1: address?.line1 || "",
      address2: address?.line2 || "",
      city: address?.city || "",
      province: address?.state || "",
      zip: address?.pincode || "",
      country: "India",
    },

    billing_address: {
      first_name:
        address?.name?.split(" ")[0] ||
        name.split(" ")[0] ||
        "Customer",

      last_name: address?.name?.split(" ")[1] || "",

      phone: address?.phone || contact || "",

      address1: address?.line1 || "",
      address2: address?.line2 || "",
      city: address?.city || "",
      province: address?.state || "",
      zip: address?.pincode || "",
      country: "India",
    },
  },
};



      const shopifyRes = await createShopifyOrder(shopifyOrderData);
console.log("Shopify order created:", shopifyRes.order.id);
    } catch (shopifyErr) {
      console.error("Shopify order creation failed:", shopifyErr.response?.data || shopifyErr);
    }

    res.json({ order, subscription: sub, customer: dbCustomer });
  } catch (err) {
    console.error("Subscription creation failed:", err);
    res.status(500).json({ error: "Subscription creation failed" });
  }
});
app.post("/verify-payment", async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    // 1️⃣ Verify signature
    const body = razorpay_order_id + "|" + razorpay_payment_id;

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_SECRET)
      .update(body)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ error: "Invalid payment signature" });
    }

    // 2️⃣ Activate subscription
    const subscription = await prisma.subscription.update({
      where: { razorpayOrderId: razorpay_order_id },
      data: {
        status: "active",
        razorpayPaymentId: razorpay_payment_id,
        paidAt: new Date(),        // ✅ CORRECT FIELD
      },
    });

    res.json({ success: true, subscription });
  } catch (err) {
    console.error("Payment verification failed:", err);
    res.status(500).json({ error: "Payment verification failed" });
  }
});


// ===== Webhook (Optional) =====
app.post("/razorpay-webhook", (req, res) => {
  // Handle payment success/capture here
  res.status(200).json({ ok: true });
});

// ===== Health Check =====
app.get("/", (req, res) => {
  res.send("Subscription backend running ✅");
});

// ===== Start Server =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
