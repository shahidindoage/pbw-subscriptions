import cron from "node-cron";
import { runSubscriptionScheduler } from "./subscriptionScheduler.js";

cron.schedule("5,10,15,20,25,30 9 * * *", async () => {
  console.log("⏰ Running (9:05–9:30)");
  await runSubscriptionScheduler();
}, {
  timezone: "Asia/Kolkata"
});