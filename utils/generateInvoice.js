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




// import puppeteer from "puppeteer";
// import fs from "fs";
// import path from "path";


// export async function generateInvoiceBuffer(order, subscription, customer, invoiceNumber, shippingDate) {
//   // Map frequency string to number
//   let frequency = 1;
//   const freqStr = (subscription.frequency || "").toLowerCase();
//   if (freqStr.includes("once")) frequency = 1;
//   else if (freqStr.includes("twice")) frequency = 2;
//   else if (freqStr.includes("thrice")) frequency = 3;

//   // Calculate amounts
//   const quantity = subscription.quantity || 1;
//   const period = subscription.period || 1;
//   const basePrice = subscription.totalAmount / ( period * quantity * frequency );
//   const singleTotal = basePrice * quantity;
//   const gstPercent = 5;
//   const gstValue = (singleTotal * gstPercent) / 100;
//   const singleTotalWithGst = singleTotal - gstValue;
//   const deliveryFee =  ( subscription.deliveryFee || 0 ) / ( period * frequency ) ;
//   const grandTotal = singleTotal + deliveryFee;

//   const paidImagePath = path.resolve("public/paid-img.PNG");
// const signImagePath = path.resolve("public/sign-img.PNG");

// const paidBase64 = fs.readFileSync(paidImagePath).toString("base64");
// const signBase64 = fs.readFileSync(signImagePath).toString("base64");


// // Convert number to words (Indian format – Rupees)
// function numberToWords(num) {
//   const a = [
//     "", "One", "Two", "Three", "Four", "Five", "Six",
//     "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
//     "Thirteen", "Fourteen", "Fifteen", "Sixteen",
//     "Seventeen", "Eighteen", "Nineteen"
//   ];
//   const b = [
//     "", "", "Twenty", "Thirty", "Forty",
//     "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"
//   ];

//   const inWords = (n) => {
//     if (n < 20) return a[n];
//     if (n < 100)
//       return b[Math.floor(n / 10)] + (n % 10 ? " " + a[n % 10] : "");
//     if (n < 1000)
//       return (
//         a[Math.floor(n / 100)] +
//         " Hundred" +
//         (n % 100 ? " " + inWords(n % 100) : "")
//       );
//     if (n < 100000)
//       return (
//         inWords(Math.floor(n / 1000)) +
//         " Thousand" +
//         (n % 1000 ? " " + inWords(n % 1000) : "")
//       );
//     if (n < 10000000)
//       return (
//         inWords(Math.floor(n / 100000)) +
//         " Lakh" +
//         (n % 100000 ? " " + inWords(n % 100000) : "")
//       );
//     return (
//       inWords(Math.floor(n / 10000000)) +
//       " Crore" +
//       (n % 10000000 ? " " + inWords(n % 10000000) : "")
//     );
//   };

//   const [rupees, paise] = num.toFixed(2).split(".");
//   let words = inWords(parseInt(rupees)) + " Rupees";

//   if (parseInt(paise) > 0) {
//     words += " and " + inWords(parseInt(paise)) + " Paise";
//   }

//   return words + " Only";
// }

// const amountInWords = numberToWords(grandTotal);

// // Product → HSN mapping
// const productHsnMap = {
//   "Nuts & Seed Milk Alternative Almond+ | 250 ml": "20098990",
//   "Nuts & Seed Milk Alternative Oats+ | 250 ml": "22029990",
//   "Nuts & Seed Curd Alternative Peanut + | 500 g": "20081100",
//   "100% Whole Wheat Bread | 250 g": "19052000",
//   "Whole Multigrain & Seed Bread | 250 g": "19051000",
//   "Cashew Mustard Spread 250 g": "2103",
//   "Nuts & Seed Butter Alternative Mighty Dozen | 250 g": "20081100",
//   "Oatmeal Bowl 300 g": "9963",
//   "Sprouts Salad | 250 g": "2106",
//   "Berry Blast | 250 ml": "22029990",
//   "Green Juice | 1 L": "20099000",
//   "Green Juice | 250 ml": "20099000",
//   "Nut & Seed Granola 150 g": "2008",
// };

// // Get HSN based on subscription.product
// const hsnCode = productHsnMap[subscription.product] || "-";
// const supplyDate = shippingDate;


//   const html = `
//   <!DOCTYPE html>
//   <html>
//     <head>
//       <meta charset="UTF-8" />
//       <style>
//         body { font-family: Arial, sans-serif; margin: 0; padding: 0; }
//         .page { border: 2px solid #000; padding: 20px; width: 210mm; height: 297mm; box-sizing: border-box; }
//         .header { display: flex; justify-content: space-between; margin-bottom: 10px; }
//         .header-left { font-weight: bold; font-size: 14px; }
//         .header-right { text-align: right; font-size: 12px; }
//         .gst-cin { margin-top: 5px; }
//         .centered { text-align: center; margin-bottom: 5px; }
//         .contact-row { display: flex; justify-content: space-between; margin-bottom: 15px; font-size: 12px; }
//         table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
//         table, th, td { border: 1px solid #000; padding: 5px; font-size: 12px; }
//         .product-table th { background: #f0f0f0; }
//         .right { text-align: right; }
//       </style>
//     </head>
//     <body>
//       <div class="page">
//         <div class="header">
//           <div class="header-left">
//             <span style="font-size: 25px;font-weight: 700;">TAX INVOICE</span><br/><br/>
//             <div class="gst-cin" >
//               <strong style="font-size: 12px;">GSTIN: 06AAOCP2140F1ZM</strong><br/>
//              <strong style="font-size: 12px;">CIN: U10797DL2023PTC422253</strong> 
//             </div>
//           </div>
//           <div class="header-right">
//             <strong style="font-size: 14px;">ORIGINAL</strong><br/>
//             <strong style="font-size: 12px;">FSSAI LIC NO.: 13324999000116</strong>
//           </div>
//         </div>

