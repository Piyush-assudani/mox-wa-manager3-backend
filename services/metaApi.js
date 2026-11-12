const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const axios = require("axios");
const fs = require("fs");
const FormData = require("form-data");

/**
 * Returns dynamic Meta configuration from environment variables
 */
const getMetaConfig = () => {
  const version = process.env.META_GRAPH_API_VERSION || process.env.META_API_VERSION || "v20.0";
  const apiBase = `https://graph.facebook.com/${version}`;
  const phoneId = process.env.META_PHONE_ID || process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.META_WHATSAPP_TOKEN || process.env.META_ACCESS_TOKEN;
  const wabaId = process.env.META_WABA_ID || process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  return { apiBase, phoneId, token, wabaId };
};

const sendTemplateMessage = async (to, templateName, languageCode = "en_US", components = []) => {
  const { apiBase, phoneId, token } = getMetaConfig();

  if (!token || !phoneId) {
    return {
      success: false,
      error: "Meta WhatsApp Cloud API credentials (PHONE_NUMBER_ID / ACCESS_TOKEN) not configured in backend .env.",
    };
  }

  try {
    const sanitizedTo = to ? String(to).replace(/\D/g, "") : "";
    if (!sanitizedTo || sanitizedTo.length < 10) {
      return { success: false, error: `Invalid recipient phone number: "${to}"` };
    }

    const payload = {
      messaging_product: "whatsapp",
      to: sanitizedTo,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
      },
    };

    if (components && components.length > 0) {
      payload.template.components = components;
    }

    const response = await axios.post(`${apiBase}/${phoneId}/messages`, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });

    return {
      success: true,
      messageId: response.data.messages?.[0]?.id || null,
      data: response.data,
    };
  } catch (err) {
    console.error(`❌ Meta API sendTemplate error for ${to}:`, err.response?.data || err.message);
    const metaErr = err.response?.data?.error;
    const detailedError = metaErr?.error_data?.details
      ? `${metaErr.message} (${metaErr.error_data.details})`
      : metaErr?.user_msg || metaErr?.message || err.message;
    return {
      success: false,
      error: detailedError,
    };
  }
};

const sendTextMessage = async (to, text) => {
  const { apiBase, phoneId, token } = getMetaConfig();

  if (!token || !phoneId) {
    return {
      success: false,
      error: "Meta WhatsApp Cloud API credentials not configured in backend .env.",
    };
  }

  try {
    const sanitizedTo = to ? String(to).replace(/\D/g, "") : "";
    const payload = {
      messaging_product: "whatsapp",
      to: sanitizedTo,
      type: "text",
      text: { body: text },
    };

    const response = await axios.post(`${apiBase}/${phoneId}/messages`, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });

    return {
      success: true,
      messageId: response.data.messages?.[0]?.id || null,
      data: response.data,
    };
  } catch (err) {
    console.error("❌ Meta API sendText error:", err.response?.data || err.message);
    return {
      success: false,
      error: err.response?.data?.error?.message || err.message,
    };
  }
};

const sendMediaMessage = async (to, mediaUrl, type = "image") => {
  const { apiBase, phoneId, token } = getMetaConfig();

  if (!token || !phoneId) {
    return {
      success: false,
      error: "Meta WhatsApp Cloud API credentials not configured in backend .env.",
    };
  }

  try {
    const sanitizedTo = to ? String(to).replace(/\D/g, "") : "";
    const payload = {
      messaging_product: "whatsapp",
      to: sanitizedTo,
      type,
      [type]: { link: mediaUrl },
    };

    const response = await axios.post(`${apiBase}/${phoneId}/messages`, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      timeout: 20000,
    });

    return {
      success: true,
      messageId: response.data.messages?.[0]?.id || null,
      data: response.data,
    };
  } catch (err) {
    console.error("❌ Meta API sendMedia error:", err.response?.data || err.message);
    return {
      success: false,
      error: err.response?.data?.error?.message || err.message,
    };
  }
};

