import PDFDocument from "pdfkit";

/**
 * Generate invoice for regular (non-subscription) Shopify orders
 * @param {Object} order - RegularOrder from database
 * @param {string} invoiceNumber - Invoice number (e.g., INV-1234)
 * @returns {Promise<Buffer>} PDF buffer
 */
export async function generateRegularInvoiceBuffer(order, invoiceNumber) {
  try {
    const doc = new PDFDocument({
      size: "A4",
      margin: 20,
    });

    const buffers = [];
    doc.on("data", buffers.push.bind(buffers));

    const pageWidth = 595;
    const pageHeight = 842;
    const startX = 20;
    let cursorY = 20;

    // Parse line items
    const lineItems = Array.isArray(order.lineItems) 
      ? order.lineItems 
      : JSON.parse(order.lineItems);

    const totalPrice = parseFloat(order.totalPrice || 0);
    const discount = parseFloat(order.totalDiscount || 0);
    const shippingfee = parseFloat(order.shippingFee || 0);
    const subtotalPrice = parseFloat(order.subtotalPrice || totalPrice);
    const totalTax = parseFloat(order.totalTax || 0);

    // Calculate CGST and SGST (assuming 18% total GST = 9% + 9%)
    const cgst = totalTax / 2;
    const sgst = totalTax / 2;

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
        if (n < 100) return b[Math.floor(n / 10)] + (n % 10 ? " " + a[n % 10] : "");
        if (n < 1000) return a[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + inWords(n % 100) : "");
        if (n < 100000) return inWords(Math.floor(n / 1000)) + " Thousand" + (n % 1000 ? " " + inWords(n % 1000) : "");
        if (n < 10000000) return inWords(Math.floor(n / 100000)) + " Lakh" + (n % 100000 ? " " + inWords(n % 100000) : "");
        return inWords(Math.floor(n / 10000000)) + " Crore" + (n % 10000000 ? " " + inWords(n % 10000000) : "");
      };

      const [integer, decimal] = num.toFixed(2).split(".");
      let result = inWords(parseInt(integer)) + " Rupees";
      if (parseInt(decimal) > 0) {
        result += " and " + inWords(parseInt(decimal)) + " Paise";
      }
      return result + " Only";
    }

    const amountInWords = numberToWords(totalPrice);

    /* ---------------- COMPANY INFO ---------------- */
    const companyName = "PBW FOODS";
    const companyAddress = "A-103 Hasanpur, I.P. Extension,\nPatparganj, Delhi - 110092";
    const companyGSTIN = "07AAFCP5471Q1ZX";
    const companyContact = "+91 9821024666";
    const companyEmail = "info@pbwfoods.com";

    
      /* ---------------- PAGE BORDER ---------------- */

      doc.rect(10, 10, pageWidth - 20, pageHeight - 20).stroke();

      /* ---------------- HEADER ---------------- */

      doc.font("Helvetica-Bold").fontSize(22)
        .text("TAX INVOICE", startX, cursorY);

      doc.fontSize(9).font("Helvetica-Bold")
        .text("GSTIN: 06AAOCP2140F1ZM", startX, cursorY + 30)
        .text("CIN: U10797DL2023PTC422253", startX, cursorY + 45);

      doc.font("Helvetica-Bold")
        .text("ORIGINAL", pageWidth - 120, cursorY + 2, { align: "right" })
        .font("Helvetica-Bold")
        .text("FSSAI LIC NO.: 13324999000116", pageWidth - 180, cursorY + 15, { align: "right" });

      cursorY += 80;

      doc.font("Helvetica-Bold").fontSize(12)
        .text("PBW Foods Private Limited", 0, cursorY, { align: "center" });

      cursorY += 15;

      doc.font("Helvetica").fontSize(8)
        .text(
          "PBW Foods Private Limited, Bldg #5, Epitome, Ground Floor, DLF Cyber City Rd, Phase 3, Sector 24, Gurugram - 122002, Haryana, India",
          0,
          cursorY,
          { align: "center" }
        );

      cursorY += 20;

      const footerColW = (pageWidth - 40) / 3;
