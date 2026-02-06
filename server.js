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
// import "./cron/runCron.js"
// import { addDays } from "date-fns";
import cronRoutes from "./routes/cron.js";
import { sendWelcomeEmail } from "./utils/email.js";
import { sendEmail } from "./utils/email.js";

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
app.use("/cron", cronRoutes);
// ===== Razorpay Client =====
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY,
  key_secret: process.env.RAZORPAY_SECRET,
});

// app.get("/api/delivery-fee-eligibility", async (req, res) => {
//   try {
//     const { email, period } = req.query;

//     if (!email || !period) {
//       return res.status(400).json({ error: "Email and period required" });
//     }

//     const customer = await prisma.customer.findUnique({
//       where: { email },
//       include: {
//         subscriptions: {
//           where: {
//             status: { in: ["active", "stopped"] },
//           },
//         },
//       },
//     });

//     if (!customer) {
//       return res.json({
//         freeDelivery: false,
//         deliveryFee: 60 * Number(period),
//         reason: "Customer not found",
//       });
//     }

//     // ✅ CORE RULE: ANY subscription ≥ 5000
//     const hasFreeDelivery = customer.subscriptions.some(
//       (sub) => Number(sub.totalAmount) >= 5000
//     );

//     const deliveryFee = hasFreeDelivery ? 0 : 60 * Number(period);

