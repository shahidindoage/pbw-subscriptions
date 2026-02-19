import { Dropbox } from "dropbox";
import fetch from "node-fetch"; // remove if using Node 18+
import axios from "axios";

/* =====================================
   🔐 STEP 1: Get Fresh Access Token
===================================== */

async function getDropboxAccessToken() {
  try {
    const response = await axios.post(
      "https://api.dropboxapi.com/oauth2/token",
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: process.env.DROPBOX_REFRESH_TOKEN,
        client_id: process.env.DROPBOX_CLIENT_ID,
        client_secret: process.env.DROPBOX_CLIENT_SECRET,
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    return response.data.access_token;

  } catch (error) {
    console.error("❌ Dropbox Token Refresh Failed:", error.response?.data || error.message);
    throw error;
  }
}

/* =====================================
   📂 STEP 2: Upload File
===================================== */

export async function uploadInvoiceToDropbox(buffer, filename) {
  try {
    // 🔥 Always get fresh access token
    const accessToken = await getDropboxAccessToken();

    const dbx = new Dropbox({
      accessToken,
      fetch,
    });

    const dropboxPath = `/invoices/${filename}`;

    /* ================================
       Upload File
    ================================ */

    await dbx.filesUpload({
      path: dropboxPath,
      contents: buffer,
      mode: "overwrite",
    });

    /* ================================
       Create Shared Link
    ================================ */

    const sharedLinkResponse =
      await dbx.sharingCreateSharedLinkWithSettings({
        path: dropboxPath,
      });

    let url = sharedLinkResponse.result.url;

    /* ================================
       Convert to Direct Download
    ================================ */

    url = url.replace("?dl=0", "?raw=1");

    return url;

  } catch (error) {
    console.error("❌ Dropbox Upload Failed:", error?.response?.data || error.message);
    throw error;
  }
}
