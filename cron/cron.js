import cron from "node-cron";
import { runSubscriptionScheduler } from "./subscriptionScheduler";

cron.schedule("35,40,45,50,55,60 12 * * *", async () => {
  console.log("⏰ Running (9:05–9:30)");
  await runSubscriptionScheduler();
}, {
  timezone: "Asia/Kolkata"
});