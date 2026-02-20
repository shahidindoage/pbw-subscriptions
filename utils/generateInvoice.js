import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

export async function generateInvoiceBuffer(
  order,
  subscription,
  customer,
  invoiceNumber,
  shippingDate
) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 20,
      });

      const buffers = [];
      doc.on("data", buffers.push.bind(buffers));
      doc.on("end", () => resolve(Buffer.concat(buffers)));

      const pageWidth = 595;
      const pageHeight = 842;
      const startX = 20;
      let cursorY = 20;

      /* ---------------- CALCULATIONS ---------------- */

      let frequency = 1;
      const freqStr = (subscription.frequency || "").toLowerCase();
      if (freqStr.includes("once")) frequency = 1;
      else if (freqStr.includes("twice")) frequency = 2;
      else if (freqStr.includes("thrice")) frequency = 3;

      const quantity = subscription.quantity || 1;
      const period = subscription.period || 1;

      const basePrice =
        subscription.totalAmount / (period * quantity * frequency);

      const singleTotal = basePrice * quantity;
      const gstPercent = 5;
      const gstValue = (singleTotal * gstPercent) / 100;
      const singleTotalWithGst = singleTotal - gstValue;
      const deliveryFee =
        (subscription.deliveryFee || 0) / (period * frequency);
      const grandTotal = singleTotal + deliveryFee;

      /* ---------------- NUMBER TO WORDS ---------------- */

      function numberToWords(num) {
        const a = ["", "One", "Two", "Three", "Four", "Five", "Six",
          "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
          "Thirteen", "Fourteen", "Fifteen", "Sixteen",
          "Seventeen", "Eighteen", "Nineteen"];
        const b = ["", "", "Twenty", "Thirty", "Forty",
          "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

        const inWords = (n) => {
          if (n < 20) return a[n];
          if (n < 100)
            return b[Math.floor(n / 10)] + (n % 10 ? " " + a[n % 10] : "");
          if (n < 1000)
            return a[Math.floor(n / 100)] + " Hundred" +
              (n % 100 ? " " + inWords(n % 100) : "");
          if (n < 100000)
            return inWords(Math.floor(n / 1000)) + " Thousand" +
              (n % 1000 ? " " + inWords(n % 1000) : "");
          if (n < 10000000)
            return inWords(Math.floor(n / 100000)) + " Lakh" +
              (n % 100000 ? " " + inWords(n % 100000) : "");
          return inWords(Math.floor(n / 10000000)) + " Crore" +
            (n % 10000000 ? " " + inWords(n % 10000000) : "");
        };

        const [rupees, paise] = num.toFixed(2).split(".");
        let words = inWords(parseInt(rupees)) + " Rupees";
        if (parseInt(paise) > 0)
          words += " and " + inWords(parseInt(paise)) + " Paise";
        return words + " Only";
      }

      const amountInWords = numberToWords(grandTotal);

      /* ---------------- PAGE BORDER ---------------- */

      doc.rect(10, 10, pageWidth - 20, pageHeight - 20).stroke();

      /* ---------------- HEADER ---------------- */

      doc.font("Helvetica-Bold").fontSize(22)
        .text("TAX INVOICE", startX, cursorY);

      doc.fontSize(10).font("Helvetica")
        .text("GSTIN: 06AAOCP2140F1ZM", startX, cursorY + 30)
        .text("CIN: U10797DL2023PTC422253", startX, cursorY + 45);

      doc.font("Helvetica-Bold")
        .text("ORIGINAL", pageWidth - 120, cursorY + 5)
        .font("Helvetica")
        .text("FSSAI LIC NO.: 13324999000116", pageWidth - 180, cursorY + 25);

      cursorY += 80;

      doc.font("Helvetica-Bold").fontSize(12)
        .text("PBW Foods Private Limited", 0, cursorY, { align: "center" });

      cursorY += 15;

      doc.font("Helvetica").fontSize(9)
        .text(
          "PBW Foods Private Limited, DLF Cyber City Rd, Gurugram - 122002, Haryana, India",
          0,
          cursorY,
          { align: "center" }
        );

      cursorY += 30;

      /* ---------------- TABLE FUNCTION ---------------- */

      function cell(x, y, w, h, text = "", align = "left", bold = false) {
        doc.rect(x, y, w, h).stroke();
        doc.font(bold ? "Helvetica-Bold" : "Helvetica")
          .fontSize(9)
          .text(text, x + 5, y + 5, { width: w - 10, align });
      }

      /* ---------------- 3x3 TABLE ---------------- */

      const colW = (pageWidth - 40) / 3;
      const rowH = 28;

      cell(startX, cursorY, colW, rowH, `Invoice No: ${invoiceNumber}`);
      cell(startX + colW, cursorY, colW, rowH, `Order No: PBW${order.order_number}`);
      cell(startX + colW * 2, cursorY, colW, rowH);

      cell(startX, cursorY + rowH, colW, rowH, `Invoice Date: ${new Date().toLocaleDateString()}`);
      cell(startX + colW, cursorY + rowH, colW, rowH, `Order Date: ${new Date().toLocaleDateString()}`);
      cell(startX + colW * 2, cursorY + rowH, colW, rowH, `Supply: ${new Date(shippingDate).toLocaleDateString()}`);

      cell(startX, cursorY + rowH * 2, colW, rowH, "State: Haryana");
      cell(startX + colW, cursorY + rowH * 2, colW, rowH, "Code: 6");
      cell(startX + colW * 2, cursorY + rowH * 2, colW, rowH, `Place: ${subscription.address.city}`);

      cursorY += rowH * 3 + 20;

      /* ---------------- BILL / SHIP ---------------- */

      const halfW = (pageWidth - 40) / 2;

      cell(startX, cursorY, halfW, 25, "BILL TO PARTY", "center", true);
      cell(startX + halfW, cursorY, halfW, 25, "SHIP TO PARTY / DELIVERY ADDRESS", "center", true);

      cursorY += 25;

      const addressText =
        `${subscription.address?.line1 || ""}, ${subscription.address?.line2 || ""}, 
${subscription.address?.city || ""}, ${subscription.address?.state || ""}, 
${subscription.address?.pincode || ""}`;

      cell(startX, cursorY, halfW, 60, `${customer.name}\n${addressText}`);
      cell(startX + halfW, cursorY, halfW, 60, `${customer.name}\n${addressText}`);

      cursorY += 60 + 20;

      /* ---------------- PRODUCT TABLE ---------------- */

      const cols = [30, 140, 60, 40, 60, 60, 40, 60, 60];
      const headers = [
        "#","ITEM - SKU","HSN","QTY","RATE","TAXABLE","GST%","IGST","TOTAL"
      ];

      let x = startX;
      headers.forEach((h, i) => {
        cell(x, cursorY, cols[i], 25, h, "center", true);
        x += cols[i];
      });

      cursorY += 25;
      x = startX;

      const row = [
        "1",
        subscription.product,
        "-",
        quantity.toString(),
        basePrice.toFixed(2),
        singleTotalWithGst.toFixed(2),
        gstPercent.toString(),
        gstValue.toFixed(2),
        singleTotal.toFixed(2),
      ];

      row.forEach((d, i) => {
        cell(x, cursorY, cols[i], 30, d, "center");
        x += cols[i];
      });

      cursorY += 40;

      /* ---------------- TOTAL BLOCK ---------------- */

      cell(startX, cursorY, pageWidth - 180, 30, "TOTAL IN WORDS:\n" + amountInWords);
      cell(pageWidth - 160, cursorY, 140, 30, grandTotal.toFixed(2), "center", true);

      cursorY += 80;

      /* ---------------- IMAGES ---------------- */

      const paidImagePath = path.resolve("public/paid-img.PNG");
      const signImagePath = path.resolve("public/sign-img.PNG");

      if (fs.existsSync(paidImagePath))
        doc.image(paidImagePath, startX, pageHeight - 120, { height: 50 });

      if (fs.existsSync(signImagePath))
        doc.image(signImagePath, pageWidth - 160, pageHeight - 120, { height: 40 });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}