//         <div class="centered">
//           <h2 style="font-size: 13px;font-weight: 600;">PBW Foods Private Limited</h2>
//           <p style="font-size: 11px;">PBW Foods Private Limited, Bldg #5, Epitome, Ground Floor, DLF Cyber City Rd, Phase 3, Sector 24, Gurugram - 122002, Haryana, India</p>
//         </div>

//         <div class="contact-row">
//           <div style="font-weight: 700;">email@pbwfoods.com</div>
//           <div style="font-weight: 700;">www.pbwfoods.com</div>
//           <div style="font-weight: 700;">080-47360729</div>
//         </div>

//         <!-- 3x3 Invoice Table -->
//         <table>
//           <tr>
//             <td>Invoice No: <strong>${invoiceNumber}</strong></td>
//             <td>Order No: <strong>PBW${order.order_number}</strong></td>
//             <td></td>
//           </tr>
//           <tr>
//             <td>Invoice Date: <strong>${new Date().toLocaleDateString()}</strong></td>
//             <td>Order Date:<strong>${new Date().toLocaleDateString()}</strong> </td>
//             <td>Date of Supply: <strong>${new Date(supplyDate).toLocaleDateString()}</strong></td>
//           </tr>
//           <tr>
//             <td>State: <strong>Haryana</strong></td>
//             <td>Code: <strong>6</strong></td>
//             <td>Place of Supply: <strong>${subscription.address.city}</strong></td>
//           </tr>
//         </table>

//         <!-- 2x5 BILL TO / SHIP TO -->
//         <table style="margin-top: 40px;">
//           <tr>
//             <th style="background-color: #f0f0f0;">BILL TO PARTY</th>
//             <th style="background-color: #f0f0f0;">SHIP TO PARTY / DELIVERY ADDRESS</th>
//           </tr>
//           <tr>
//             <td><strong>${customer.name}</strong></td>
//             <td><strong>${customer.name}</strong></td>
//           </tr>
//           <tr>
//             <td>${subscription.address?.line1 || ''}, ${subscription.address?.line2 || ''}, ${subscription.address?.city || ''}, ${subscription.address?.state || ''}, ${subscription.address?.pincode || ''}</td>
//             <td>${subscription.address?.line1 || ''}, ${subscription.address?.line2 || ''}, ${subscription.address?.city || ''}, ${subscription.address?.state || ''}, ${subscription.address?.pincode || ''}</td>
//           </tr>
//           <tr>
//             <td><strong>Phone:</strong>${subscription.address?.phone || subscription.customer?.contact || ''}</td>
//             <td><strong>Phone:</strong>${subscription.address?.phone || subscription.customer?.contact || ''}</td>
//           </tr>
//        <tr>
//   <!-- Left cell -->
//   <td style="width:50%; padding: 0px; vertical-align: middle;">
//     <span style="padding: 5px;"><strong>State:</strong> ${subscription.address?.state || ''}</span>
//     <span style="display:inline-block; border-left: 1px solid #000; height: 20px; vertical-align: middle; margin: 0 5px;"></span>
//     <span style="padding: 5px;"><strong>Country:</strong> India</span>
//   </td>

//   <!-- Right cell -->
//   <td style="width:50%; padding: 0px; vertical-align: middle;">
//     <span style="padding: 5px;"><strong>State:</strong> ${subscription.address?.state || ''}</span>
//     <span style="display:inline-block; border-left: 1px solid #000; height: 20px; vertical-align: middle; margin: 0 5px;"></span>
//     <span style="padding: 5px;"><strong>Country:</strong> India</span>
//   </td>
// </tr>






//         </table>

