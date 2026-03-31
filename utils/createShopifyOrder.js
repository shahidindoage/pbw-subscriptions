import axios from "axios";
import { getShopifyToken } from "./shopifyTokenManager.js";

async function getShopifyCustomerId(email, accessToken) {
  try {
    const res = await axios.get(
      `https://${process.env.SHOPIFY_STORE}/admin/api/2026-01/customers/search.json?query=email:${email}`,
      {
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
      }
    );
    const existing = res.data.customers?.[0];
    return existing ? existing.id : null;
  } catch (err) {
    console.warn("⚠️ Customer lookup failed, will create new:", err.message);
    return null;
  }
}

export async function createShopifyOrder(orderData) {
  try {
    const accessToken = await getShopifyToken();

    // ✅ Look up existing Shopify customer by email
    const email = orderData.order?.customer?.email;

    if (email) {
      const shopifyCustomerId = await getShopifyCustomerId(email, accessToken);

      if (shopifyCustomerId) {
        // ✅ Use existing customer ID — avoids "email already taken" error
        orderData.order.customer = { id: shopifyCustomerId };
      }
    }

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