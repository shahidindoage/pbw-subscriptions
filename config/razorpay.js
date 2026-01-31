import Razorpay from "razorpay";

if (!process.env.RAZORPAY_KEY || !process.env.RAZORPAY_SECRET) {
  throw new Error("❌ Razorpay keys missing in environment variables");
}

// Razorpay client
// =====================
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY,
  key_secret: process.env.RAZORPAY_SECRET
});

export default razorpay;