let footerX = startX;

doc.font("Helvetica-Bold")
   .fontSize(9)

/* EMAIL */
doc.text(
  "email@pbwfoods.com ",
  footerX,
  cursorY,
  { width: footerColW, align: "center" }
)

/* WEBSITE */
.text(
  "www.pbwfoods.com",
  footerX + footerColW,
  cursorY,
  { width: footerColW, align: "center" }
)

/* PHONE */
.text(
  "080-47360729",
  footerX + footerColW * 2,
  cursorY,
  { width: footerColW, align: "center" }
);

cursorY += 20;

      /* ---------------- TABLE FUNCTION ---------------- */

   function cell(
  x,
  y,
  w,
  h,
  text = "",
  align = "left",
  bold = false,
  borders = { top: true, right: true, bottom: true, left: true },
  background = null,          // NEW
  textColor = "#000000"       // NEW
) {
  doc.lineWidth(1);

  /* -------- BACKGROUND -------- */
  if (background) {
    doc.save();
    doc.rect(x, y, w, h).fill(background);
    doc.restore();
  }

  /* -------- BORDERS -------- */
  if (borders.top) {
    doc.moveTo(x, y).lineTo(x + w, y).stroke();
  }

  if (borders.right) {
    doc.moveTo(x + w, y).lineTo(x + w, y + h).stroke();
  }

  if (borders.bottom) {
    doc.moveTo(x, y + h).lineTo(x + w, y + h).stroke();
  }

  if (borders.left) {
    doc.moveTo(x, y).lineTo(x, y + h).stroke();
  }

  /* -------- TEXT -------- */
  doc
    .fillColor(textColor)
    .font(bold ? "Helvetica-Bold" : "Helvetica")
    .fontSize(9)
    .text(text, x + 5, y + 8, {
      width: w - 10,
      align: align,
    });

  // Reset text color
  doc.fillColor("#000000");
}

      /* ---------------- 3x3 TABLE ---------------- */

      const colW = (pageWidth - 40) / 3;
      const rowH = 28;

      cell(startX, cursorY, colW, rowH, "");

doc.font("Helvetica-Bold")
   .fontSize(9)
   .text("Invoice No: ", startX + 5, cursorY + 8, { continued: true });

doc.font("Helvetica")
   .text(invoiceNumber, {
     width: colW - 10
   });
      cell(startX + colW, cursorY, colW, rowH, "");

doc.font("Helvetica-Bold")
   .fontSize(9)
   .text("Order No: ", startX + colW + 5, cursorY + 8, { continued: true });

doc.font("Helvetica")
   .text(order.orderName || order.orderNumber || "N/A", {
     width: colW - 10
   });
      cell(startX + colW * 2, cursorY, colW, rowH);

      cell(startX, cursorY + rowH, colW, rowH, "");

doc.font("Helvetica-Bold")
   .fontSize(9)
   .text("Invoice Date: ", startX + 5, cursorY + rowH + 8, { continued: true });

doc.font("Helvetica")
   .text(new Date().toLocaleDateString(), {
     width: colW - 10
   });
      cell(startX + colW, cursorY + rowH, colW, rowH, "");

doc.font("Helvetica-Bold")
   .fontSize(9)
   .text("Order Date: ", startX + colW + 5, cursorY + rowH + 8, { continued: true });

doc.font("Helvetica")
   .text(new Date().toLocaleDateString(), {
     width: colW - 10
   });
      cell(startX + colW * 2, cursorY + rowH, colW, rowH, "");

doc.font("Helvetica-Bold")
   .fontSize(9)
   .text("Supply: ", startX + colW * 2 + 5, cursorY + rowH + 8, { continued: true });

doc.font("Helvetica")
   .text(new Date().toLocaleDateString(), {
     width: colW - 10
   });

      // Draw empty cell
cell(startX, cursorY + rowH * 2, colW, rowH, "");

