/**
 * Prepare template parameters based on order status
 */

export const getOrderWhatsAppTemplate = ({
  status,
  customerName,
  orderNumber,
  product,
  shippingDate,
  orderLink,
}) => {
  // Only send for these statuses
  const allowedStatuses = ["processing", "shipped", "delivered"];

  if (!allowedStatuses.includes(status)) return null;

  const formattedDate = shippingDate
    ? new Date(shippingDate).toDateString()
    : "-";

  return {
    templateName: "pbw_order_campaign",
    parameters: [
      customerName || "Customer",       // {{1}}
      orderNumber?.toString() || "-",   // {{2}}
      product || "-",                   // {{3}}
      status.charAt(0).toUpperCase() + status.slice(1), // {{4}}
      formattedDate,                    // {{5}}
    ],
  };
};
