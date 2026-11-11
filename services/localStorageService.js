const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const UPLOADS_ROOT = path.join(__dirname, "../uploads");

// Ensure the root uploads directory exists
if (!fs.existsSync(UPLOADS_ROOT)) {
  fs.mkdirSync(UPLOADS_ROOT, { recursive: true });
}

/**
 * Returns the public base URL for serving uploaded files.
 */
function getBaseUrl() {
  const envUrl = process.env.BASE_URL || process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
  if (envUrl && envUrl.trim() !== "") {
    return envUrl.trim().replace(/\/+$/, "");
  }
  const port = process.env.PORT || 6000;
  return `http://localhost:${port}`;
}

/**
 * Formats a media URL, replacing localhost with the public base URL if configured.
 */
function formatMediaUrl(url) {
  if (!url || typeof url !== "string") return url;
  const baseUrl = getBaseUrl();
  if (baseUrl && !baseUrl.includes("localhost") && !baseUrl.includes("127.0.0.1")) {
    return url.replace(/http:\/\/(localhost|127\.0\.0\.1):\d+/g, baseUrl);
  }
  return url;
}

/**
 * Stores a file from a temporary local path onto the server's uploads directory.
 * @param {string} tempFilePath - Current path of the file (e.g., from multer diskStorage)
 * @param {string} folder - Subdirectory inside uploads (e.g. 'library', 'campaigns', 'direct')
 * @param {string} resourceType - 'image', 'video', 'raw', or 'auto'
 * @returns {Promise<string>} Public URL of the uploaded file on the server
 */
async function uploadFileToServer(tempFilePath, folder = "library", resourceType = "auto") {
  const cleanFolder = folder.replace(/^wp_automation\/?/, "").replace(/[^a-zA-Z0-9_-]/g, "") || "general";
  const targetDir = path.join(UPLOADS_ROOT, cleanFolder);

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  let ext = path.extname(tempFilePath);
  if (!ext || ext === ".tmp" || ext === ".bin") {
    if (resourceType === "video") ext = ".mp4";
    else if (resourceType === "image") ext = ".jpg";
    else if (resourceType === "audio") ext = ".ogg";
    else if (resourceType === "document") ext = ".pdf";
    else ext = ".bin";
  }
  const uniqueId = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
  const filename = `${uniqueId}${ext}`;
  const destination = path.join(targetDir, filename);

  // Copy file to server uploads directory
  await fs.promises.copyFile(tempFilePath, destination);

  const publicUrl = `${getBaseUrl()}/uploads/${cleanFolder}/${filename}`;
  return publicUrl;
}

/**
 * Stores a memory buffer onto the server's uploads directory.
 * @param {Buffer} buffer - Binary file buffer (e.g. from inbound WhatsApp webhook)
 * @param {string} folder - Subdirectory inside uploads (e.g. 'inbound')
 * @param {string} resourceType - 'image', 'video', 'audio', etc.
 * @returns {Promise<string>} Public URL of the uploaded file on the server
 */
async function uploadBufferToServer(buffer, folder = "inbound", resourceType = "auto") {
  const cleanFolder = folder.replace(/^wp_automation\/?/, "").replace(/[^a-zA-Z0-9_-]/g, "") || "general";
  const targetDir = path.join(UPLOADS_ROOT, cleanFolder);

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  let ext = ".bin";
  if (resourceType === "image") ext = ".jpg";
  else if (resourceType === "video") ext = ".mp4";
  else if (resourceType === "audio") ext = ".ogg";
  else if (resourceType === "document") ext = ".pdf";

  const uniqueId = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
  const filename = `${uniqueId}${ext}`;
  const destination = path.join(targetDir, filename);

  await fs.promises.writeFile(destination, buffer);

  const publicUrl = `${getBaseUrl()}/uploads/${cleanFolder}/${filename}`;
  return publicUrl;
}

/**
 * Deletes a file from the server's uploads directory given its public URL.
 * @param {string} mediaUrl
 */
async function deleteFileFromServer(mediaUrl) {
  try {
    if (!mediaUrl || !mediaUrl.includes("/uploads/")) return;
    const parts = mediaUrl.split("/uploads/")[1];
    if (!parts) return;
    const filePath = path.join(UPLOADS_ROOT, parts);
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }
  } catch (err) {
    console.warn("⚠️ Failed to delete local server file:", err.message);
  }
}

module.exports = {
  uploadFileToServer,
  uploadBufferToServer,
  deleteFileFromServer,
  UPLOADS_ROOT,
  getBaseUrl,
  formatMediaUrl,
};
