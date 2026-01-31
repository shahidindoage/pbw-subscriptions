import express from "express";
import { razorpayWebhook } from "../controllers/webhook.controller.js";

const router = express.Router();
router.post("/razorpay/webhook", razorpayWebhook);

export default router;
