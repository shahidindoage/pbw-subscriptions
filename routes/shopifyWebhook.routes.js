import express from "express";
import { handleShopifyOrderCreate, handleShopifyOrderUpdate } from "../controllers/shopifyWebhook.controller.js";

const router = express.Router();

/**
 * Middleware to capture raw body for signature verification
 */
function captureRawBody(req, res, next) {
  let data = "";
  req.setEncoding("utf8");
  
  req.on("data", (chunk) => {
    data += chunk;
  });
  
  req.on("end", () => {
    req.rawBody = data;
    req.body = JSON.parse(data);
    next();
  });
}

// Order creation webhook
router.post("/orders/create", captureRawBody, handleShopifyOrderCreate);

// Order update webhook (optional)
router.post("/orders/update", captureRawBody, handleShopifyOrderUpdate);

export default router;
