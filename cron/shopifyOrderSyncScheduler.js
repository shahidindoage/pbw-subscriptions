import axios from "axios";
import { getShopifyToken } from "../utils/shopifyTokenManager.js";
import prisma from "../utils/prisma.js";

export async function runShopifyOrderSync() {
  console.log("⏱ Running Shopify order sync job...");

  const accessToken = await getShopifyToken();

  const response = await axios.get(
    `https://${process.env.SHOPIFY_STORE}/admin/api/2026-01/orders.json?status=any&fulfillment_status=fulfilled&limit=50`,
    {
      headers: {
        "X-Shopify-Access-Token": accessToken,
      },
    }
  );

  const shopifyOrders = response.data.orders;

  let updated = 0;
  let skipped = 0;

  for (const shopifyOrder of shopifyOrders) {
    const shopifyOrderId = shopifyOrder.id.toString();

    const dbOrder = await prisma.shopifyOrder.findFirst({
      where: { shopifyOrderId },
    });

    if (!dbOrder) {
      console.log(`⚠️ Order ${shopifyOrderId} not found in DB`);
      continue;
    }

    if (dbOrder.status === "created") {
      await prisma.shopifyOrder.update({
        where: { id: dbOrder.id },
        data: { status: "processing" },
      });

      console.log(`✅ Updated ${shopifyOrderId} → processing`);
      updated++;
    } else {
      console.log(
        `⏭ Skipped ${shopifyOrderId}, current status: ${dbOrder.status}`
      );
      skipped++;
    }
  }

  console.log("✅ Shopify sync job completed");

  return { updated, skipped };
}
