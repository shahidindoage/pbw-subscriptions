import express from "express";
import {
  createSubscription,
  listSubscriptions
} from "../controllers/subscription.controller.js";

const router = express.Router();

router.post("/create-subscription", createSubscription);
router.get("/subscriptions", listSubscriptions);

export default router;
