import axios from "axios";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SHOPIFY_STORE = process.env.SHOPIFY_STORE; // e.g., store.myshopify.com
const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;

// Get valid Shopify access token
export async function getShopifyToken() {
  let tokenRecord = await prisma.shopifyToken.findFirst();

  // Check if token exists and not expired
  if (tokenRecord && tokenRecord.expiry > new Date()) {
    return tokenRecord.accessToken;
  }

  // Token expired or not exists → request new one
  const res = await axios.post(`https://${SHOPIFY_STORE}/admin/oauth/access_token`, {
    grant_type: "client_credentials",
    client_id: SHOPIFY_API_KEY,
    client_secret: SHOPIFY_API_SECRET,
  });

  const newToken = res.data.access_token;
  const expiry = new Date(Date.now() + 23 * 60 * 60 * 1000); // 23 hours buffer

  // Store / update in DB
  await prisma.shopifyToken.upsert({
    where: { id: 1 },
    update: { accessToken: newToken, expiry },
    create: { id: 1, accessToken: newToken, expiry },
  });

  return newToken;
}
