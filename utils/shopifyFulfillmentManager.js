import axios from "axios";
import { getShopifyToken } from "./shopifyTokenManager.js";

export async function fulfillShopifyOrder(shopifyOrderId) {
  try {
    const accessToken = await getShopifyToken();

    console.log("🚀 Fulfilling order:", shopifyOrderId);

    // 1️⃣ Fetch Order
    const orderRes = await axios.get(
      `https://${process.env.SHOPIFY_STORE}/admin/api/2026-01/orders/${shopifyOrderId}.json`,
      {
        headers: {
          "X-Shopify-Access-Token": accessToken,
        },
      }
    );

    const order = orderRes.data.order;

    if (!order) throw new Error("Order not found");

    if (order.fulfillment_status === "fulfilled") {
      console.log("✅ Already fulfilled");
      return;
    }

    if (order.financial_status !== "paid") {
      console.log("⚠️ Order not paid");
      return;
    }

    // 2️⃣ Build line items manually
    const lineItems = order.line_items
      .filter((item) => item.fulfillable_quantity > 0)
      .map((item) => ({
        id: item.id,
        quantity: item.fulfillable_quantity,
      }));

    if (!lineItems.length) {
      console.log("⚠️ No fulfillable line items");
      return;
    }

    // 3️⃣ Create fulfillment directly
    const fulfillmentRes = await axios.post(
      `https://${process.env.SHOPIFY_STORE}/admin/api/2026-01/orders/${shopifyOrderId}/fulfillments.json`,
      {
        fulfillment: {
          line_items: lineItems,
          notify_customer: false,
        },
      },
      {
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ Fulfilled successfully");
    console.log(JSON.stringify(fulfillmentRes.data, null, 2));

  } catch (error) {
    console.error("❌ Fulfillment failed");
    console.error("Status:", error.response?.status);
    console.error(
      "Error:",
      JSON.stringify(error.response?.data, null, 2)
    );
  }
}