// Bold label + normal value
doc.font("Helvetica-Bold")
   .fontSize(9)
   .text("State: ", startX + 5, cursorY + rowH * 2 + 8, { continued: true });

doc.font("Helvetica")
   .text("Haryana", {
     width: colW - 10
   });
      cell(startX + colW, cursorY + rowH * 2, colW, rowH, "");

doc.font("Helvetica-Bold")
   .fontSize(9)
   .text("Code: ", startX + colW + 5, cursorY + rowH * 2 + 8, { continued: true });

doc.font("Helvetica")
   .text("6", {
     width: colW - 10
   });
     cell(startX + colW * 2, cursorY + rowH * 2, colW, rowH, "");

doc.font("Helvetica-Bold")
   .fontSize(9)
   .text("Place: ", startX + colW * 2 + 5, cursorY + rowH * 2 + 8, { continued: true });

doc.font("Helvetica")
   .text("Gurugram" || "-", {
     width: colW - 10
   });

      cursorY += rowH * 3 + 20;

    /* ---------------- CUSTOMER DETAILS ---------------- */
    const shipping = typeof order.shippingAddress === 'string' 
      ? JSON.parse(order.shippingAddress) 
      : order.shippingAddress || {};
    
    const billing = typeof order.billingAddress === 'string'
      ? JSON.parse(order.billingAddress)
      : order.billingAddress || {};

   /* ---------------- BILL / SHIP ---------------- */

      const totalW = pageWidth - 40;

const leftW = totalW * 0.45;   // BILL TO
const rightW = totalW * 0.55;  // SHIP TO (more space)

cell(startX, cursorY, leftW, 25, "BILL TO PARTY", "center", true, undefined, "#f0f0f0");
cell(startX + leftW, cursorY, rightW, 25, "SHIP TO PARTY / DELIVERY ADDRESS", "center", true, undefined, "#f0f0f0");

cursorY += 25;

const addressText =
  `${shipping?.address1 || ""}, ${shipping?.address2 || ""},
${shipping?.city || ""}, ${shipping?.province || ""},
${shipping?.zip || ""}`;

const nameRowH = 25;
const addressRowH = 60; // increased height

/* NAME ROW */
cell(startX, cursorY, leftW, nameRowH, shipping.name, "left", true);
cell(startX + leftW, cursorY, rightW, nameRowH, shipping.name, "left", true);
cursorY += nameRowH;

/* ADDRESS ROW */
cell(startX, cursorY, leftW, addressRowH, addressText);
cell(startX + leftW, cursorY, rightW, addressRowH, addressText);

cursorY +=  addressRowH;

const phoneRowH = 20;

// Draw empty cell
cell(startX, cursorY, leftW, phoneRowH, "");

// Bold label
doc.font("Helvetica-Bold")
   .fontSize(9)
   .text("Phone: ", startX + 5, cursorY + 8, { continued: true });

// Normal value
doc.font("Helvetica")
   .text(shipping?.phone || "-", {
     width: leftW - 10
   });

cell(startX + leftW, cursorY, rightW, phoneRowH, "");

doc.font("Helvetica-Bold")
   .fontSize(9)
   .text("Phone: ", startX + leftW + 5, cursorY + 8, { continued: true });

doc.font("Helvetica")
   .text(shipping?.phone || "-", {
     width: rightW - 10
   });

cursorY += phoneRowH;

const infoRowH = 20;

// Split left column
const leftHalf1 = leftW / 2;
const leftHalf2 = leftW / 2;

// Split right column
const rightHalf1 = rightW / 2;
const rightHalf2 = rightW / 2;

/* LEFT COLUMN PARTITIONS */
// Draw empty cell first
cell(startX, cursorY, leftHalf1, infoRowH, "");

// Bold Label
doc.font("Helvetica-Bold")
   .fontSize(9)
   .text("State: ", startX + 5, cursorY + 8, { continued: true });

// Normal Value
doc.font("Helvetica")
   .text(shipping?.province || "-", {
     width: leftHalf1 - 10
   });