//     res.json({
//       freeDelivery: hasFreeDelivery,
//       deliveryFee,
//     });
//   } catch (err) {
//     console.error("Delivery fee check failed:", err);
//     res.status(500).json({ error: "Server error" });
//   }
// });

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

  const shopifyOrders = await prisma.shopifyOrder.findMany({
    include: {
      subscription: {
        include: {
          customer: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  res.render("admin-dashboard", {
    page: req.query.page || "customers",
    customers,
    subscriptions,
    shopifyOrders,
  });
});
app.post("/admin/shopify-order/:id/status", isAdmin, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  await prisma.shopifyOrder.update({
    where: { id },
    data: { status },
  });

  // ✅ redirect back to Shopify Orders tab
  res.redirect("/admin/dashboard?page=shopify-orders");
});
app.get("/admin/subscription/:id/orders", isAdmin, async (req, res) => {
  const orders = await prisma.shopifyOrder.findMany({
    where: { subscriptionId: req.params.id },
    include: {
      subscription: true,
    },
    orderBy: { shippingDate: "asc" },
  });

  res.json(
    orders.map(o => ({
      id: o.id,
      shopifyOrderId: o.shopifyOrderId,
      shippingDate: o.shippingDate,
      status: o.status,
      createdAt: o.createdAt,
      product: o.subscription.product,
    }))
  );
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

  let data = {};

  if (action === "stop") {
    data = {
      status: "stopped",
      pausedAt: new Date(),
    };
  }

  if (action === "resume") {
    data = {
      status: "active",
      pausedAt: null,
    };
  }

  if (action === "cancel") {
    data = {
      status: "cancelled",
      cancelledAt: new Date(),
      pausedAt: null,
      nextShippingDate: null, // 🔥 THIS IS THE KEY FIX
    };
  }

  if (!Object.keys(data).length) {
    return res.redirect("/admin/subscriptions");
  }

  await prisma.subscription.update({
    where: { id },
    data,
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
app.get("/customer/subscription/:id/orders", async (req, res) => {
  try {
    const { id } = req.params;

    const orders = await prisma.shopifyOrder.findMany({
      where: { subscriptionId: id },
      orderBy: { shippingDate: "desc" },
      include: {
      subscription: {
        select: {
          product: true,
        },
      },
    },
    });

    res.json({ orders });
  } catch (err) {
    console.error("Fetch Shopify orders error:", err);
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});



app.post("/customer/subscription/:id/stop", async (req, res) => {
  try {
    const { id } = req.params;

    const sub = await prisma.subscription.findUnique({
      where: { id },
      include: { customer: true },
    });

    if (!sub) {
      return res.status(404).send("Subscription not found");
    }

    if (sub.pausedAt) {
      return res.redirect(
        "/customer/dashboard?email=" + encodeURIComponent(req.query.email)
      );
    }

    await prisma.subscription.update({
      where: { id },
      data: {
        status: "stopped",
        pausedAt: new Date(),
      },
    });


     // 🔔 Send "Subscription Stopped" email
    try {
      await sendEmail({
        to: sub.customer.email,
        subject: "Your Subscription is Paused",
        html: `
          <h2>Hi ${sub.customer.name},</h2>
          <p>Your subscription for <strong>${sub.product}</strong> has been paused successfully.</p>
          <p>You can resume it anytime from your dashboard.</p>
          <p>— Team</p>
        `,
      });
    } catch (err) {
      console.error("Failed to send stop subscription email:", err);
    }

    res.redirect(
      "/customer/dashboard?email=" + encodeURIComponent(req.query.email)
    );
  } catch (err) {
    console.error("Stop subscription error:", err);
    res.status(500).send("Failed to stop subscription");
  }
});




app.post("/customer/subscription/:id/resume", async (req, res) => {
  try {
    const { id } = req.params;

    const sub = await prisma.subscription.findUnique({
      where: { id },
      include: { customer: true }, 
    });

    if (!sub || !sub.pausedAt) {
      return res.redirect(
        "/customer/dashboard?email=" + encodeURIComponent(req.query.email)
      );
    }

    const now = new Date();

    // 1️⃣ Calculate paused days
    const pausedMs = now.getTime() - sub.pausedAt.getTime();
    const pausedDays = Math.ceil(pausedMs / (1000 * 60 * 60 * 24));

    // 2️⃣ Extend end date
    const newEndDate = addDays(sub.subscriptionEndDate, pausedDays);

    // 3️⃣ Shift next shipping date
    let newNextShippingDate = addDays(sub.nextShippingDate, pausedDays);

    // 4️⃣ Align with delivery days
    const deliveryDays = sub.deliveryDays.split(",");
    const dayMap = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };

    for (let i = 0; i < 14; i++) {
      if (deliveryDays.some(d => dayMap[d] === newNextShippingDate.getDay())) {
        break;
      }
      newNextShippingDate = addDays(newNextShippingDate, 1);
    }

    // 5️⃣ Update subscription
    await prisma.subscription.update({
      where: { id },
      data: {
        status: "active",
        pausedAt: null,
        nextShippingDate: newNextShippingDate,
        subscriptionEndDate: newEndDate,
      },
    });

    // 🔔 Send "Subscription Resumed" email
    try {
      await sendEmail({
        to: sub.customer.email,
        subject: "Your Subscription is Resumed",
        html: `
          <h2>Hi ${sub.customer.name},</h2>
          <p>Your subscription for <strong>${sub.product}</strong> is now active again.</p>
          <p>Next delivery: ${newNextShippingDate.toDateString()}</p>
          <p>— Team</p>
        `,
      });
    } catch (err) {
      console.error("Failed to send resume subscription email:", err);
    }

    console.log("▶️ Subscription resumed:", {
      pausedDays,
      newNextShippingDate,
      newEndDate,
    });

    res.redirect(
      "/customer/dashboard?email=" + encodeURIComponent(req.query.email)
    );
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
import { addDays, nextDay } from "date-fns"; // npm i date-fns

app.post("/create-subscription", async (req, res) => {
  try {
    const {
      name,
      email,
      contact,
      product,
      variantId, // (kept, not used here)
      frequency,
      quantity,
      period,
      deliveryDays, // ["Mon","Thu"]
      totalAmount,
      address
    } = req.body;

    // ===============================
    // 1️⃣ Get or create customer
    // ===============================
    let dbCustomer = await prisma.customer.findUnique({ where: { email } });
    const rzCustomer = await getOrCreateRazorpayCustomer(name, email, contact);

    if (!dbCustomer) {
      const randomPassword = crypto.randomBytes(4).toString("hex");

      dbCustomer = await prisma.customer.create({
        data: {
          name,
          email,
          contact: contact || null,
          razorpayId: rzCustomer.id,
          password: randomPassword,
          address: address || null, // ✅ store default address
        },
      });
    } else {
      dbCustomer = await prisma.customer.update({
        where: { email },
        data: {
          razorpayId: dbCustomer.razorpayId || rzCustomer.id,
          name,
          contact: contact || null,
          address: address || dbCustomer.address, // ✅ update last-used address
        },
      });
    }
// ===============================
// 🔍 Check delivery fee eligibility
// ===============================
let finalDeliveryFee = 0;

// fetch active + stopped subscriptions
const previousSubs = await prisma.subscription.findMany({
  where: {
    customerId: dbCustomer.id,
    status: { in: ["active", "stopped"] },
  },
  select: {
    totalAmount: true,
  },
});

// condition 1: any previous subscription above 5000
const hasHighValueSub = previousSubs.some(
  (sub) => sub.totalAmount > 5000
);

// condition 2: current subscription total above 5000
const currentIsHighValue = totalAmount > 5000;

// final rule
if (!hasHighValueSub && !currentIsHighValue) {
  finalDeliveryFee = 60 * period;
}


    // ===============================
    // 2️⃣ Create Razorpay Order
    // ===============================
    const finalPayableAmount = totalAmount + finalDeliveryFee;

const order = await razorpay.orders.create({
  amount: Math.round(finalPayableAmount * 100),
  currency: "INR",
  receipt: `rcpt_${Date.now()}`,
  notes: {
    product,
    frequency: frequency.toString(),
    quantity: quantity.toString(),
    period: period.toString(),
    deliveryDays: deliveryDays?.join(",") || "",
    baseAmount: totalAmount.toString(),
    deliveryFee: finalDeliveryFee.toString(),
  },
});


    // ===============================
    // 3️⃣ Calculate subscriptionEndDate
    // ===============================
    const now = new Date();
    const subscriptionEndDate = addDays(now, period * 7);

    // ===============================
    // 4️⃣ Calculate first nextShippingDate
    // ===============================
    const dayMap = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
    let nextShippingDate = null;

    for (let i = 1; i <= 7; i++) {
      const candidate = addDays(now, i);
      if (deliveryDays.some(d => dayMap[d] === candidate.getDay())) {
        nextShippingDate = candidate;
        break;
      }
    }

    if (!nextShippingDate) {
      return res.status(400).json({ error: "Invalid delivery days" });
    }

    // ===============================
    // 5️⃣ Store subscription (NO Shopify order here ❌)
    // ===============================
   const sub = await prisma.subscription.create({
  data: {
    razorpayOrderId: order.id,
    product,
    variantId,
    frequency: frequency.toString(),
    quantity,
    period,
    deliveryDays: deliveryDays.join(","),
    totalAmount,
    deliveryFee: finalDeliveryFee, // ✅ correct fee
    status: "pending",
    customerId: dbCustomer.id,
    isOneTimePurchase: false,
    subscriptionEndDate,
    nextShippingDate,
    address: address || null,
  },
});

// 6️⃣ Send Welcome Email
try {
  await sendWelcomeEmail(dbCustomer, sub);
} catch (err) {
  console.error("Failed to send welcome email:", err);
}

    res.json({
      order,
      subscription: sub,
      customer: dbCustomer,
    });

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

    // ===============================
    // 1️⃣ Verify Razorpay signature
    // ===============================
    const body = razorpay_order_id + "|" + razorpay_payment_id;

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_SECRET)
      .update(body)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ error: "Invalid payment signature" });
    }

    // ===============================
    // 2️⃣ Activate subscription
    // ===============================
    const subscription = await prisma.subscription.update({
      where: { razorpayOrderId: razorpay_order_id },
      data: {
        status: "active",
        razorpayPaymentId: razorpay_payment_id,
        paidAt: new Date(),
      },
    });

    res.json({
      success: true,
      subscription,
    });

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
