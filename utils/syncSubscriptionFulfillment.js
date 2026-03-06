import axios from "axios";
import prisma from "../utils/prisma.js";
import { getShopifyToken } from "./shopifyTokenManager.js";

export async function syncSubscriptionFulfillment() {

  const accessToken = await getShopifyToken();

  const shopifyOrders = await prisma.shopifyOrder.findMany({
    where: {
      shopifyOrderId: {
        not: null
      }
    }
  });

  let updated = 0;

  for (const order of shopifyOrders) {

    try {

      const res = await axios.get(
        `https://${process.env.SHOPIFY_STORE}/admin/api/2024-01/orders/${order.shopifyOrderId}.json`,
        {
          headers: {
            "X-Shopify-Access-Token": accessToken,
            "Content-Type": "application/json"
          }
        }
      );

      const shopifyOrder = res.data.order;

      if (shopifyOrder.fulfillment_status === "fulfilled") {

        await prisma.shopifyOrder.update({
          where: { id: order.id },
          data: {
            status: "fulfilled"
          }
        });

        updated++;

      }

    } catch (error) {

      console.error("Error syncing order", order.shopifyOrderId);

    }

  }

  return {
    updated,
    total: shopifyOrders.length
  };

}