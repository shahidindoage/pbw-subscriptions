import express from "express";
import bodyParser from "body-parser";
import Razorpay from "razorpay";
import dotenv from "dotenv";
import cors from "cors";
import prisma from "./utils/prisma.js"; // Prisma client
import session from "express-session";
import crypto from "crypto";
import axios from "axios";
import {fulfillShopifyOrder  } from "./utils/shopifyFulfillmentManager.js";
// import "./cron/shopifyOrderScheduler.js";
// import "./cron/runCron.js"  
// import { addDays } from "date-fns";
import archiver from "archiver";
import cronRoutes from "./routes/cron.js";
import { getOrderStatusEmail, sendSubscriptionCancelledEmail, sendSubscriptionResumedEmail, sendSubscriptionStoppedEmail, sendWelcomeEmail } from "./utils/email.js";
import { sendEmail } from "./utils/email.js";
import { addDays, nextDay, differenceInHours  } from "date-fns"; // npm i date-fns
import cloudinary from "./utils/cloudinary.js";
import { getVariantByProductAndFrequency } from "./utils/getVariantByProductAndFrequency.js";
import shopifyCronRoute from "./routes/shopifyCronRoute.js";
import { getShopifyToken } from "./utils/shopifyTokenManager.js";
import { buildShipmentRecords, generateShipmentDates, toDateKey } from "./utils/shipmentUtils.js";


import shopifyWebhookRoutes from "./routes/shopifyWebhook.routes.js";
import { generateRegularInvoiceBuffer } from "./utils/generateRegularInvoice.js";
import { uploadInvoiceToDropbox } from "./utils/dropbox.js";
import syncShopifyOrdersRoutes from "./routes/syncShopifyOrders.routes.js";  // ← ADD THIS
import { syncSubscriptionFulfillment } from "./utils/syncSubscriptionFulfillment.js";
// import { startShopifyOrderSync } from "./cron/shopifyOrderSync.js";           // ← ADD THIS

dotenv.config();

const app = express();



// app.get("/dropbox/auth", (req, res) => {
//   const authUrl = `https://www.dropbox.com/oauth2/authorize?client_id=${CLIENT_ID}&response_type=code&token_access_type=offline&redirect_uri=${REDIRECT_URI}`;

//   res.redirect(authUrl);
// });


// app.get("/dropbox/callback", async (req, res) => {
//   const code = req.query.code;

//   if (!code) {
//     return res.send("No authorization code received");
//   }

//   try {
//     const response = await axios.post(
//       "https://api.dropboxapi.com/oauth2/token",
//       new URLSearchParams({
//         code: code,
//         grant_type: "authorization_code",
//         client_id: CLIENT_ID,
//         client_secret: CLIENT_SECRET,
//         redirect_uri: REDIRECT_URI,
//       }),
//       {
//         headers: {
//           "Content-Type": "application/x-www-form-urlencoded",
//         },
//       }
//     );

//     console.log("TOKENS:", response.data);

//     res.json({
//       message: "Success",
//       refresh_token: response.data.refresh_token,
//       access_token: response.data.access_token,
//     });

//   } catch (error) {
//     console.error(error.response?.data || error.message);
//     res.status(500).send("Token exchange failed");
//   }
// });


app.set("view engine", "ejs");
app.set("views", "./views");

// ===== Middleware =====
app.use(cors());
app.use(express.static("public"));
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
app.use("/api/cron", shopifyCronRoute);
app.use("/admin/sync-shopify-orders", syncShopifyOrdersRoutes);
// ===== Razorpay Client =====
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY,
  key_secret: process.env.RAZORPAY_SECRET,
});

