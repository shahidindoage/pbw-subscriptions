import prisma from "../utils/prisma.js";
import { runSubscriptionScheduler } from "./subscriptionScheduler.js";

console.log("🕒 Cron job started");

try {
  await runSubscriptionScheduler();
  console.log("✅ Scheduler completed successfully");
} catch (err) {
  console.error("❌ Scheduler failed:", err);
  process.exitCode = 1; // cron-job.org marks job as failed
} finally {
  await prisma.$disconnect();
  console.log("🔌 Prisma disconnected");
}