//         <!-- Product Details 8x5 -->
//         <table style="margin-top: 40px;" class="product-table">
//           <tr>
//             <th style="font-weight: 800;font-size: 10px;">#</th>
//             <th style="font-weight: 800;font-size: 10px;">ITEM - SKU</th>
//             <th style="font-weight: 800;font-size: 10px;">HSN</th>
//             <th style="font-weight: 800;font-size: 10px;">QTY</th>
//             <th style="font-weight: 800;font-size: 10px;">RATE PER ITEM(₹)</th>
//             <th style="font-weight: 800;font-size: 10px;">TAXABLE ITEM(₹)</th>
//             <th style="font-weight: 800;font-size: 10px;">GST(%)</th>
//             <th style="font-weight: 800;font-size: 10px;">IGST(₹)</th>
//             <th style="font-weight: 800;font-size: 10px;">TOTAL(₹)</th>
//           </tr>
//           <tr>
//             <td>1</td>
//             <td>${subscription.product}</td>
//             <td>${hsnCode}</td>
//             <td>${quantity}</td>
//             <td>${basePrice.toFixed(2)}</td>
//             <td>${singleTotalWithGst.toFixed(2)}</td>
//             <td>${gstPercent}</td>
//             <td>${gstValue.toFixed(2)}</td>
//             <td>${singleTotal.toFixed(2)}</td>
//           </tr>
//          <tr>
//   <td>2</td>
//   <td></td>
//   <td></td>
//   <td></td>
//   <td></td>
//   <td></td>
//   <td></td>
//   <td></td>
//   <td></td>
// </tr>
// <tr>
//   <td>3</td>
//   <td></td>
//   <td></td>
//   <td></td>
//   <td></td>
//   <td></td>
//   <td></td>
//   <td></td>
//   <td></td>
// </tr>
// <tr>
//   <td>4</td>
//   <td></td>
//   <td></td>
//   <td></td>
//   <td></td>
//   <td></td>
//   <td></td>
//   <td></td>
//   <td></td>
// </tr>
// <tr>
//   <td colspan="2" style="background-color: #f0f0f0;text-align: center;font-weight: 800;font-size: 10px;"><strong>TOTAL</strong></td>
//   <td></td>
//   <td style="font-weight: 700;">${quantity}</td>
//   <td></td>
//   <td></td>
//   <td></td>
//   <td></td>
//   <td style="font-weight: 700;">${singleTotal.toFixed(2)}</td>
// </tr>
// <tr>
//   <td colspan="5"><strong>Payment Mode :</strong></td>
//   <td colspan="3">Total amount before Tax (₹)</td>
//   <td>${singleTotalWithGst.toFixed(2)}</td>
// </tr>

// <tr>
//   <td colspan="5"><strong>Order Note :</strong></td>
//   <td colspan="3">Total Tax amount(₹)</td>
//   <td>${gstValue.toFixed(2)}</td>
// </tr>

// <tr>
//   <td colspan="5"><strong>Terms and Conditions</strong></td>
//   <td colspan="3"><strong></strong></td>
//   <td></td>
 
// </tr>

// <tr>
//   <td colspan="5" style="border-bottom: none;">
//   <strong>Total Invoice Amount in Words</strong><br>
//   ${amountInWords}
// </td>

//   <td colspan="3" style="border-bottom: none;">Shipping amount(₹)</td>
//   <td style="border-bottom: none;">${deliveryFee.toFixed(2)}</td>
// </tr>

// <tr>
//   <td colspan="5" style="border-top: none; border-bottom: none; border-left: 1px solid #000; border-right: 1px solid #000;"></td>
//   <td colspan="3">Total amount after Tax(₹)</td>
//   <td >${singleTotal.toFixed(2)}</td>
// </tr>
// <tr>
//   <td colspan="5" style="border-top: none; border-bottom: none; border-left: 1px solid #000; border-right: 1px solid #000;"><!-- empty --></td>
//   <td colspan="3" style="border-top: none;">Round Off </td>
//   <td style="border-top: none;">-</td>
// </tr>
// <tr>
//   <td colspan="5" style="border-top: none;"><!-- empty --></td>
//   <td colspan="3" style="border-top: none;font-weight: 800;font-size: 10px;">TOTAL (₹)</td>
//   <td style="border-top: none;font-weight: 800;font-size: 10px;">${grandTotal.toFixed(2)}</td>
// </tr>
// <tr>
//   <!-- Left side -->
//   <td colspan="5" style="vertical-align: top; text-align: left; padding: 10px 5px; border-right: none;">
//     <div><strong>E. & O.E</strong></div>
//     <div><img src="data:image/png;base64,${paidBase64}" alt="Left Image" style="height:50px; margin-top:5px;"></div>
//   </td>

//   <!-- Right side -->
//   <td colspan="5" style="vertical-align: top; text-align: right; padding: 20px 5px; border-left: none;padding-top: 50px;">
//     <div style="font-weight: 800;font-size: 10px;">For, PBW Foods Private Limited</div>
//     <div><img src="data:image/png;base64,${signBase64}" alt="Signature" style="height:30px; margin-top:5px;"></div>
//     <div>Authorised Signature</div>
//   </td>
// </tr>
//         </table>

       

//       </div>
//     </body>
//   </html>

//   `;

//  const browser = await puppeteer.launch({
//   headless: true,
//   executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
//   args: [
//     "--no-sandbox",
//     "--disable-setuid-sandbox",
//     "--disable-dev-shm-usage",
//     "--single-process",
//     "--no-zygote",
//   ],
// });

//   const page = await browser.newPage();
//   await page.setContent(html, { waitUntil: "networkidle0" });

//   const pdfBuffer = await page.pdf({
//     format: "A4",
//     printBackground: true,
//     margin: { top: 20, bottom: 20, left: 20, right: 20 }
//   });

//   await browser.close();
//   return pdfBuffer;
// }

