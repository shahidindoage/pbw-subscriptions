import { Resend } from "resend";
import dotenv from "dotenv";

dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Send email notification for subscriptions or orders
 * @param {Object} options
 * options = {
 *   customer: { name, email },
 *   type: "welcome" | "resumed" | "stopped" | "expired" | 
 *         "order_shipped" | "order_delivered" | "order_cancelled" | "order_processing",
 *   subscription?: subscription object,
 *   order?: order object,
 *   extra?: any extra info for template
 * }
 */
export async function sendEmail({ customer, type, subscription, order, extra }) {
  if (!customer?.email) throw new Error("Customer email is required");

  let subject = "Notification from Your Company";
  let html = "";

  switch (type) {
    // ===== Subscription Cases =====
    case "welcome":
      subject = `Welcome ${customer.name}! Your subscription is created`;
      html = `
        <p>Hi ${customer.name},</p>
        <p>Your subscription for <b>${subscription.product}</b> has been successfully created.</p>
        <p>Delivery Days: ${subscription.deliveryDays}</p>
        <p>Total Amount: ₹${subscription.totalAmount + subscription.deliveryFee}</p>
        <p>Thank you for choosing us!</p>
      `;
      break;

    case "resumed":
      subject = `Your subscription has been resumed`;
      html = `
        <p>Hi ${customer.name},</p>
        <p>Your subscription for <b>${subscription.product}</b> has been resumed.</p>
        <p>Next delivery: <b>${subscription.nextShippingDate.toDateString()}</b></p>
      `;
      break;

    case "stopped":
      subject = `Your subscription has been paused`;
      html = `
        <p>Hi ${customer.name},</p>
        <p>Your subscription for <b>${subscription.product}</b> has been paused.</p>
        <p>You can resume it anytime from your dashboard.</p>
      `;
      break;

    case "expired":
      subject = `Your subscription has expired`;
      html = `
        <p>Hi ${customer.name},</p>
        <p>Your subscription for <b>${subscription.product}</b> has expired.</p>
        <p>We would love to have you back! Renew anytime from your account.</p>
      `;
      break;

    // ===== Order Cases =====
    case "order_processing":
      subject = `Your order is being processed`;
      html = `
        <p>Hi ${customer.name},</p>
        <p>Your order <b>${order.shopifyOrderId || order.id}</b> is being processed.</p>
        <p>Product: ${order.product || "N/A"}</p>
        <p>Expected shipping date: <b>${order.shippingDate?.toDateString() || "TBD"}</b></p>
      `;
      break;

    case "order_shipped":
      subject = `Your order has been shipped!`;
      html = `
        <p>Hi ${customer.name},</p>
        <p>Your order <b>${order.shopifyOrderId || order.id}</b> has been shipped.</p>
        <p>Product: ${order.product || "N/A"}</p>
        <p>Expected delivery: <b>${order.shippingDate?.toDateString() || "TBD"}</b></p>
      `;
      break;

    case "order_delivered":
      subject = `Your order has been delivered!`;
      html = `
        <p>Hi ${customer.name},</p>
        <p>Your order <b>${order.shopifyOrderId || order.id}</b> has been delivered.</p>
        <p>We hope you enjoy your product!</p>
      `;
      break;

    case "order_cancelled":
      subject = `Your order has been cancelled`;
      html = `
        <p>Hi ${customer.name},</p>
        <p>Your order <b>${order.shopifyOrderId || order.id}</b> has been cancelled.</p>
        <p>If this was a mistake, please contact our support.</p>
      `;
      break;

    default:
      html = `<p>Hello ${customer.name}, this is a notification from us.</p>`;
  }

  try {
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL,
      to: customer.email,
      subject,
      html,
    });
    console.log(`✅ Email sent (${type}) to ${customer.email}`);
  } catch (err) {
    console.error(`❌ Failed to send ${type} email to ${customer.email}:`, err);
  }
}
