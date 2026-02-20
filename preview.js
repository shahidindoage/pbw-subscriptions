import fs from "fs";
import { generateInvoiceBuffer } from "./utils/generateInvoice.js"; 
// 👆 change path if needed

async function runPreview() {
  try {

    /* ---------------- SAMPLE DATA ---------------- */

    const order = {
      order_number: "1012"
    };

    const subscription = {
      frequency: "Once a day",
      quantity: 2,
      period: 30,
      totalAmount: 3000,
      deliveryFee: 300,
      product: "100% Whole Wheat Bread  | 250 g",
      address: {
        line1: "DLF Cyber City Road",
        line2: "Phase 2",
        city: "Gurugram",
        state: "Haryana",
        pincode: "122002"
      }
    };

    const customer = {
      name: "Rahul Sharma"
    };

    const invoiceNumber = "INV-2026-0001";
    const shippingDate = new Date();

    /* ---------------- GENERATE PDF ---------------- */

    const buffer = await generateInvoiceBuffer(
      order,
      subscription,
      customer,
      invoiceNumber,
      shippingDate
    );

    fs.writeFileSync("preview.pdf", buffer);

    console.log("✅ preview.pdf generated successfully");

  } catch (error) {
    console.error("❌ Preview failed:", error);
  }
}

runPreview();