const sendMediaById = async (to, mediaId, type = "image") => {
  const { apiBase, phoneId, token } = getMetaConfig();

  if (!token || !phoneId) {
    return {
      success: false,
      error: "Meta WhatsApp Cloud API credentials not configured in backend .env.",
    };
  }

  try {
    const sanitizedTo = to ? String(to).replace(/\D/g, "") : "";
    const payload = {
      messaging_product: "whatsapp",
      to: sanitizedTo,
      type,
      [type]: { id: mediaId },
    };

    const response = await axios.post(`${apiBase}/${phoneId}/messages`, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      timeout: 20000,
    });

    return {
      success: true,
      messageId: response.data.messages?.[0]?.id || null,
      data: response.data,
    };
  } catch (err) {
    console.error("❌ Meta API sendMediaById error:", err.response?.data || err.message);
    return {
      success: false,
      error: err.response?.data?.error?.message || err.message,
    };
  }
};

const uploadMediaToMeta = async (filePath, mimeType) => {
  const { apiBase, phoneId, token } = getMetaConfig();

  if (!token || !phoneId) {
    console.warn("⚠️ Meta Cloud credentials not set; skipping uploadMediaToMeta");
    return null;
  }

  try {
    const formData = new FormData();
    formData.append("file", fs.createReadStream(filePath));
    formData.append("type", mimeType);
    formData.append("messaging_product", "whatsapp");

    const response = await axios.post(`${apiBase}/${phoneId}/media`, formData, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...formData.getHeaders(),
      },
      timeout: 30000, // 30s timeout for media uploads
    });

    return response.data.id;
  } catch (err) {
    const detail = err.response?.data?.error?.message || err.message;
    console.error("❌ Meta API media upload error:", err.response?.data || err.message);
    throw new Error(`Meta media upload failed: ${detail}`);
  }
};

