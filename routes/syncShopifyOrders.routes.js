import express from "express";
import { syncShopifyOrders, syncRecentOrders, syncAllOrders } from "../utils/syncShopifyOrders.js";

const router = express.Router();

/**
 * Manually trigger sync of recent orders (last 7 days)
 */
router.post("/sync-recent", async (req, res) => {
  try {
    console.log("🔄 Manual sync triggered for recent orders");
    const result = await syncRecentOrders();
    
    res.json({
      success: true,
      message: "Sync completed",
      ...result
    });
  } catch (error) {
    console.error("Sync error:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Sync orders with custom parameters
 */
router.post("/sync-custom", async (req, res) => {
  try {
    const { limit, sinceId, createdAtMin, status, fulfillmentStatus } = req.body;
    
    console.log("🔄 Manual sync triggered with custom params");
    const result = await syncShopifyOrders({
      limit: limit || 50,
      sinceId,
      createdAtMin,
      status: status || "any",
      fulfillmentStatus: fulfillmentStatus || "shipped" // ← Default to fulfilled only
    });
    
    res.json({
      success: true,
      message: "Sync completed",
      ...result
    });
  } catch (error) {
    console.error("Sync error:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Sync ALL orders (use with caution)
 */
router.post("/sync-all", async (req, res) => {
  try {
    console.log("⚠️  Manual sync triggered for ALL orders");
    
    // Start sync in background
    syncAllOrders()
      .then(count => console.log(`✅ Background sync completed: ${count} orders`))
      .catch(err => console.error("❌ Background sync failed:", err));
    
    res.json({
      success: true,
      message: "Full sync started in background. Check server logs for progress."
    });
  } catch (error) {
    console.error("Sync error:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;