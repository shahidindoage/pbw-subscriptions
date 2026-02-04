import express from "express";
import prisma from "../utils/prisma.js";
import { runSubscriptionScheduler } from "../cron/subscriptionScheduler.js";

const router = express.Router();

router.get("/run", async (req, res) => {
  // 🔐 simple protection
  if (req.headers["x-cron-secret"] !== process.env.CRON_SECRET) {
    return res.status(401).send("Unauthorized");
  }

  try {
    await runSubscriptionScheduler();
    res.status(200).send("✅ Cron executed successfully");
  } catch (err) {
    console.error("❌ Cron failed:", err);
    res.status(500).send("❌ Cron failed");
  } finally {
    await prisma.$disconnect();
  }
});

export default router;