const downloadMediaFromMeta = async (mediaId) => {
  const { apiBase, token } = getMetaConfig();

  if (!token) return null;

  try {
    const urlResponse = await axios.get(`${apiBase}/${mediaId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      timeout: 15000,
    });

    const mediaUrl = urlResponse.data.url;
    const mimeType = urlResponse.data.mime_type;

    if (!mediaUrl) {
      throw new Error("No media URL returned by Meta");
    }

    const mediaResponse = await axios.get(mediaUrl, {
      responseType: "arraybuffer",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      timeout: 30000,
    });

    return {
      buffer: Buffer.from(mediaResponse.data, "binary"),
      mimeType,
    };
  } catch (err) {
    console.error("❌ Meta API download media error:", err.response?.data || err.message);
    return null;
  }
};

const getTemplates = async () => {
  const { apiBase, token, wabaId } = getMetaConfig();

  if (!token || !wabaId) {
    return [];
  }

  try {
    const response = await axios.get(`${apiBase}/${wabaId}/message_templates`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      params: {
        limit: 100,
        fields: "name,status,category,language,components,id,last_updated_time",
      },
      timeout: 15000,
    });

    return response.data.data || [];
  } catch (err) {
    console.error("❌ Meta API getTemplates error:", err.response?.data || err.message);
    throw new Error(err.response?.data?.error?.message || err.message);
  }
};

let cachedAppId = null;

const getMetaAppId = async () => {
  if (cachedAppId) return cachedAppId;
  const { apiBase, token } = getMetaConfig();
  try {
    const res = await axios.get(`${apiBase}/app`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000,
    });
    cachedAppId = res.data?.id;
    return cachedAppId;
  } catch (err) {
    console.error("❌ Failed to query Meta app ID:", err.response?.data || err.message);
    return null;
  }
};

// 1x1 transparent PNG buffer for fallback sample
const DEFAULT_SAMPLE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);
// Minimal valid PDF for fallback sample
const DEFAULT_SAMPLE_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 3 3]>>endobj\nxref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000052 00000 n\n0000000101 00000 n\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n147\n%%EOF\n"
);

const createSampleMediaHandle = async (fileBuffer, mimeType, fileName) => {
  const { apiBase, token } = getMetaConfig();
  const appId = await getMetaAppId();

  if (!appId || !token) {
    throw new Error("Unable to obtain Meta App ID or Access Token for sample media upload.");
  }

  // 1. Create upload session
  const sessionRes = await axios.post(`${apiBase}/${appId}/uploads`, null, {
    params: {
      file_length: fileBuffer.length,
      file_type: mimeType,
      file_name: fileName || "sample_file",
    },
    headers: {
      Authorization: `Bearer ${token}`,
    },
    timeout: 20000,
  });

  const uploadId = sessionRes.data?.id;
  if (!uploadId) {
    throw new Error("Meta Resumable Upload session failed to return upload ID.");
  }

  // 2. Upload binary stream
  const uploadRes = await axios.post(`${apiBase}/${uploadId}`, fileBuffer, {
    headers: {
      Authorization: `Bearer ${token}`,
      file_offset: 0,
      "Content-Type": "application/octet-stream",
    },
    timeout: 30000,
  });

  const handle = uploadRes.data?.h;
  if (!handle) {
    throw new Error("Meta Resumable Upload failed to return header_handle.");
  }

  return handle;
};

const createTemplate = async (
  name,
  language,
  category,
  text,
  headerType = "NONE",
  headerText = "",
  footerText = "",
  buttons = [],
  sampleFile = null,
  sampleUrl = null,
  bodyExamples = [],
  headerExample = ""
) => {
  const { apiBase, token, wabaId } = getMetaConfig();

  if (!token || !wabaId) {
    throw new Error("Meta WABA_ID or META_ACCESS_TOKEN is missing in backend .env.");
  }

  try {
    const bodyMatches = text.match(/\{\{\d+\}\}/g);
    const bodyComponent = {
      type: "BODY",
      text: text,
    };

    if (bodyMatches && bodyMatches.length > 0) {
      const uniqueVars = Array.from(new Set(bodyMatches));
      let sampleList = [];
      if (Array.isArray(bodyExamples) && bodyExamples.length > 0) {
        sampleList = bodyExamples.slice(0, uniqueVars.length);
        for (let i = sampleList.length; i < uniqueVars.length; i++) {
          sampleList.push(`Sample ${i + 1}`);
        }
      } else {
        sampleList = uniqueVars.map((_, i) => `Sample ${i + 1}`);
      }
      bodyComponent.example = {
        body_text: [sampleList],
      };
    }

    const components = [bodyComponent];

    if (headerType && headerType !== "NONE") {
      if (headerType === "TEXT" && headerText) {
        const headerMatches = headerText.match(/\{\{\d+\}\}/g);
        const headerComponent = {
          type: "HEADER",
          format: "TEXT",
          text: headerText,
        };
        if (headerMatches && headerMatches.length > 0) {
          headerComponent.example = {
            header_text: [headerExample || "Sample Header"],
          };
        }
        components.unshift(headerComponent);
      } else if (["IMAGE", "VIDEO", "DOCUMENT"].includes(headerType)) {
        let sampleBuffer = null;
        let sampleMime = "image/png";
        let sampleName = "sample.png";

        if (sampleFile && sampleFile.buffer) {
          sampleBuffer = sampleFile.buffer;
          sampleMime = sampleFile.mimetype || "image/png";
          sampleName = sampleFile.originalname || "sample";
        } else if (sampleFile && sampleFile.path) {
          sampleBuffer = await fs.promises.readFile(sampleFile.path);
          sampleMime = sampleFile.mimetype || "image/png";
          sampleName = sampleFile.originalname || "sample";
        } else if (sampleUrl && typeof sampleUrl === "string") {
          try {
            const normalizedUrl = sampleUrl;
            const match = normalizedUrl.match(/\/uploads\/([^/]+)\/([^/?#]+)/);
            if (match) {
              const localPath = path.join(process.cwd(), "uploads", match[1], match[2]);
              if (fs.existsSync(localPath)) {
                sampleBuffer = await fs.promises.readFile(localPath);
                sampleName = match[2];
                sampleMime = match[2].endsWith(".png") ? "image/png" : match[2].endsWith(".jpg") || match[2].endsWith(".jpeg") ? "image/jpeg" : "image/png";
              }
            }
            if (!sampleBuffer) {
              const urlRes = await axios.get(normalizedUrl, { responseType: "arraybuffer", timeout: 15000 });
              sampleBuffer = Buffer.from(urlRes.data);
              sampleMime = urlRes.headers["content-type"] || "image/png";
              sampleName = "sample";
            }
          } catch (fetchErr) {
            console.warn("⚠️ Failed to fetch sampleUrl buffer, falling back to default sample:", fetchErr.message);
          }
        }

        if (!sampleBuffer) {
          if (headerType === "DOCUMENT") {
            sampleBuffer = DEFAULT_SAMPLE_PDF;
            sampleMime = "application/pdf";
            sampleName = "sample.pdf";
          } else {
            sampleBuffer = DEFAULT_SAMPLE_PNG;
            sampleMime = "image/png";
            sampleName = "sample.png";
          }
        }

        const realHandle = await createSampleMediaHandle(sampleBuffer, sampleMime, sampleName);

        components.unshift({
          type: "HEADER",
          format: headerType,
          example: {
            header_handle: [realHandle],
          },
        });
      }
    }

    if (footerText && footerText.trim()) {
      components.push({
        type: "FOOTER",
        text: footerText.trim(),
      });
    }

    if (buttons && Array.isArray(buttons) && buttons.length > 0) {
      const buttonComponent = {
        type: "BUTTONS",
        buttons: buttons
          .map((btn) => {
            if (btn.type === "QUICK_REPLY") {
              return { type: "QUICK_REPLY", text: String(btn.text).slice(0, 25) };
            } else if (btn.type === "URL") {
              const urlObj = { type: "URL", text: String(btn.text).slice(0, 25), url: btn.url };
              if (btn.url?.includes("{{1}}") && btn.urlExample) {
                urlObj.example = [btn.urlExample];
              }
              return urlObj;
            } else if (btn.type === "PHONE_NUMBER") {
              return { type: "PHONE_NUMBER", text: String(btn.text).slice(0, 25), phone_number: btn.phone_number };
            } else if (btn.type === "COPY_CODE") {
              return { type: "COPY_CODE", example: btn.code || btn.example || "PROMO2026" };
            }
            return null;
          })
          .filter(Boolean),
      };
      if (buttonComponent.buttons.length > 0) {
        components.push(buttonComponent);
      }
    }

    const payload = {
      name: name.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
      language,
      category,
      components,
    };

    const response = await axios.post(`${apiBase}/${wabaId}/message_templates`, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      timeout: 20000,
    });

    return response.data;
  } catch (err) {
    console.error("❌ Meta API createTemplate error:", err.response?.data || err.message);
    const metaErr = err.response?.data?.error;
    let errorDetail = metaErr?.error_user_msg || metaErr?.error_user_title || metaErr?.user_msg || metaErr?.message || err.message;
    if (metaErr?.code === 131009 || metaErr?.error_subcode === 2494102 || metaErr?.error_subcode === 2388273) {
      errorDetail = "Meta requires an active sample media upload to create templates with Image/Video/Document headers. Please create media header templates directly in Meta WhatsApp Business Manager (business.facebook.com), or select 'None (Text Only)' here.";
    }
    throw new Error(errorDetail);
  }
};

const getAccountHealth = async () => {
  const { apiBase, phoneId, token } = getMetaConfig();

  if (!token || !phoneId) {
    return {
      success: false,
      error: "Meta API credentials not set in backend .env.",
    };
  }

  try {
    const response = await axios.get(
      `${apiBase}/${phoneId}?fields=display_phone_number,name_status,quality_rating,messaging_limit_tier,status,verified_name`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        timeout: 10000,
      }
    );
    return { success: true, data: response.data };
  } catch (err) {
    console.error("❌ Meta API getAccountHealth error:", err.response?.data || err.message);
    return { success: false, error: err.response?.data?.error?.message || err.message };
  }
};

module.exports = {
  sendTemplateMessage,
  sendTextMessage,
  uploadMediaToMeta,
  downloadMediaFromMeta,
  getTemplates,
  createTemplate,
  sendMediaMessage,
  sendMediaById,
  getAccountHealth,
};
