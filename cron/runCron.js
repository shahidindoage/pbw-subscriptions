import prisma from "../utils/prisma.js";
import { runSubscriptionScheduler } from "./subscriptionScheduler.js";

console.log("🕒 Render cron started");

try {
  await runSubscriptionScheduler();
  console.log("✅ Scheduler completed successfully");
} catch (err) {
  console.error("❌ Scheduler failed:", err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();   // ✅ HERE
  console.log("🔌 Prisma disconnected");
  process.exit();
}
