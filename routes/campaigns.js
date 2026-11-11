const express = require("express");
const router = express.Router();
const multer = require("multer");
const db = require("../db");
const { processCampaign } = require("../services/campaignProcessor");
const { uploadFileToCloudinary } = require("../services/cloudinaryService");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { uploadMediaToMeta, getTemplates, sendTemplateMessage } = require("../services/metaApi");
const { formatMediaUrl } = require("../services/localStorageService");
const { cleanPhoneNumber } = require("../utils/phone");
const { formatMetaError } = require("../utils/metaErrors");

const isValidUuid = (val) =>
  typeof val === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(val);

const uploadMedia = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (req, file, cb) => {
      cb(null, `${Date.now()}-${file.originalname}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB limit
});

/**
 * POST /api/campaigns
 * Launch broadcast campaign across one or multiple contact lists
 */
router.post("/", uploadMedia.single("mediaFile"), async (req, res) => {
  try {
    const { name, template_name, language_code, contact_list_ids } = req.body || {};

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "Campaign name is required." });
    }

    if (!template_name || typeof template_name !== "string" || !template_name.trim()) {
      return res.status(400).json({ error: "Template name is required." });
    }

    if (!contact_list_ids) {
      return res.status(400).json({ error: "At least one contact list must be selected." });
    }

    let parsedListIds = [];
    try {
      parsedListIds = typeof contact_list_ids === "string" ? JSON.parse(contact_list_ids) : contact_list_ids;
    } catch (e) {
      parsedListIds = [contact_list_ids];
    }

    if (!Array.isArray(parsedListIds)) {
      parsedListIds = [parsedListIds];
    }

    parsedListIds = parsedListIds.filter(isValidUuid);

    if (parsedListIds.length === 0) {
      return res.status(400).json({ error: "No valid contact lists were selected." });
    }

    // Inspect template to verify header requirements, language, and body parameters
    let paramCount = 0;
    let templateRequiresMediaHeader = false;
    let requiredHeaderFormat = null;
    let resolvedLanguageCode = language_code || "en_US";
    let templateFetched = false;

    try {
      const templates = await getTemplates();
      const tpl = (templates || []).find((t) => t.name === template_name.trim());
      if (tpl) {
        templateFetched = true;
        if (tpl.language) {
          resolvedLanguageCode = tpl.language;
        }
        if (tpl.components) {
          const headerComponent = tpl.components.find((c) => c.type === "HEADER");
          if (headerComponent && ["IMAGE", "VIDEO", "DOCUMENT"].includes(headerComponent.format)) {
            templateRequiresMediaHeader = true;
            requiredHeaderFormat = headerComponent.format.toLowerCase();
          }

          const bodyComponent = tpl.components.find((c) => c.type === "BODY");
          if (bodyComponent && bodyComponent.text) {
            const matches = bodyComponent.text.match(/\{\{\d+\}\}/g);
            if (matches) paramCount = new Set(matches).size;
          }
        }
      }
    } catch (err) {
      console.warn("Could not fetch templates to check params:", err.message);
    }

    const incomingMediaUrl = req.body.media_url || req.body.existing_media_url || null;
    const incomingMediaId = req.body.media_id || null;

    if (templateFetched && templateRequiresMediaHeader && !req.file && !incomingMediaUrl && !incomingMediaId) {
      return res.status(400).json({
        error: `Template "${template_name.trim()}" requires a ${requiredHeaderFormat} header. Please attach a ${requiredHeaderFormat} file or select from Media Gallery before launching.`,
      });
    }

    let media_id = incomingMediaId || null;
    let media_type = null;
    let media_url = incomingMediaUrl ? formatMediaUrl(incomingMediaUrl) : null;

    // Only upload and attach media header if the template actually expects a media header (or if template lookup failed)
    if (req.file && (!templateFetched || templateRequiresMediaHeader)) {
      if (req.file.mimetype.startsWith("image/")) {
        media_type = "image";
      } else if (req.file.mimetype.startsWith("video/")) {
        media_type = "video";
      } else {
        media_type = "document";
      }

      if (media_type === "video" && req.file.size > 16 * 1024 * 1024) {
        if (req.file.path && fs.existsSync(req.file.path)) {
          try { fs.unlinkSync(req.file.path); } catch (e) {}
        }
        return res.status(400).json({
          error: "Video file exceeds Meta WhatsApp 16 MB limit. Please compress or choose a smaller video.",
        });
      }

      if (media_type === "image" && req.file.size > 5 * 1024 * 1024) {
        if (req.file.path && fs.existsSync(req.file.path)) {
          try { fs.unlinkSync(req.file.path); } catch (e) {}
        }
        return res.status(400).json({
          error: "Image file exceeds Meta WhatsApp 5 MB limit. Please compress or choose a smaller image.",
        });
      }

      if (templateRequiresMediaHeader && requiredHeaderFormat && media_type !== requiredHeaderFormat) {
        if (req.file.path && fs.existsSync(req.file.path)) {
          try { fs.unlinkSync(req.file.path); } catch (e) {}
        }
        return res.status(400).json({
          error: `Template "${template_name.trim()}" requires a ${requiredHeaderFormat} header, but a ${media_type} file was uploaded.`,
        });
      }

      try {
        media_id = await uploadMediaToMeta(req.file.path, req.file.mimetype);
      } catch (uploadErr) {
        if (req.file.path && fs.existsSync(req.file.path)) {
          try { fs.unlinkSync(req.file.path); } catch (e) {}
        }
        return res.status(502).json({ error: uploadErr.message });
      }
      if (!media_id) {
        if (req.file.path && fs.existsSync(req.file.path)) {
          try { fs.unlinkSync(req.file.path); } catch (e) {}
        }
        return res.status(500).json({ error: "Failed to upload media to WhatsApp Meta API." });
      }

      try {
        let resourceType = "auto";
        if (media_type === "image") resourceType = "image";
        if (media_type === "video") resourceType = "video";
        media_url = await uploadFileToCloudinary(req.file.path, "wp_automation/campaigns", resourceType);
      } catch (uploadErr) {
        console.warn("Media storage upload skipped, proceeding with Meta ID:", uploadErr.message);
      } finally {
        if (req.file.path && fs.existsSync(req.file.path)) {
          try { fs.unlinkSync(req.file.path); } catch (e) {}
        }
      }
    } else if (incomingMediaUrl) {
      media_type = (req.body.media_type || (requiredHeaderFormat ? requiredHeaderFormat.toLowerCase() : "image"));
    }

    // Fetch distinct members across all chosen contact lists
    const placeholders = parsedListIds.map((_, i) => `$${i + 1}`).join(", ");
    const membersResult = await db.query(
      `SELECT DISTINCT c.id, c.phone_number, c.name, c.city
       FROM contact_list_members clm
       JOIN contacts c ON clm.contact_id = c.id
       WHERE clm.list_id IN (${placeholders})`,
      parsedListIds
    );

    if (membersResult.rows.length === 0) {
      return res.status(400).json({ error: "Selected contact lists have no recipients or are empty." });
    }

    const campaignResult = await db.query(
      `INSERT INTO campaigns (name, template_name, contact_list_id, media_id, media_type, media_url, total_sent)
       VALUES ($1, $2, $3, $4, $5, $6, 0)
       RETURNING *`,
      [name.trim().slice(0, 255), template_name.trim(), parsedListIds[0], media_id, media_type, media_url]
    );
    const campaign = campaignResult.rows[0];

    const messages = membersResult.rows.map((member) => {
      const bodyParams = [];
      if (paramCount >= 1) {
        bodyParams.push({ type: "text", text: member.name || "Customer" });
      }
      if (paramCount >= 2) {
        bodyParams.push({ type: "text", text: member.city || "Valued Client" });
      }
      for (let i = 2; i < paramCount; i++) {
        bodyParams.push({ type: "text", text: "Update" });
      }

      const sanitizedPhone = cleanPhoneNumber(member.phone_number);

      return {
        to: sanitizedPhone,
        contactId: member.id,
        bodyParams,
      };
    });

    const io = req.app.get("io");

    // Respond to the client immediately so the browser does not time out on large contact lists
    res.status(201).json({
      message: "Campaign launched and queued for delivery",
      campaign: {
        id: campaign.id,
        name: campaign.name,
        template_name: campaign.template_name,
        total_recipients: messages.length,
        created_at: campaign.created_at,
      },
    });

    // Run campaign dispatch asynchronously in the background
    processCampaign(
      messages,
      campaign.id,
      template_name.trim(),
      resolvedLanguageCode,
      io,
      media_id,
      media_type,
      media_url
    ).catch((procErr) => {
      console.error(`❌ Background campaign processor failed for ${campaign.id}:`, procErr);
    });

    // Keep history clean: automatically keep the last 100 campaigns
    db.query(
      `DELETE FROM campaigns 
       WHERE id NOT IN (
         SELECT id FROM campaigns 
         ORDER BY created_at DESC 
         LIMIT 100
       )`
    ).catch(() => {});
  } catch (err) {
    console.error("❌ Campaign creation error:", err);
    res.status(500).json({ error: "Failed to create and dispatch campaign." });
  }
});

/**
 * GET /api/campaigns
 * List all campaigns with aggregate delivery metrics
 */
router.get("/", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT
        c.*,
        COUNT(m.id) as total_messages,
        COUNT(CASE WHEN m.status = 'delivered' THEN 1 END) as total_delivered,
        COUNT(CASE WHEN m.status = 'read' THEN 1 END) as total_read,
        COUNT(CASE WHEN m.status = 'failed' THEN 1 END) as total_failed
      FROM campaigns c
      LEFT JOIN messages m ON m.campaign_id = c.id
      GROUP BY c.id
      ORDER BY c.created_at DESC`
    );
    const rows = result.rows.map(c => ({
      ...c,
      media_url: formatMediaUrl(c.media_url),
    }));
    res.json(rows);
  } catch (err) {
    console.error("❌ List campaigns error:", err);
    res.status(500).json({ error: "Failed to list campaigns." });
  }
});

