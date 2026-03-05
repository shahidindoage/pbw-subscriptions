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

    /* ---------------- HEADER ---------------- */
    doc.fontSize(20).font("Helvetica-Bold").text("TAX INVOICE", startX, cursorY, {
      width: pageWidth - 40,
      align: "center",
    });
    cursorY += 30;

    // Company details
    doc.fontSize(14).font("Helvetica-Bold").text(companyName, startX, cursorY);
    cursorY += 18;
    doc.fontSize(9).font("Helvetica").text(companyAddress, startX, cursorY);
    cursorY += 28;
    doc.text(`GSTIN: ${companyGSTIN}`, startX, cursorY);
    cursorY += 12;
    doc.text(`Mobile: ${companyContact} | Email: ${companyEmail}`, startX, cursorY);
    cursorY += 20;

    // Invoice details box
    const invoiceBoxY = cursorY;
    doc.rect(startX, invoiceBoxY, pageWidth - 40, 60).stroke();

    doc.fontSize(9).font("Helvetica-Bold")
      .text("Invoice No:", startX + 10, invoiceBoxY + 10)
      .font("Helvetica")
      .text(invoiceNumber, startX + 80, invoiceBoxY + 10);

    doc.font("Helvetica-Bold")
      .text("Order No:", startX + 250, invoiceBoxY + 10)
      .font("Helvetica")
      .text(order.orderName || order.orderNumber || "N/A", startX + 310, invoiceBoxY + 10);

    doc.font("Helvetica-Bold")
      .text("Invoice Date:", startX + 10, invoiceBoxY + 25)
      .font("Helvetica")
      .text(new Date().toLocaleDateString("en-IN"), startX + 80, invoiceBoxY + 25);

    doc.font("Helvetica-Bold")
      .text("Order Date:", startX + 250, invoiceBoxY + 25)
      .font("Helvetica")
      .text(new Date(order.orderCreatedAt).toLocaleDateString("en-IN"), startX + 310, invoiceBoxY + 25);

    cursorY = invoiceBoxY + 70;

    /* ---------------- CUSTOMER DETAILS ---------------- */
    const shipping = typeof order.shippingAddress === 'string' 
      ? JSON.parse(order.shippingAddress) 
      : order.shippingAddress || {};
    
    const billing = typeof order.billingAddress === 'string'
      ? JSON.parse(order.billingAddress)
      : order.billingAddress || {};

    doc.fontSize(10).font("Helvetica-Bold").text("Bill To:", startX, cursorY);
    cursorY += 15;

    const customerName = order.customerName || 
      `${shipping.first_name || ''} ${shipping.last_name || ''}`.trim() || 
      "Customer";
    
    doc.fontSize(9).font("Helvetica").text(customerName, startX, cursorY);
    cursorY += 12;

    if (shipping.address1) {
      const address = [
        shipping.address1,
        shipping.address2,
        shipping.city,
        shipping.province,
        shipping.zip,
        shipping.country
      ].filter(Boolean).join(", ");
      
      doc.text(address, startX, cursorY, { width: 250 });
      cursorY += 24;
    }

    if (order.customerPhone || shipping.phone) {
      doc.text(`Phone: ${order.customerPhone || shipping.phone}`, startX, cursorY);
      cursorY += 12;
    }

    if (order.customerEmail) {
      doc.text(`Email: ${order.customerEmail}`, startX, cursorY);
      cursorY += 12;
    }

    cursorY += 10;

    /* ---------------- ITEMS TABLE ---------------- */
    const tableTop = cursorY;
    const colWidths = {
      sno: 30,
      description: 220,
      hsn: 70,
      qty: 50,
      rate: 70,
      amount: 75,
    };

    // Table header
    doc.rect(startX, tableTop, pageWidth - 40, 25).fillAndStroke("#5e8046", "#000");
    
    doc.fontSize(9).font("Helvetica-Bold").fillColor("#fff");
    let colX = startX + 5;
    
    doc.text("S.No", colX, tableTop + 8, { width: colWidths.sno, align: "left" });
    colX += colWidths.sno;
    doc.text("Description", colX, tableTop + 8, { width: colWidths.description, align: "left" });
    colX += colWidths.description;
    doc.text("HSN", colX, tableTop + 8, { width: colWidths.hsn, align: "left" });
    colX += colWidths.hsn;
    doc.text("Qty", colX, tableTop + 8, { width: colWidths.qty, align: "center" });
    colX += colWidths.qty;
    doc.text("Rate", colX, tableTop + 8, { width: colWidths.rate, align: "right" });
    colX += colWidths.rate;
    doc.text("Amount", colX, tableTop + 8, { width: colWidths.amount, align: "right" });

    cursorY = tableTop + 25;

    // Table rows
    doc.fillColor("#000");
    lineItems.forEach((item, index) => {
      const rowHeight = 30;
      doc.rect(startX, cursorY, pageWidth - 40, rowHeight).stroke();

      colX = startX + 5;
      doc.fontSize(9).font("Helvetica");
      
      doc.text((index + 1).toString(), colX, cursorY + 10, { width: colWidths.sno, align: "left" });
      colX += colWidths.sno;
      
      doc.text(item.title || item.name || "Product", colX, cursorY + 10, { 
        width: colWidths.description, 
        align: "left",
        ellipsis: true 
      });
      colX += colWidths.description;
      
      doc.text(item.sku || "N/A", colX, cursorY + 10, { width: colWidths.hsn, align: "left" });
      colX += colWidths.hsn;
      
      doc.text(item.quantity?.toString() || "1", colX, cursorY + 10, { width: colWidths.qty, align: "center" });
      colX += colWidths.qty;
      
      const rate = parseFloat(item.price || 0);
      doc.text(`₹${rate.toFixed(2)}`, colX, cursorY + 10, { width: colWidths.rate, align: "right" });
      colX += colWidths.rate;
      
      const amount = rate * (item.quantity || 1);
      doc.text(`₹${amount.toFixed(2)}`, colX, cursorY + 10, { width: colWidths.amount, align: "right" });

      cursorY += rowHeight;
    });

    /* ---------------- TOTALS ---------------- */
    cursorY += 5;

    const totalBoxX = pageWidth - 220;
    const rowHeight = 20;

    // Subtotal
    doc.rect(totalBoxX, cursorY, 200, rowHeight).stroke();
    doc.fontSize(9).font("Helvetica-Bold").text("Subtotal:", totalBoxX + 10, cursorY + 6);
    doc.text(`₹${subtotalPrice.toFixed(2)}`, totalBoxX + 10, cursorY + 6, { width: 180, align: "right" });
    cursorY += rowHeight;

    // CGST
    doc.rect(totalBoxX, cursorY, 200, rowHeight).stroke();
    doc.font("Helvetica").text("CGST (9%):", totalBoxX + 10, cursorY + 6);
    doc.text(`₹${cgst.toFixed(2)}`, totalBoxX + 10, cursorY + 6, { width: 180, align: "right" });
    cursorY += rowHeight;

    // SGST
    doc.rect(totalBoxX, cursorY, 200, rowHeight).stroke();
    doc.text("SGST (9%):", totalBoxX + 10, cursorY + 6);
    doc.text(`₹${sgst.toFixed(2)}`, totalBoxX + 10, cursorY + 6, { width: 180, align: "right" });
    cursorY += rowHeight;

    // Grand Total
    doc.rect(totalBoxX, cursorY, 200, rowHeight).fillAndStroke("#5e8046", "#000");
    doc.fillColor("#fff").font("Helvetica-Bold").text("Grand Total:", totalBoxX + 10, cursorY + 6);
    doc.text(`₹${totalPrice.toFixed(2)}`, totalBoxX + 10, cursorY + 6, { width: 180, align: "right" });
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
    doc.text("2. Interest @ 18% p.a. will be charged if the payment is not made within the stipulated time.", startX, cursorY);
    cursorY += 10;
    doc.text("3. Subject to Delhi Jurisdiction only.", startX, cursorY);
    cursorY += 30;

    /* ---------------- SIGNATURE ---------------- */
    doc.fontSize(9).font("Helvetica-Bold");
    doc.text("For " + companyName, pageWidth - 200, cursorY, { align: "left" });
    cursorY += 40;
    doc.text("Authorized Signatory", pageWidth - 200, cursorY, { align: "left" });

    /* ---------------- FOOTER ---------------- */
    doc.fontSize(7).font("Helvetica").fillColor("#666");
    doc.text(
      "This is a computer-generated invoice and does not require a signature.",
      startX,
      pageHeight - 40,
      { width: pageWidth - 40, align: "center" }
    );

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
