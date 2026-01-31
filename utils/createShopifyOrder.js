
import axios from "axios";
import { getShopifyToken } from "./shopifyTokenManager.js";

export async function createShopifyOrder(orderData) {
  const accessToken = await getShopifyToken();

  const res = await axios.post(
    `https://${process.env.SHOPIFY_STORE}/admin/api/2026-01/orders.json`,
    orderData,
    {
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
    }
  );

  return res.data;
}