/**
 * GET /api/campaigns/:id
 * Retrieve details and delivery metrics for a specific campaign
 */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidUuid(id)) {
      return res.status(400).json({ error: "Invalid campaign ID format." });
    }

    const campaignResult = await db.query(`SELECT * FROM campaigns WHERE id = $1`, [id]);
    if (campaignResult.rows.length === 0) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    const statsResult = await db.query(
      `SELECT
        status,
        COUNT(*) as count
      FROM messages
      WHERE campaign_id = $1
      GROUP BY status`,
      [id]
    );

    const camp = campaignResult.rows[0];
    if (camp && camp.media_url) {
      camp.media_url = formatMediaUrl(camp.media_url);
    }

    res.json({
      ...camp,
      stats: statsResult.rows,
    });
  } catch (err) {
    console.error("❌ Campaign detail error:", err);
    res.status(500).json({ error: "Failed to fetch campaign details." });
  }
});

/**
 * GET /api/campaigns/:id/recipients
 * Retrieve individual recipient delivery statuses
 */
router.get("/:id/recipients", async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidUuid(id)) {
      return res.status(400).json({ error: "Invalid campaign ID format." });
    }

    const result = await db.query(
      `SELECT m.id, c.phone_number, c.name, m.status, m.timestamp, m.error_message
       FROM messages m
       JOIN contacts c ON m.contact_id = c.id
       WHERE m.campaign_id = $1
       ORDER BY m.timestamp DESC`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Campaign recipients error:", err);
    res.status(500).json({ error: "Failed to fetch campaign recipient list." });
  }
});