app.get("/api/products", async (req, res) => {
  try {
    const accessToken = await getShopifyToken();

    const response = await axios.get(
      `https://${process.env.SHOPIFY_STORE}/admin/api/2026-01/products.json`,
      {
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
        params: {
          fields: "id,title",
          limit: 250
        }
      }
    );

    const products = response.data.products || [];

    // Return only id + name
    const formatted = products.map(p => ({
      id: p.id,
      name: p.title
    }));

    res.json(formatted);

  } catch (error) {
    console.error("Error fetching products:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to fetch products" });
  }
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
    // ✅ Only orders that have invoice
  const invoices = await prisma.shopifyOrder.findMany({
  where: {
    invoiceUrl: {
      not: null,
    },
    status: "fulfilled", // ✅ only fulfilled orders
  },
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
    invoices, // ✅ pass invoices
  });
});
app.post("/admin/shopify-order/:id/status", isAdmin, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  // 1️⃣ Get order with relations
  const order = await prisma.shopifyOrder.findUnique({
    where: { id },
    include: {
      subscription: {
        include: {
          customer: true,
        },
      },
    },
  });

  if (!order) {
    return res.status(404).send("Order not found");
  }

  // ⛔ Prevent duplicate email if same status selected again
  if (order.status === status) {
    return  res.redirect("/admin/dashboard?page=shopify-orders");
  }

  // 🔥 If created → processing → fulfill Shopify
if (order.shopifyOrderId && order.status === "created" && status === "processing")
{
  try {
    await fulfillShopifyOrder(order.shopifyOrderId);
  } catch (err) {
    console.error("Shopify fulfillment error:", err);
  }
}


  // 2️⃣ Update status
  await prisma.shopifyOrder.update({
    where: { id },
    data: { status },
  });

  // 3️⃣ Send email (if applicable)
  try {
    const emailData = getOrderStatusEmail({
      status,
      customerName: order.subscription.customer.name || "there",
      product: order.subscription.product,
      orderNumber: order.order_number,
      shippingDate: order.shippingDate,
      orderLink: `https://pbwfoods.com/account/orders/${order.order_status_url}`,
    });

    if (emailData) {
      await sendEmail({
        to: order.subscription.customer.email,
        subject: emailData.subject,
        html: emailData.html,
      });

      console.log(`📧 Status email sent: ${status}`);
    }
  } catch (err) {
    console.error("❌ Failed to send status email:", err);
  }

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
      order_number: o.order_number
    }))
  );
});
app.post("/admin/sync-subscription-fulfillment", async (req, res) => {

  try {

    const result = await syncSubscriptionFulfillment();

    res.json(result);

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Sync failed"
    });

  }

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
  const dayMap = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };

  // ✅ Fetch subscription first (needed for stop/resume logic)
  const sub = await prisma.subscription.findUnique({
    where: { id },
    include: { customer: true },
  });

  if (!sub) return res.redirect("/admin/subscriptions");

  let data = {};
  let mailType = null;
  const now = new Date();

  // ===============================
  // STOP
  // ===============================
  if (action === "stop") {
    if (sub.pausedAt) return res.redirect("/admin/subscriptions"); // already stopped

    data = {
      status: "stopped",
      pausedAt: now,
    };
    mailType = "stopped";
  }

  // ===============================
  // RESUME  ← fixed: recalculates nextShippingDate
  // ===============================
  if (action === "resume") {
    if (!sub.pausedAt) return res.redirect("/admin/subscriptions"); // not paused

    // Calculate how many days it was paused
    const pausedMs = now.getTime() - sub.pausedAt.getTime();
    const pausedDays = Math.max(0, Math.floor(pausedMs / (1000 * 60 * 60 * 24)));

    // Shift both nextShippingDate and subscriptionEndDate forward by paused days
    let newNextShippingDate = addDays(sub.nextShippingDate, pausedDays);
    const newEndDate = addDays(sub.subscriptionEndDate, pausedDays);

    // Snap to nearest valid delivery day (within 14-day window)
    const deliveryDays = sub.deliveryDays?.split(",") || [];
    for (let i = 0; i < 14; i++) {
      if (deliveryDays.some(d => dayMap[d] === newNextShippingDate.getDay())) break;
      newNextShippingDate = addDays(newNextShippingDate, 1);
    }

    // Ensure it's not in the past
    if (newNextShippingDate < now) newNextShippingDate = now;

    data = {
      status: "active",
      pausedAt: null,
      nextShippingDate: newNextShippingDate,
      subscriptionEndDate: newEndDate,
    };
    mailType = "resumed";
  }

  // ===============================
  // CANCEL
  // ===============================
  if (action === "cancel") {
    data = {
      status: "cancelled",
      cancelledAt: now,
      pausedAt: null,
      nextShippingDate: null,
    };
    mailType = "cancelled";
  }

  if (!Object.keys(data).length) {
    return res.redirect("/admin/subscriptions");
  }

  // ✅ Update subscription
  const subscription = await prisma.subscription.update({
    where: { id },
    data,
    include: { customer: true },
  });

  // ✅ Send email (non-blocking)
  try {
    if (mailType === "stopped") {
      await sendSubscriptionStoppedEmail(subscription.customer, subscription);
    }
    if (mailType === "resumed") {
      await sendSubscriptionResumedEmail(subscription.customer, subscription);
    }
    if (mailType === "cancelled") {
      await sendSubscriptionCancelledEmail(subscription.customer, subscription);
    }
  } catch (err) {
    console.error("Admin subscription email failed:", err);
  }

  res.redirect("/admin/subscriptions");
});
app.get("/invoice/download/:id", async (req, res) => {
  try {
    const order = await prisma.shopifyOrder.findUnique({
      where: { id: req.params.id }
    });

    if (!order?.invoiceUrl) {
      return res.status(404).send("Invoice not found");
    }

    // Extract public_id correctly
    // Remove everything before "/invoices/"
    const urlParts = order.invoiceUrl.split("/invoices/");
    if (!urlParts[1]) throw new Error("Invalid invoice URL");

    const publicId = `invoices/${urlParts[1].replace(".pdf", "")}`;

    // Generate signed download URL
    const signedUrl = cloudinary.utils.private_download_url(
      publicId,
      "pdf",
      {
        resource_type: "raw",
        attachment: true,
      }
    );

    // Redirect to Cloudinary signed URL
    return res.redirect(signedUrl);

  } catch (err) {
    console.error("Download error:", err);
    res.status(500).send("Download failed");
  }
});

