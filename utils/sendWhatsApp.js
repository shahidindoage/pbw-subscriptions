import axios from "axios";

/**
 * Send WhatsApp template message via Aisensy
 */
export const sendWhatsAppTemplate = async ({
  phone,
  templateName,
  parameters = [],
}) => {
  try {
    if (!phone) {
      throw new Error("Phone number is required for WhatsApp message");
    }
console.log("==== AISENSY DEBUG ====");
console.log("API KEY:", process.env.AISENSY_API_KEY ? "EXISTS" : "MISSING");
console.log("Template Name:", templateName);
console.log("Phone:", phone);
console.log("Parameters:", parameters);
console.log("=======================");

    const response = await axios.post(
  "https://backend.aisensy.com/campaign/t1/api/v2",
  {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: parameters[0], // better than phone
    templateParams: parameters,
  },
  {
    headers: {
      "Content-Type": "application/json",
    },
  }
);


    console.log("✅ WhatsApp sent:", response.data);
    return response.data;
  } catch (error) {
    console.error(
      "❌ WhatsApp send error:",
      error.response?.data || error.message
    );
    throw error;
  }
};