cell(startX + leftHalf1, cursorY, leftHalf2, infoRowH, "");

doc.font("Helvetica-Bold")
   .fontSize(9)
   .text("Country: ", startX + leftHalf1 + 5, cursorY + 8, { continued: true });

doc.font("Helvetica")
   .text("India", {
     width: leftHalf2 - 10
   });

/* RIGHT COLUMN PARTITIONS */
cell(startX + leftW, cursorY, rightHalf1, infoRowH, "");

doc.font("Helvetica-Bold")
   .fontSize(9)
   .text("State: ", startX + leftW + 5, cursorY + 8, { continued: true });

doc.font("Helvetica")
   .text(shipping?.province || "-", {
     width: rightHalf1 - 10
   });

cell(startX + leftW + rightHalf1, cursorY, rightHalf2, infoRowH, "");

doc.font("Helvetica-Bold")
   .fontSize(9)
   .text("Country: ", startX + leftW + rightHalf1 + 5, cursorY + 8, { continued: true });

doc.font("Helvetica")
   .text("India", {
     width: rightHalf2 - 10
   });

cursorY += infoRowH + 20;


    /* ---------------- PRODUCT TABLE ---------------- */

const cols = [30, 140, 60, 40, 60, 60, 40, 60, 60];
const headers = [
  "#",
  "ITEM - SKU",
  "HSN",
  "QTY",
  "RATE",
  "TAXABLE",
  "GST%",
  "IGST",
  "TOTAL"
];

/* HEADER */
let x = startX;

headers.forEach((h, i) => {
  cell(x, cursorY, cols[i], 25, h, "center", true, undefined, "#f0f0f0");
  x += cols[i];
});

cursorY += 25;


/* PRODUCT ROWS */
let totalQuantity = 0;
let totalPricefor = 0;

lineItems.forEach((item, index) => {

  x = startX;

  const quantity = item.quantity || 1;
  const rate = parseFloat(item.price || 0);

  const gstPercent = 5;
  const total = rate * quantity;
  const gstValue = (total * gstPercent) / 100;
  const taxable = total - gstValue;

  /* ADD THESE */
totalQuantity += quantity;
totalPricefor += total;

  const row = [
    (index + 1).toString(),
    `${item.title || item.name || "Product"}`,
    item.sku || "-",           // HSN
    quantity.toString(),
    rate.toFixed(2),
    taxable.toFixed(2),
    gstPercent.toString(),
    gstValue.toFixed(2),
    total.toFixed(2)
  ];

  row.forEach((d, i) => {
    cell(x, cursorY, cols[i], 30, d, "center");
    x += cols[i];
  });

  cursorY += 30;

});


/* EMPTY ROWS FOR DESIGN */
for (let r = 0; r < 2; r++) {

  let emptyX = startX;

  cols.forEach((colWidth) => {
    cell(emptyX, cursorY, colWidth, 20, "", "center");
    emptyX += colWidth;
  });

  cursorY += 20;

}
// ✅ TOTAL ROW
let totalRowY = cursorY;
let totalX = startX;

// 1️⃣ Merge first two columns
const mergedWidth = cols[0] + cols[1];
cell(totalX, totalRowY, mergedWidth, 20, "TOTAL", "center", true, undefined, "#f0f0f0");
totalX += mergedWidth;

// 2️⃣ HSN column
cell(totalX, totalRowY, cols[2], 20, "", "center");
totalX += cols[2];

// 3️⃣ TOTAL QUANTITY
cell(totalX, totalRowY, cols[3], 20, totalQuantity.toString(), "center", true);
totalX += cols[3];

// 4️⃣ RATE column
cell(totalX, totalRowY, cols[4], 20, "", "center");
totalX += cols[4];

// 5️⃣ TAXABLE
cell(totalX, totalRowY, cols[5], 20, "", "center");
totalX += cols[5];

// 6️⃣ GST %
cell(totalX, totalRowY, cols[6], 20, "", "center");
totalX += cols[6];