app.post("/admin/export-invoices", async (req, res) => {
  try {
    const { ids } = req.body;

    const invoices = await prisma.shopifyOrder.findMany({
      where: {
        id: { in: ids },
        invoiceUrl: { not: null },
      },
    });

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");

    const zipName = `Invoices-${year}-${month}.zip`;

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${zipName}`
    );

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.pipe(res);

    for (const invoice of invoices) {
      const response = await axios.get(
        invoice.invoiceUrl.replace("dl=0", "raw=1"),
        { responseType: "arraybuffer" }
      );

      archive.append(response.data, {
        name: `${invoice.invoiceNumber}.pdf`,
      });
    }

    await archive.finalize();

  } catch (err) {
    console.error("Bulk export failed:", err);
    res.status(500).json({ error: "Bulk export failed" });
  }
});
app.post("/admin/export-invoices-by-range", async (req, res) => {
  try {
    const { range } = req.body;

    if (!range) {
      return res.status(400).json({ error: "Range is required" });
    }

    const now = new Date();
    let startDate = new Date(now); // ✅ important: clone now

    // 🎯 Calculate date range safely
    if (range === "7") {
      startDate.setDate(now.getDate() - 7);
    } 
    else if (range === "14") {
      startDate.setDate(now.getDate() - 14);
    } 
    else if (range === "1m") {
      startDate.setMonth(now.getMonth() - 1);
    } 
    else if (range === "6m") {
      startDate.setMonth(now.getMonth() - 6);
    } 
    else {
      return res.status(400).json({ error: "Invalid range value" });
    }

    // 📦 Fetch invoices
    const invoices = await prisma.shopifyOrder.findMany({
  where: {
    invoiceUrl: { not: null },
    status: {
      not: "created",   // ✅ Exclude created
    },
    shippingDate: {
      gte: startDate,
      lte: now,
    },
  },
});


    if (!invoices.length) {
      return res.status(404).json({ error: "No invoices found" });
    }

    // 📅 Format date helper
    const formatDate = (date) =>
      date.toISOString().split("T")[0];

    let rangeLabel = "";

    if (range === "7") rangeLabel = "Last-7-Days";
    else if (range === "14") rangeLabel = "Last-14-Days";
    else if (range === "1m") rangeLabel = "Last-1-Month";
    else if (range === "6m") rangeLabel = "Last-6-Months";

    const zipName = `Invoices-${rangeLabel}-${formatDate(now)}.zip`;

    // 📨 Set headers
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${zipName}"`
    );

    const archive = archiver("zip", { zlib: { level: 9 } });

    archive.on("error", (err) => {
      console.error("Archive error:", err);
      res.status(500).end();
    });

    archive.pipe(res);

    // 📂 Add invoices to ZIP
    for (const invoice of invoices) {
      try {
        const fileUrl = invoice.invoiceUrl.replace("dl=0", "raw=1");

        const response = await axios.get(fileUrl, {
          responseType: "arraybuffer",
        });

        archive.append(response.data, {
          name: `${invoice.invoiceNumber}.pdf`,
        });

      } catch (err) {
        console.error("Failed invoice:", invoice.id);
      }
    }

    await archive.finalize();

  } catch (err) {
    console.error("Export by range failed:", err);
    res.status(500).json({ error: "Export failed" });
  }
});
app.post("/admin/export-invoices-email", async (req, res) => {
  try {
    const {  email } = req.body;

   

    // ✅ Fetch invoices (exclude created)
    const invoices = await prisma.shopifyOrder.findMany({
  where: {
    invoiceUrl: { not: null },
    status: { not: "created" }, // exclude created

    subscription: {
      customer: {
        email: {
          equals: email,
          mode: "insensitive", // case-insensitive match
        },
      },
    },
  },
});

    if (!invoices.length) {
      return res.status(404).json({ error: "No valid invoices found" });
    }

    const now = new Date();
    const zipName = `Invoices-${now.toISOString().split("T")[0]}.zip`;

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${zipName}"`
    );

    const archive = archiver("zip", { zlib: { level: 9 } });

    archive.on("error", (err) => {
      console.error("Archive error:", err);
      res.status(500).end();
    });

    archive.pipe(res);

    for (const invoice of invoices) {
      try {
        const fileUrl = invoice.invoiceUrl.replace("dl=0", "raw=1");

        const response = await axios.get(fileUrl, {
          responseType: "arraybuffer",
        });

        archive.append(response.data, {
          name: `${invoice.invoiceNumber}.pdf`,
        });

      } catch (err) {
        console.error("Failed invoice:", invoice.id);
      }
    }

    await archive.finalize();

    // Optional: log email for tracking
    if (email) {
      console.log(`Invoices exported by: ${email}`);
    }

  } catch (err) {
    console.error("Export failed:", err);
    res.status(500).json({ error: "Export failed" });
  }
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
      where: { status: { in: ["active", "stopped","cancelled"] } }, // include stopped too
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

    if (!sub) return res.status(404).send("Subscription not found");

    // ✅ Already paused
    if (sub.pausedAt) {
      return res.redirect(
        "/customer/dashboard?email=" + encodeURIComponent(req.query.email)
      );
    }

    // ✅ Check nextShippingDate exists
    if (!sub.nextShippingDate) {
      return res.status(400).send("Subscription has no upcoming delivery");
    }

    const now = new Date();
    const hoursToNext = differenceInHours(sub.nextShippingDate, now);

    // ✅ Cannot pause within 24 hours of delivery
    if (hoursToNext <= 24) {
      return res
        .status(400)
        .send("Cannot pause subscription within 24 hours of next delivery");
    }

    // ✅ Pause subscription
    const pausedAt = now > sub.nextShippingDate ? sub.nextShippingDate : now;

    await prisma.subscription.update({
      where: { id },
      data: {
        status: "stopped",
        pausedAt,
      },
    });

    // 🔔 Send stop email
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

// =========================
// Resume Subscription
// =========================
app.post("/customer/subscription/:id/resume", async (req, res) => {
  try {
    const { id } = req.params;

    const sub = await prisma.subscription.findUnique({
      where: { id },
      include: { customer: true },
    });

    if (!sub) return res.status(404).send("Subscription not found");

    // ✅ Only resume if paused
    if (!sub.pausedAt) {
      return res.redirect(
        "/customer/dashboard?email=" + encodeURIComponent(req.query.email)
      );
    }

    const now = new Date();

    // ✅ Calculate paused days safely
    let pausedMs = now.getTime() - sub.pausedAt.getTime();
    const pausedDays = Math.max(0, Math.floor(pausedMs / (1000 * 60 * 60 * 24)));

    // ✅ Extend end date
    const newEndDate = addDays(sub.subscriptionEndDate, pausedDays);

    // ✅ Shift nextShippingDate
    let newNextShippingDate = addDays(sub.nextShippingDate, pausedDays);

    // ✅ Align with delivery days
    const deliveryDays = sub.deliveryDays?.split(",") || [];
    const dayMap = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };

    if (deliveryDays.length === 0) {
      return res.status(400).send("Subscription has no delivery days set");
    }

    for (let i = 0; i < 14; i++) {
      if (deliveryDays.some(d => dayMap[d] === newNextShippingDate.getDay())) break;
      newNextShippingDate = addDays(newNextShippingDate, 1);
    }

    // ✅ Ensure nextShippingDate >= today
    if (newNextShippingDate < now) newNextShippingDate = now;

    // ✅ Update subscription
    await prisma.subscription.update({
      where: { id },
      data: {
        status: "active",
        pausedAt: null,
        nextShippingDate: newNextShippingDate,
        subscriptionEndDate: newEndDate,
      },
    });

    // 🔔 Send resume email
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

function ist11AMToUTC(date) {
  const d = new Date(date);
  d.setHours(11, 0, 0, 0);        // 11:00 AM IST (logical)
  return new Date(d.getTime() - (5.5 * 60 * 60 * 1000)); // IST → UTC
}
function ist9AMToUTC(date) {
  const d = new Date(date);
  d.setHours(9, 0, 0, 0);
  return new Date(d.getTime() - (5.5 * 60 * 60 * 1000));
}
function calculateDeliveryFee(totalAmount, previousSubs, period, frequency) {
  let frequencyCount = 1;

  if (frequency.toLowerCase().includes("twice")) {
    frequencyCount = 2;
  } else if (frequency.toLowerCase().includes("thrice")) {
    frequencyCount = 3;
  }

  const hasHighValueSub = previousSubs.some(s => s.totalAmount > 5000);
  const currentIsHighValue = totalAmount > 5000;

  if (!hasHighValueSub && !currentIsHighValue) {
    return 60 * period * frequencyCount;
  }

  return 0;
}
// function generateRealShipmentDates(startDate, period, deliveryDays) {
//   const dates = [];
//   const dayMap = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };

//   const allowedDays = deliveryDays.map(d => dayMap[d]);

//   const base = new Date(startDate);
//   base.setHours(0,0,0,0);

//   for (let week = 0; week < period; week++) {
//     for (let day = 0; day < 7; day++) {
//       const current = new Date(base);
//       current.setDate(base.getDate() + week * 7 + day);

//       if (allowedDays.includes(current.getDay())) {
//         dates.push(current.toDateString());
//       }
//     }
//   }

//   return dates;
// }
app.post("/create-subscription", async (req, res) => {
  try {
    const {
      name,
      email,
      contact,
      product,
      variantId,
      frequency,
      quantity,
      period,
      deliveryDays,
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
          address: address || null,
        },
      });
    } else {
      dbCustomer = await prisma.customer.update({
        where: { email },
        data: {
          razorpayId: dbCustomer.razorpayId || rzCustomer.id,
          name,
          contact: contact || null,
          address: address || dbCustomer.address,
        },
      });
    }

    // ===============================
    // 2️⃣ Calculate nextShippingDate FIRST
    // ===============================
    const now = new Date();
    const dayMap = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
    const todayDay = now.getDay();
    const cutoff = new Date(now);
    cutoff.setHours(9, 0, 0, 0);

    const minShippingTime = addDays(now, 1);

    let nextShippingDate = null;

    for (let i = 0; i <= 14; i++) {
      const candidate = addDays(now, i);
      const candidateDay = candidate.getDay();

      if (!deliveryDays.some(d => dayMap[d] === candidateDay)) continue;

      const shippingUTC = ist9AMToUTC(candidate);

      if (shippingUTC < minShippingTime) continue;

      if (todayDay === dayMap["Sun"] && candidateDay === dayMap["Mon"]) continue;

      if (todayDay === dayMap["Sat"] && now >= cutoff && candidateDay === dayMap["Mon"]) {
  continue;
}

      if (candidateDay === todayDay && now >= cutoff) continue;

      nextShippingDate = shippingUTC;
      break;
    }

    if (!nextShippingDate) {
      throw new Error("No valid next shipping date found");
    }
// ===============================
// 3️⃣ Delivery Fee Logic
// ===============================

const parsedPeriod = Number(period);          // ✅ declare here
const parsedTotalAmount = Number(totalAmount); // ✅ declare here

const previousShipments = await prisma.subscriptionShipment.findMany({
  where: {
    subscription: {
      customerId: dbCustomer.id,
       status: "active",
    },
    status: "scheduled",
  },
  select: { shippingDate: true },
});

const existingDateKeys = new Set(
  previousShipments.map((s) => toDateKey(s.shippingDate))
);

const newShipmentDates = generateShipmentDates(
  nextShippingDate,
  parsedPeriod,
  deliveryDays
);

const previousSubs = await prisma.subscription.findMany({
  where: { 
    customerId: dbCustomer.id, 
     status: "active",
  },
  select: { totalAmount: true },
});

const hasHighValueSub = previousSubs.some((s) => s.totalAmount > 5000);
const currentIsHighValue = parsedTotalAmount > 5000;
const waiveAll = hasHighValueSub || currentIsHighValue;

const { shipmentRecords, finalDeliveryFee } = buildShipmentRecords(
  newShipmentDates,
  existingDateKeys,
  waiveAll
);

    // ===============================
    // 4️⃣ Create Razorpay Order
    // ===============================
    const finalPayableAmount = parsedTotalAmount + finalDeliveryFee;

    const order = await razorpay.orders.create({
      amount: Math.round(finalPayableAmount * 100),
      currency: "INR",
      receipt: `rcpt_${Date.now()}`,
      notes: {
        product,
        frequency,
        quantity: quantity.toString(),
        period: period.toString(),
        deliveryDays: deliveryDays.join(","),
        baseAmount: parsedTotalAmount.toString(),
        deliveryFee: finalDeliveryFee.toString(),
      },
    });

    // ===============================
    // 5️⃣ End date
    // ===============================
    const subscriptionEndDate = addDays(nextShippingDate, parsedPeriod * 7);

    const sub = await prisma.subscription.create({
      data: {
        razorpayOrderId: order.id,
        product,
        variantId,
        frequency,
        quantity,
        period: parsedPeriod,
        deliveryDays: deliveryDays.join(","),
        totalAmount: parsedTotalAmount,
        deliveryFee: finalDeliveryFee,
        status: "pending",
        customerId: dbCustomer.id,
        isOneTimePurchase: false,
        subscriptionEndDate,
        nextShippingDate,
        address: address || null,
      },
    });


    await prisma.subscriptionShipment.createMany({
  data: shipmentRecords.map(s => ({
    subscriptionId: sub.id,
    shippingDate: s.shippingDate,
    isChargeable: s.isChargeable,
    deliveryFee: s.deliveryFee,
    status: "scheduled",
  })),
});

    // ===============================
    // 6️⃣ Welcome Email
    // ===============================
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

app.post("/admin/manual-subscription", isAdmin, async (req, res) => {
  try {
    const {
      name,
      email,
      contact,
      product,
      frequency,
      quantity,
      period,
      deliveryDays,
      address,
      subscriptionStartDate
    } = req.body;

    // ===============================
    // 1️⃣ Basic Validation
    // ===============================

    if (!name ) {
      return res.status(400).json({ error: "Missing required fields:name" });
    }
     if (!email ) {
      return res.status(400).json({ error: "Missing required fields:email" });
    }
     if ( !product ) {
      return res.status(400).json({ error: "Missing required fields:product" });
    }
     if (!frequency ) {
      return res.status(400).json({ error: "Missing required fields:freq" });
    }

     if (!quantity ) {
      return res.status(400).json({ error: "Missing required fields:quantity" });
    }
     if ( !period) {
      return res.status(400).json({ error: "Missing required fields:period" });
    }

    if (!subscriptionStartDate) {
      return res.status(400).json({ error: "Subscription start date required" });
    }

    const startDateRaw = new Date(subscriptionStartDate);
const startDate = new Date(startDateRaw.getTime() - (5.5 * 60 * 60 * 1000));
    if (isNaN(startDate.getTime())) {
      return res.status(400).json({ error: "Invalid start date" });
    }

    if (startDate < new Date()) {
      return res.status(400).json({ error: "Start date cannot be in the past" });
    }

    // Normalize deliveryDays (can be string if only one selected)
    let normalizedDeliveryDays = [];

    if (Array.isArray(deliveryDays)) {
      normalizedDeliveryDays = deliveryDays;
    } else if (typeof deliveryDays === "string") {
      normalizedDeliveryDays = [deliveryDays];
    }

    if (!normalizedDeliveryDays.length) {
      return res.status(400).json({ error: "At least one delivery day required" });
    }

    const parsedQuantity = Number(quantity);
    const parsedPeriod = Number(period);

    if (
      isNaN(parsedQuantity) ||
      isNaN(parsedPeriod) ||
      parsedQuantity <= 0 ||
      parsedPeriod <= 0
    ) {
      return res.status(400).json({ error: "Invalid quantity or period" });
    }

    // ===============================
    // 2️⃣ Frequency Multiplier
    // ===============================

    let frequencyMultiplier = 1;

    if (frequency === "Once a week" || frequency === "Once / Week") frequencyMultiplier = 1;
    else if (frequency === "Twice a week" || frequency === "Twice / Week") frequencyMultiplier = 2;
    else if (frequency === "Thrice a week" || frequency === "Thrice / Week") frequencyMultiplier = 3;
    else if (frequency === "Once a Month") frequencyMultiplier = 1;
    else if (frequency === "Twice a Month") frequencyMultiplier = 2;
    else {
      return res.status(400).json({ error: "Invalid frequency selected" });
    }

    const isMonthly = frequency === "Once a Month" || frequency === "Twice a Month";

    const dayMap = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };

    // ===============================
    // 3️⃣ Get or Create Customer
    // ===============================

    let dbCustomer = await prisma.customer.findUnique({
      where: { email }
    });

    if (!dbCustomer) {
      const randomPassword = crypto.randomBytes(4).toString("hex");

      dbCustomer = await prisma.customer.create({
        data: {
          name,
          email,
          contact: contact || null,
          password: randomPassword, // ⚠️ hash in production
          address: address || null,
        },
      });
    } else {
      dbCustomer = await prisma.customer.update({
        where: { email },
        data: {
          name,
          contact: contact || null,
          address: address || dbCustomer.address,
        },
      });
    }

    // ===============================
    // 4️⃣ Fetch Variant From Shopify
    // ===============================

    const variant = await getVariantByProductAndFrequency(product, frequency);

    if (!variant) {
      return res.status(400).json({ error: "Variant not found in Shopify" });
    }

    const variantId = variant.id.toString();
    const variantPrice = Number(variant.price);

    if (isNaN(variantPrice) || variantPrice <= 0) {
      return res.status(400).json({ error: "Invalid variant price" });
    }


    
if (normalizedDeliveryDays.length !== frequencyMultiplier) {
  return res.status(400).json({
    error: "Selected delivery days must match frequency"
  });
}
    // ✅ FINAL SECURE TOTAL CALCULATION
    // Weekly:  price × qty × period(weeks) × deliveries-per-week
    // Monthly: price × qty × months        × deliveries-per-month  (months = period / 4)
    const totalDeliveries = isMonthly
      ? (parsedPeriod / 4) * frequencyMultiplier
      : parsedPeriod * frequencyMultiplier;

    const parsedTotalAmount = variantPrice * parsedQuantity * totalDeliveries;

   

    // ===============================
    // 6️⃣ Shipping Date Calculation
    // ===============================

    const startDay = startDate.getDay();

    const cutoff = new Date(startDate);
    cutoff.setHours(9, 0, 0, 0);

    const minShippingTime = new Date(startDate.getTime() + 24 * 60 * 60 * 1000);

    let nextShippingDate = null;

    for (let i = 0; i <= 14; i++) {
      const candidate = addDays(startDate, i);
      const candidateDay = candidate.getDay();

      if (!normalizedDeliveryDays.some(d => dayMap[d] === candidateDay)) continue;

      const shippingUTC = ist9AMToUTC(candidate);

      if (shippingUTC < minShippingTime) continue;

      if (startDay === dayMap["Sun"] && candidateDay === dayMap["Mon"]) {
        continue;
      }


      // ✅ NEW: Skip Monday if start date is Saturday AFTER 9 AM
  if (startDay === dayMap["Sat"] && startDate >= cutoff && candidateDay === dayMap["Mon"]) {
    continue;
  }

      if (candidateDay === startDay && startDate >= cutoff) {
        continue;
      }

      nextShippingDate = shippingUTC;
      break;
    }

    if (!nextShippingDate) {
      return res.status(400).json({ error: "No valid next shipping date found" });
    }
const baseShippingDate = new Date(nextShippingDate);

     // ===============================
    // 5️⃣ Delivery Fee Logic
    // ===============================

    // ===============================
// 5️⃣ Delivery Fee Logic (Advanced Overlap Check)
// ===============================

// let finalDeliveryFee = 0;

// // 1️⃣ Get previous ACTIVE subscriptions
// const previousSubs = await prisma.subscription.findMany({
//   where: {
//     customerId: dbCustomer.id,
//     status: "active",
//   },
// });

// // 2️⃣ Helper to generate shipment dates
// function generateShipmentDates(startDate, period, frequencyMultiplier) {
//   const dates = [];
//   for (let week = 0; week < period; week++) {
//     for (let f = 0; f < frequencyMultiplier; f++) {
//       const date = addDays(startDate, week * 7 + (f * 2)); 
//       // ⚠ adjust if you have real weekday logic
//       dates.push(new Date(date).toDateString());
//     }
//   }
//   return dates;
// }

// // 3️⃣ Generate new subscription shipment dates
// const newShipmentDates = generateShipmentDates(
//   baseShippingDate,
//   parsedPeriod,
//   frequencyMultiplier
// );
// function getFrequencyMultiplier(freq) {
//   if (freq === "Once a week" || freq === "Once / Week") return 1;
//   if (freq === "Twice a week" || freq === "Twice / Week") return 2;
//   if (freq === "Thrice a week" || freq === "Thrice / Week") return 3;
//   return 1;
// }
// // 4️⃣ Collect existing shipment dates
// const existingShipmentDates = new Set();

// for (const sub of previousSubs) {
//   const subMultiplier = getFrequencyMultiplier(sub.frequency);

//   const subDates = generateShipmentDates(
//     sub.nextShippingDate,
//     sub.period,
//     subMultiplier
//   );

//   subDates.forEach(d => existingShipmentDates.add(d));
// }

// // 5️⃣ Charge only for non-overlapping dates
// const DELIVERY_PRICE = 60;

// let shipmentRecords = [];
// let chargeableDeliveries = 0;

// for (const date of newShipmentDates) {
//   const dateKey = new Date(date).toDateString();
//   const isChargeable = !existingShipmentDates.has(dateKey);

//   if (isChargeable) chargeableDeliveries++;

//   shipmentRecords.push({
//     shippingDate: new Date(date),
//     isChargeable,
//     deliveryFee: isChargeable ? DELIVERY_PRICE : 0,
//   });
// }

// // 6️⃣ Apply high value rule
// const hasHighValueSub = previousSubs.some(s => s.totalAmount > 5000);
// const currentIsHighValue = parsedTotalAmount > 5000;

// if (!hasHighValueSub && !currentIsHighValue) {
//   finalDeliveryFee = chargeableDeliveries * 60;
// }


// ===============================
// 5️⃣ Delivery Fee Logic (Correct Overlap Check)
// ===============================
// const { toDateKey, generateShipmentDates, buildShipmentRecords } = require("./lib/shipmentUtils");

// ===============================
// 5️⃣ Delivery Fee Logic
// ===============================

const previousShipments = await prisma.subscriptionShipment.findMany({
  where: {
    subscription: {
      customerId: dbCustomer.id,
      status: "active",
    },
    status: "scheduled",
  },
  select: { shippingDate: true },
});

const existingDateKeys = new Set(
  previousShipments.map((s) => toDateKey(s.shippingDate))
);

const newShipmentDates = generateShipmentDates(
  baseShippingDate,
  parsedPeriod,
  normalizedDeliveryDays,
  isMonthly
);

const previousSubs = await prisma.subscription.findMany({
  where: { customerId: dbCustomer.id, status: "active" },
  select: { totalAmount: true },
});

const hasHighValueSub = previousSubs.some((s) => s.totalAmount > 5000);
const currentIsHighValue = parsedTotalAmount > 5000;
const waiveAll = hasHighValueSub || currentIsHighValue;

const { shipmentRecords, finalDeliveryFee } = buildShipmentRecords(
  newShipmentDates,
  existingDateKeys,
  waiveAll
);
    // ===============================
    // 7️⃣ Subscription End Date
    // ===============================

    // Weekly: period weeks from first shipment
    // Monthly: period/4 months (≈ period weeks) from first shipment — same formula works
    const subscriptionEndDate = addDays(
      nextShippingDate,
      parsedPeriod * 7
    );

    // ===============================
    // 8️⃣ Create Subscription
    // ===============================

    const sub = await prisma.subscription.create({
      data: {
        razorpayOrderId: null,
        product,
        variantId,
        frequency,
        quantity: parsedQuantity,
        period: parsedPeriod,
        deliveryDays: normalizedDeliveryDays.join(","),
        totalAmount: parsedTotalAmount,
        deliveryFee: finalDeliveryFee,
        status: "active",
        customerId: dbCustomer.id,
        isOneTimePurchase: false,
        subscriptionEndDate,
        createdAt: startDate,
        nextShippingDate,
        address: address || null,
      },
    });
await prisma.subscriptionShipment.createMany({
  data: shipmentRecords.map(s => ({
    subscriptionId: sub.id,
    shippingDate: s.shippingDate,
    isChargeable: s.isChargeable,
    deliveryFee: s.deliveryFee,
    status: "scheduled",
  })),
});
    // ===============================
    // 9️⃣ Success Response
    // ===============================

    return res.redirect("/admin/subscriptions");

  } catch (err) {
    console.error("Manual subscription creation failed:", err);
    res.status(500).json({
      error: "Manual subscription creation failed",
      details: err.message
    });
  }
});

app.get("/api/get-variant-price", async (req, res) => {
  try {
    const { product, frequency } = req.query;

    if (!product || !frequency) {
      return res.status(400).json({ error: "Missing params" });
    }

    const variant = await getVariantByProductAndFrequency(product, frequency);

    if (!variant) {
      return res.status(404).json({ error: "Variant not found" });
    }

    // Works for Shopify REST or GraphQL
    const rawPrice = variant.price?.amount || variant.price;
    const numericPrice = Number(rawPrice);

    res.json({ price: numericPrice });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});
app.get("/admin/get-customer-by-email", isAdmin, async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const customer = await prisma.customer.findUnique({
      where: { email }
    });

    if (!customer) {
      return res.json({ exists: false });
    }

    return res.json({
      exists: true,
      customer: {
        name: customer.name,
        email: customer.email,
        contact: customer.contact,
        address: customer.address
      }
    });

  } catch (err) {
    console.error("Fetch customer error:", err);
    res.status(500).json({ error: "Server error" });
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



// ===== Regular Orders Admin Routes =====


// ===== Test Webhook Setup =====

// ===== Health Check =====
app.get("/", (req, res) => {
  res.send("Subscription backend running ✅");
});
app.get("/test/webhook-config", (req, res) => {
  res.json({
    webhookSecretConfigured: !!process.env.SHOPIFY_WEBHOOK_SECRET,
    webhookRoute: "/webhooks/shopify/orders/create",
    fullURL: `${req.protocol}://${req.get('host')}/webhooks/shopify/orders/create`,
    regularOrderModel: typeof prisma.regularOrder !== 'undefined',
  });
});
// List all regular orders
app.get("/admin/regular-orders", isAdmin, async (req, res) => {
  try {
    const orders = await prisma.regularOrder.findMany({
      orderBy: { orderCreatedAt: "desc" },
    });

    res.render("admin-regular-orders", { orders });
  } catch (error) {
    console.error("Error fetching regular orders:", error);
    res.status(500).send("Failed to fetch orders");
  }
});

// View single regular order details
app.get("/admin/regular-orders/:id", isAdmin, async (req, res) => {
  try {
    const order = await prisma.regularOrder.findUnique({
      where: { id: req.params.id },
    });

    if (!order) {
      return res.status(404).send("Order not found");
    }

    res.render("admin-regular-order-detail", { order });
  } catch (error) {
    console.error("Error fetching order:", error);
    res.status(500).send("Failed to fetch order");
  }
});

// Generate invoice for regular order (if it doesn't exist)
app.post("/admin/regular-orders/:id/generate-invoice", isAdmin, async (req, res) => {
  try {
    const order = await prisma.regularOrder.findUnique({
      where: { id: req.params.id },
    });

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    if (order.invoiceUrl) {
      return res.status(400).json({ error: "Invoice already exists" });
    }

    // Generate invoice
    const invoiceNumber = `INV-${order.orderNumber || order.shopifyOrderId}`;
    const invoiceBuffer = await generateRegularInvoiceBuffer(order, invoiceNumber);

    // Upload to Dropbox
    const invoiceUrl = await uploadInvoiceToDropbox(
      invoiceBuffer,
      `regular-orders/${invoiceNumber}.pdf`
    );

    // Update order
    await prisma.regularOrder.update({
      where: { id: order.id },
      data: {
        invoiceUrl,
        invoiceNumber,
      },
    });

    res.json({
      success: true,
      invoiceUrl,
      invoiceNumber,
    });
  } catch (error) {
    console.error("Invoice generation error:", error);
    res.status(500).json({
      error: "Failed to generate invoice",
      details: error.message,
    });
  }
});
// Clear all regular orders (with safety checks)
app.post("/admin/regular-orders/clear-all", isAdmin, async (req, res) => {
  try {
    console.log("⚠️  Admin requested to clear all regular orders");

    // Count orders before deletion
    const count = await prisma.regularOrder.count();

    if (count === 0) {
      return res.json({
        success: true,
        deletedCount: 0,
        message: "No orders to delete"
      });
    }

    // Delete all regular orders
    const result = await prisma.regularOrder.deleteMany({});

    console.log(`✅ Deleted ${result.count} regular orders`);

    res.json({
      success: true,
      deletedCount: result.count,
      message: `Successfully deleted ${result.count} orders`
    });

  } catch (error) {
    console.error("Error clearing orders:", error);
    res.status(500).json({
      success: false,
      error: "Failed to clear orders",
      details: error.message
    });
  }
});

// ===== END Regular Orders Routes =====
// ===== Start Server =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
