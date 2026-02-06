import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Send an email using Resend
 * @param {string|string[]} to - Recipient email or array of emails
 * @param {string} subject - Email subject
 * @param {string} html - HTML content
 */
export async function sendEmail({ to, subject, html }) {
  try {
    await resend.emails.send({
      from: process.env.FROM_EMAIL, // replace with verified sender
      to,
      subject,
      html,
    });
    console.log(`✅ Email sent to ${to}`);
  } catch (err) {
    console.error("❌ Failed to send email:", err);
  }
}

/**
 * Send Welcome Email for a subscription
 * @param {Object} customer - { name, email }
 * @param {Object} subscription - subscription object
 */
export async function sendWelcomeEmail(customer, subscription) {
  const html = `
    <h2>Hi,</h2>
    <p>Thank you for subscribing to <strong>${subscription.product}</strong>.</p>
    <p>Your subscription details:</p>
    <ul>
      <li>Frequency: ${subscription.frequency} per week</li>
      <li>Delivery Days: ${subscription.deliveryDays}</li>
      <li>Quantity: ${subscription.quantity}</li>
      <li>Total Amount: ₹${subscription.totalAmount + subscription.deliveryFee}</li>
    </ul>
    <p>We look forward to delivering fresh products to you!</p>
    <p>— Team</p>
  `;

  await sendEmail({
    to: customer.email,
    subject: "Welcome! Your Subscription is Active",
    html,
  });
}

/**
 * Example: Send generic notification
 */
export async function sendNotificationEmail(to, subject, message) {
  await sendEmail({ to, subject, html: `<p>${message}</p>` });
}
