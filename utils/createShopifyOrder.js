import axios from "axios";
import { getShopifyToken } from "./shopifyTokenManager.js";

export async function createShopifyOrder(orderData) {
  try {
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

  } catch (error) {
    console.error("❌ Shopify Order Creation Failed");
    console.error("Status:", error.response?.status);
    console.error(
      "Error Body:",
      JSON.stringify(error.response?.data, null, 2)
    );
    throw error;
  }
}