// 7️⃣ IGST
cell(totalX, totalRowY, cols[7], 20, "", "center");
totalX += cols[7];

// 8️⃣ FINAL TOTAL
cell(
  totalX,
  totalRowY,
  cols[8],
  20,
  totalPricefor.toFixed(2),
  "center",
  true
);

cursorY += 20;
    /* ---------------- TOTALS ---------------- */
    cursorY += 5;

    const totalBoxX = pageWidth - 220;
    const rowHeight = 20;

    // Subtotal
    doc.rect(totalBoxX, cursorY, 200, rowHeight).stroke();
    doc.fontSize(9).font("Helvetica-Bold").text("Total:", totalBoxX + 10, cursorY + 6);
    doc.text(`Rs. ${totalPricefor.toFixed(2)}`, totalBoxX + 10, cursorY + 6, { width: 180, align: "right" });
    cursorY += rowHeight;

    // CGST
    doc.rect(totalBoxX, cursorY, 200, rowHeight).stroke();
    doc.font("Helvetica").text("Discount:", totalBoxX + 10, cursorY + 6);
    doc.text(`Rs. ${discount.toFixed(2)}`, totalBoxX + 10, cursorY + 6, { width: 180, align: "right" });
    cursorY += rowHeight;

    // SGST
    doc.rect(totalBoxX, cursorY, 200, rowHeight).stroke();
    doc.text("Shipping Fee:", totalBoxX + 10, cursorY + 6);
    doc.text(`Rs. ${shippingfee.toFixed(2)}`, totalBoxX + 10, cursorY + 6, { width: 180, align: "right" });
    cursorY += rowHeight;

    // Grand Total
    doc.rect(totalBoxX, cursorY, 200, rowHeight).fillAndStroke("#5e8046", "#000");
    doc.fillColor("#fff").font("Helvetica-Bold").text("Grand Total:", totalBoxX + 10, cursorY + 6);
    doc.text(`Rs. ${totalPrice.toFixed(2)}`, totalBoxX + 10, cursorY + 6, { width: 180, align: "right" });
    cursorY += rowHeight + 10;

    /* ---------------- AMOUNT IN WORDS ---------------- */
    doc.fillColor("#000").fontSize(9).font("Helvetica-Bold");
    doc.text("Amount in Words:", startX, cursorY);
    cursorY += 15;
    doc.font("Helvetica").text(amountInWords, startX, cursorY, { width: 400 });
    cursorY += 30;

    /* ---------------- TERMS & CONDITIONS ---------------- */
    doc.fontSize(8).font("Helvetica-Bold").text("Terms & Conditions:", startX, cursorY);
    cursorY += 12;
    doc.font("Helvetica").fontSize(7);
    doc.text("1. Goods once sold will not be taken back.", startX, cursorY);
    cursorY += 10;
    doc.text("2. Interest @ 5% p.a. will be charged if the payment is not made within the stipulated time.", startX, cursorY);
    cursorY += 10;
    doc.text("3. Subject to Delhi Jurisdiction only.", startX, cursorY);
    cursorY += 30;

    /* ---------------- SIGNATURE ---------------- */
    // doc.fontSize(9).font("Helvetica-Bold");
    // doc.text("For " + companyName, pageWidth - 200, cursorY, { align: "left" });
    // cursorY += 40;
    // doc.text("Authorized Signatory", pageWidth - 200, cursorY, { align: "left" });

    /* ---------------- FOOTER ---------------- */
    // doc.fontSize(7).font("Helvetica").fillColor("#666");
    // doc.text(
    //   "This is a computer-generated invoice and does not require a signature.",
    //   startX,
    //   pageHeight - 40,
    //   { width: pageWidth - 40, align: "center" }
    // );

    doc.end();

    return new Promise((resolve, reject) => {
      doc.on("end", () => {
        const pdfBuffer = Buffer.concat(buffers);
        resolve(pdfBuffer);
      });
      doc.on("error", reject);
    });

  } catch (error) {
    console.error("❌ Invoice generation error:", error);
    throw error;
  }
}