/**
 * POST /api/campaigns/:id/retry-failed
 * Retry all failed messages in a campaign
 */
router.post("/:id/retry-failed", async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidUuid(id)) {
      return res.status(400).json({ error: "Invalid campaign ID format." });
    }

    const campResult = await db.query(`SELECT * FROM campaigns WHERE id = $1`, [id]);
    if (campResult.rows.length === 0) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    const campaign = campResult.rows[0];

    const failedMessages = await db.query(
      `SELECT m.id, m.contact_id, c.phone_number, c.name, c.city
       FROM messages m
       JOIN contacts c ON m.contact_id = c.id
       WHERE m.campaign_id = $1 AND m.status = 'failed'`,
      [id]
    );

    if (failedMessages.rows.length === 0) {
      return res.json({ message: "No failed messages found to retry.", total: 0, succeeded: 0, failed: 0 });
    }

    let paramCount = 0;
    let resolvedLanguageCode = "en_US";
    try {
      const templates = await getTemplates();
      const tpl = (templates || []).find((t) => t.name === campaign.template_name);
      if (tpl) {
        if (tpl.language) resolvedLanguageCode = tpl.language;
        const bodyComp = tpl.components?.find((c) => c.type === "BODY");
        if (bodyComp && bodyComp.text) {
          const matches = bodyComp.text.match(/\{\{\d+\}\}/g);
          if (matches) paramCount = new Set(matches).size;
        }
      }
    } catch (e) {
      console.warn("Could not fetch template details during retry:", e.message);
    }

    let headerComponents = [];
    if (campaign.media_type && (campaign.media_id || campaign.media_url)) {
      headerComponents.push({
        type: "header",
        parameters: [
          {
            type: campaign.media_type,
            [campaign.media_type]: campaign.media_id ? { id: campaign.media_id } : { link: campaign.media_url },
          },
        ],
      });
    }

    const io = req.app.get("io");
    let succeededCount = 0;
    let stillFailedCount = 0;

    for (const msg of failedMessages.rows) {
      const validPhone = cleanPhoneNumber(msg.phone_number);
      let components = [...headerComponents];

      const bodyParams = [];
      if (paramCount >= 1) bodyParams.push({ type: "text", text: msg.name || "Customer" });
      if (paramCount >= 2) bodyParams.push({ type: "text", text: msg.city || "Valued Client" });
      for (let i = 2; i < paramCount; i++) bodyParams.push({ type: "text", text: "Update" });

      if (bodyParams.length > 0) {
        components.push({ type: "body", parameters: bodyParams });
      }

      const result = await sendTemplateMessage(validPhone, campaign.template_name, resolvedLanguageCode, components);

      if (result.success) {
        succeededCount++;
        await db.query(
          `UPDATE messages
           SET status = 'sent', meta_message_id = $1, error_message = NULL, timestamp = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
           WHERE id = $2`,
          [result.messageId, msg.id]
        );

        if (io) {
          io.emit("message_status", {
            id: msg.id,
            campaign_id: id,
            meta_message_id: result.messageId,
            status: "sent",
            recipient: validPhone,
            error_message: null,
          });
        }
      } else {
        stillFailedCount++;
        const formattedErr = formatMetaError(result.error);
        await db.query(
          `UPDATE messages
           SET error_message = $1, timestamp = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
           WHERE id = $2`,
          [formattedErr, msg.id]
        );

        if (io) {
          io.emit("message_status", {
            id: msg.id,
            campaign_id: id,
            status: "failed",
            recipient: validPhone,
            error_message: formattedErr,
          });
        }
      }

      await new Promise((r) => setTimeout(r, 300));
    }

    res.json({
      success: true,
      total: failedMessages.rows.length,
      succeeded: succeededCount,
      failed: stillFailedCount,
    });
  } catch (err) {
    console.error("❌ Retry failed messages error:", err);
    res.status(500).json({ error: "Failed to retry campaign messages." });
  }
});

