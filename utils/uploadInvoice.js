import fs from "fs";
import path from "path";

/**
 * Saves invoice PDF to filesystem
 * @param {Buffer} buffer
 * @param {String} filename
 * @returns {String} public URL path
 */
export async function uploadInvoice(buffer, filename) {
  try {
    const uploadDir = path.join(process.cwd(), "public", "uploads", "invoices");

    // Create folder if not exists
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const filePath = path.join(uploadDir, filename);

    // Write file
    await fs.promises.writeFile(filePath, buffer);

    // Return public accessible path
    return `/uploads/invoices/${filename}`;

  } catch (error) {
    console.error("Invoice upload failed:", error);
    throw error;
  }
}