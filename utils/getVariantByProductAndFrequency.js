import axios from "axios";
import { getShopifyToken } from "./shopifyTokenManager.js";

export async function getVariantByProductAndFrequency(productName, frequency) {
  const accessToken = await getShopifyToken();

  // 1️⃣ Search product by title
  const productRes = await axios.get(
    `https://${process.env.SHOPIFY_STORE}/admin/api/2026-01/products.json`,
    {
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
      params: {
        title: productName,
        limit: 5
      }
    }
  );

  const products = productRes.data.products;

  if (!products || !products.length) {
    throw new Error("Product not found in Shopify");
  }

  // Exact match product title
  const product = products.find(
    p => p.title.toLowerCase() === productName.toLowerCase()
  );

  if (!product) {
    throw new Error("Exact product match not found");
  }

  // 2️⃣ Find matching variant (frequency = variant title)
  const variant = product.variants.find(
    v => v.title.toLowerCase() === frequency.toLowerCase()
  );

  if (!variant) {
    throw new Error("Variant (frequency) not found");
  }

  return variant;
}