/**
 * POST /api/campaigns/:id/retry/:messageId
 * Retry a single recipient in a campaign
 */
router.post("/:id/retry/:messageId", async (req, res) => {
  try {
    const { id, messageId } = req.params;

    if (!isValidUuid(id) || !isValidUuid(messageId)) {
      return res.status(400).json({ error: "Invalid ID format." });
    }

    const campResult = await db.query(`SELECT * FROM campaigns WHERE id = $1`, [id]);
    if (campResult.rows.length === 0) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    const campaign = campResult.rows[0];

    const msgResult = await db.query(
      `SELECT m.id, m.contact_id, c.phone_number, c.name, c.city
       FROM messages m
       JOIN contacts c ON m.contact_id = c.id
       WHERE m.id = $1 AND m.campaign_id = $2`,
      [messageId, id]
    );

    if (msgResult.rows.length === 0) {
      return res.status(404).json({ error: "Message not found in this campaign." });
    }

    const msg = msgResult.rows[0];
    const validPhone = cleanPhoneNumber(msg.phone_number);

    let paramCount = 0;
    let resolvedLanguageCode = "en_US";
    try {
      const templates = await getTemplates();
      const tpl = (templates || []).find((t) => t.name === campaign.template_name);
      if (tpl) {
        if (tpl.language) resolvedLanguageCode = tpl.language;
        const bodyComp = tpl.components?.find((c) => c.type === "BODY");
        if (bodyComp && bodyComp.text) {
          const matches = bodyComp.text.match(/\{\{\d+\}\}/g);
          if (matches) paramCount = new Set(matches).size;
        }
      }
    } catch (e) {
      console.warn("Could not fetch template details during retry:", e.message);
    }

    let components = [];
    if (campaign.media_type && (campaign.media_id || campaign.media_url)) {
      components.push({
        type: "header",
        parameters: [
          {
            type: campaign.media_type,
            [campaign.media_type]: campaign.media_id ? { id: campaign.media_id } : { link: campaign.media_url },
          },
        ],
      });
    }

    const bodyParams = [];
    if (paramCount >= 1) bodyParams.push({ type: "text", text: msg.name || "Customer" });
    if (paramCount >= 2) bodyParams.push({ type: "text", text: msg.city || "Valued Client" });
    for (let i = 2; i < paramCount; i++) bodyParams.push({ type: "text", text: "Update" });

    if (bodyParams.length > 0) {
      components.push({ type: "body", parameters: bodyParams });
    }

    const result = await sendTemplateMessage(validPhone, campaign.template_name, resolvedLanguageCode, components);
    const io = req.app.get("io");

    if (result.success) {
      await db.query(
        `UPDATE messages
         SET status = 'sent', meta_message_id = $1, error_message = NULL, timestamp = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         WHERE id = $2`,
        [result.messageId, messageId]
      );

      if (io) {
        io.emit("message_status", {
          id: messageId,
          campaign_id: id,
          meta_message_id: result.messageId,
          status: "sent",
          recipient: validPhone,
          error_message: null,
        });
      }

      return res.json({ success: true, status: "sent", meta_message_id: result.messageId });
    } else {
      const formattedErr = formatMetaError(result.error);
      await db.query(
        `UPDATE messages
         SET error_message = $1, timestamp = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         WHERE id = $2`,
        [formattedErr, messageId]
      );

      if (io) {
        io.emit("message_status", {
          id: messageId,
          campaign_id: id,
          status: "failed",
          recipient: validPhone,
          error_message: formattedErr,
        });
      }

      return res.status(502).json({ error: formattedErr });
    }
  } catch (err) {
    console.error("❌ Retry single campaign message error:", err);
    res.status(500).json({ error: "Failed to retry recipient message." });
  }
});

/**
 * DELETE /api/campaigns/:id
 * Delete campaign and associated messages
 */
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidUuid(id)) {
      return res.status(400).json({ error: "Invalid campaign ID format." });
    }

    await db.query("DELETE FROM messages WHERE campaign_id = $1", [id]);
    const result = await db.query("DELETE FROM campaigns WHERE id = $1 RETURNING id", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    res.json({ message: "Campaign deleted successfully" });
  } catch (err) {
    console.error("❌ Campaign deletion error:", err);
    res.status(500).json({ error: "Failed to delete campaign." });
  }
});

module.exports = router;
