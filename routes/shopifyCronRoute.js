import express from "express";
import { runShopifyOrderSync } from "../cron/shopifyOrderSyncScheduler.js";

const router = express.Router();

router.get("/run-shopify-sync", async (req, res) => {
  // 🔐 Protect route
  if (req.headers["x-cron-secret"] !== process.env.CRON_SECRET) {
    return res.status(401).send("Unauthorized");
  }

  try {
    const result = await runShopifyOrderSync();

    return res.status(200).json({
      success: true,
      message: "✅ Shopify cron executed successfully",
      ...result,
    });

  } catch (error) {
    console.error("❌ Shopify sync failed:", error);
    return res.status(500).json({
      success: false,
      error: error.response?.data || error.message,
    });
  }
});

export default router;
