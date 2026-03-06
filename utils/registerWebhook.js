import axios from "axios";
import { getShopifyToken } from "./shopifyTokenManager.js";
import dotenv from "dotenv";

dotenv.config();

/**
 * Register Order Creation Webhook with Shopify
 */
export async function registerOrderWebhook() {
  try {
    const accessToken = await getShopifyToken();
    const shopifyStore = process.env.SHOPIFY_STORE;
    
    // Your webhook endpoint
    const webhookUrl = process.env.WEBHOOK_URL || "https://your-domain.com/webhooks/shopify/orders/create";
    
    console.log("🔧 Registering webhook with Shopify...");
    console.log("URL:", webhookUrl);

    const response = await axios.post(
      `https://${shopifyStore}/admin/api/2024-01/webhooks.json`,
      {
        webhook: {
          topic: "orders/create",
          address: webhookUrl,
          format: "json",
        },
      },
      {
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ Webhook registered successfully!");
    console.log("Webhook ID:", response.data.webhook.id);
    console.log("Topic:", response.data.webhook.topic);
    console.log("Address:", response.data.webhook.address);
    
    return response.data.webhook;

  } catch (error) {
    if (error.response?.status === 422) {
      console.log("⚠️ Webhook already exists or validation error");
      console.log("Error:", error.response.data);
    } else {
      console.error("❌ Failed to register webhook:", error.response?.data || error.message);
    }
    throw error;
  }
}

/**
 * List all registered webhooks
 */
export async function listWebhooks() {
  try {
    const accessToken = await getShopifyToken();
    const shopifyStore = process.env.SHOPIFY_STORE;

    const response = await axios.get(
      `https://${shopifyStore}/admin/api/2024-01/webhooks.json`,
      {
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("📋 Registered Webhooks:");
    response.data.webhooks.forEach((webhook) => {
      console.log(`  - ${webhook.topic} → ${webhook.address}`);
      console.log(`    ID: ${webhook.id}`);
    });

    return response.data.webhooks;

  } catch (error) {
    console.error("❌ Failed to list webhooks:", error.response?.data || error.message);
    throw error;
  }
}

/**
 * Delete a webhook by ID
 */
export async function deleteWebhook(webhookId) {
  try {
    const accessToken = await getShopifyToken();
    const shopifyStore = process.env.SHOPIFY_STORE;

    await axios.delete(
      `https://${shopifyStore}/admin/api/2024-01/webhooks/${webhookId}.json`,
      {
        headers: {
          "X-Shopify-Access-Token": accessToken,
        },
      }
    );

    console.log(`✅ Webhook ${webhookId} deleted successfully`);

  } catch (error) {
    console.error("❌ Failed to delete webhook:", error.response?.data || error.message);
    throw error;
  }
}

// If running directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2];

  if (command === "register") {
    registerOrderWebhook();
  } else if (command === "list") {
    listWebhooks();
  } else if (command === "delete" && process.argv[3]) {
    deleteWebhook(process.argv[3]);
  } else {
    console.log("Usage:");
    console.log("  node utils/registerWebhook.js register");
    console.log("  node utils/registerWebhook.js list");
    console.log("  node utils/registerWebhook.js delete <webhook_id>");
  }
}
