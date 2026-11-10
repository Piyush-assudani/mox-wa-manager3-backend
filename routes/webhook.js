const express = require("express");
const router = express.Router();
const db = require("../db");
const { downloadMediaFromMeta } = require("../services/metaApi");
const { uploadBufferToCloudinary } = require("../services/cloudinaryService");
const { formatMetaError } = require("../utils/metaErrors");
const { cleanPhoneNumber } = require("../utils/phone");

// Status hierarchy — higher number = more progressed
const STATUS_PRIORITY = {
  failed: 0,
  sent: 1,
  delivered: 2,
  read: 3,
};



router.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  const expectedToken = process.env.META_WEBHOOK_VERIFY_TOKEN || process.env.WEBHOOK_VERIFY_TOKEN;
  if (mode === "subscribe" && token === expectedToken) {
    console.log("✅ Webhook verified successfully");
    return res.status(200).send(challenge);
  }

  console.warn("❌ Webhook verification failed");
  return res.status(403).json({ error: "Verification failed" });
});



router.post("/", async (req, res) => {
  // Always respond 200 immediately to Meta
  res.status(200).json({ status: "received" });

  try {
    const body = req.body;

    // Log the entire webhook payload for debugging
    try {
      await db.query('INSERT INTO webhook_logs (payload) VALUES ($1)', [JSON.stringify(body)]);
    } catch (logErr) {
      console.error("Failed to insert webhook log:", logErr);
    }

    if (!body.object || !body.entry) {
      return;
    }

    // Process ALL entries and ALL changes (not just the first one)
    for (const entry of body.entry) {
      if (!entry.changes) continue;

      for (const change of entry.changes) {
        const value = change.value;
        if (!value) continue;

        // ─── Handle incoming messages ───
        if (value.messages && value.messages.length > 0) {
          for (const message of value.messages) {
            try {
              const from = message.from;
              const wamid = message.id;
              const suppliedTimestamp = Number(message.timestamp);
              const timestamp =
                Number.isFinite(suppliedTimestamp) && suppliedTimestamp > 0
                  ? suppliedTimestamp >= 1e12
                    ? suppliedTimestamp / 1000
                    : suppliedTimestamp
                  : Date.now() / 1000;

              if (!Number.isFinite(suppliedTimestamp) || suppliedTimestamp <= 0) {
                console.warn(`⚠️ Invalid inbound timestamp for ${wamid}; using webhook receive time`);
              }

              let messageBody = "";
              let mediaUrl = null;
              let mediaIdToDownload = null;
              let resourceType = "auto";

              if (message.type === "text" && message.text) {
                messageBody = message.text.body;
              } else if (message.type === "image") {
                messageBody = "[Image]";
                mediaIdToDownload = message.image.id;
                resourceType = "image";
              } else if (message.type === "video") {
                messageBody = "[Video]";
                mediaIdToDownload = message.video.id;
                resourceType = "video";
              } else if (message.type === "audio") {
                messageBody = "[Audio]";
                mediaIdToDownload = message.audio.id;
                resourceType = "video";
              } else if (message.type === "document") {
                messageBody = "[Document]";
                mediaIdToDownload = message.document.id;
                resourceType = "raw";
              } else if (message.type === "location") {
                messageBody = "[Location]";
              } else if (message.type === "sticker") {
                messageBody = "[Sticker]";
                mediaIdToDownload = message.sticker.id;
                resourceType = "image";
              } else if (message.type === "interactive") {
                if (message.interactive.type === "button_reply") {
                  messageBody = message.interactive.button_reply.title;
                } else if (message.interactive.type === "list_reply") {
                  messageBody = message.interactive.list_reply.title;
                } else {
                  messageBody = "[Interactive Response]";
                }
              } else if (message.type === "reaction") {
                messageBody = message.reaction?.emoji || "👍";
              } else {
                messageBody = `[${message.type || "Unknown"}]`;
              }

              // Download & upload media if present
              if (mediaIdToDownload) {
                try {
                  const mediaData = await downloadMediaFromMeta(mediaIdToDownload);
                  if (mediaData && mediaData.buffer) {
                    mediaUrl = await uploadBufferToCloudinary(mediaData.buffer, "wp_automation/inbound", resourceType);
                  }
                } catch (mediaErr) {
                  console.error("❌ Failed to process inbound media:", mediaErr);
                }
              }

              // Get contact name from webhook payload
              let contactName = null;
              if (value.contacts && value.contacts.length > 0) {
                const contactInfo = value.contacts.find((c) => c.wa_id === from);
                if (contactInfo && contactInfo.profile) {
                  contactName = contactInfo.profile.name;
                }
              }

              // Upsert contact
              const contactResult = await db.query(
                `INSERT INTO contacts (phone_number, name)
                 VALUES ($1, $2)
                 ON CONFLICT (phone_number)
                 DO UPDATE SET name = COALESCE($2, contacts.name)
                 RETURNING id, phone_number, name`,
                [from, contactName]
              );
              const contact = contactResult.rows[0];

              // Save the message
              const messageTimestamp = timestamp
                ? new Date(Number(timestamp) * 1000).toISOString()
                : new Date().toISOString();

              const msgResult = await db.query(
                `INSERT INTO messages (contact_id, direction, message_body, media_url, meta_message_id, status, timestamp)
                 VALUES ($1, 'inbound', $2, $3, $4, 'delivered', $5)
                 RETURNING *`,
                [contact.id, messageBody, mediaUrl, wamid, messageTimestamp]
              );

              const savedMessage = msgResult.rows[0];

              // Emit via Socket.IO
              const io = req.app.get("io");
              if (io) {
                io.emit("new_message", {
                  id: savedMessage.id,
                  contact_id: contact.id,
                  contact_phone: contact.phone_number,
                  contact_name: contact.name,
                  direction: "inbound",
                  message_body: messageBody,
                  media_url: mediaUrl,
                  meta_message_id: wamid,
                  status: "delivered",
                  timestamp: savedMessage.timestamp,
                });
              }

              console.log(`📥 Inbound message from ${from}: "${messageBody.substring(0, 50)}"`);
            } catch (msgErr) {
              console.error("❌ Error processing individual inbound message:", msgErr);
            }
          }
        }

        // ─── Handle status updates (sent / delivered / read / failed) ───
        if (value.statuses && value.statuses.length > 0) {
          for (const status of value.statuses) {
            try {
              const metaMessageId = status.id;
              const newStatus = status.status;
              const recipientId = status.recipient_id;

              if (!["sent", "delivered", "read", "failed"].includes(newStatus)) {
                console.log(`⚠️ Unknown status "${newStatus}" for ${metaMessageId}, skipping`);
                continue;
              }

              // Lookup message: 1st by exact meta_message_id, 2nd fallback by recipient phone
              const existing = await db.query(
                `SELECT id, status, campaign_id, contact_id, meta_message_id FROM messages WHERE meta_message_id = $1`,
                [metaMessageId]
              );

              let existingMsg = null;
              if (existing.rows.length > 0) {
                existingMsg = existing.rows[0];
              } else if (recipientId) {
                const cleanRecipient = cleanPhoneNumber(recipientId);
                const fallbackMsg = await db.query(
                  `SELECT m.id, m.status, m.campaign_id, m.contact_id, m.meta_message_id 
                   FROM messages m 
                   JOIN contacts c ON m.contact_id = c.id 
                   WHERE (c.phone_number = $1 OR c.phone_number = $2) AND m.direction = 'outbound'
                   ORDER BY m.timestamp DESC LIMIT 1`,
                  [cleanRecipient, recipientId]
                );
                if (fallbackMsg.rows.length > 0) {
                  existingMsg = fallbackMsg.rows[0];
                  console.log(`🔗 Matched status "${newStatus}" to message ${existingMsg.id} via recipient phone ${recipientId}`);
                }
              }

              if (!existingMsg) {
                console.log(`⚠️ No message found for wamid ${metaMessageId} (recipient: ${recipientId}, status: ${newStatus})`);
                continue;
              }

              const currentStatus = existingMsg.status;
              const currentPriority = STATUS_PRIORITY[currentStatus] ?? -1;
              const newPriority = STATUS_PRIORITY[newStatus] ?? -1;

              // Special case: "failed" always overrides
              if (newStatus !== "failed" && newPriority <= currentPriority) {
                console.log(`ℹ️ Skipping status downgrade: ${currentStatus} → ${newStatus} for ${metaMessageId}`);
                continue;
              }

              // Extract error message if failed
              let errorMsg = null;
              if (newStatus === "failed") {
                if (status.errors && status.errors.length > 0) {
                  const errObj = status.errors[0];
                  errorMsg = formatMetaError(errObj);
                } else {
                  errorMsg = "Message could not be delivered by Meta (undeliverable or recipient unavailable)";
                }
                console.warn(`❌ WhatsApp delivery failure for ${recipientId}: ${errorMsg}`);
              }

              const statusTimestamp = status.timestamp
                ? new Date(Number(status.timestamp) * 1000).toISOString()
                : new Date().toISOString();

              await db.query(
                `UPDATE messages 
                 SET status = $1, 
                     error_message = CASE WHEN $1 = 'failed' THEN COALESCE($3, error_message, 'Delivery failed by Meta WhatsApp Cloud') ELSE error_message END, 
                     timestamp = CASE WHEN $1 = 'read' OR $1 = 'delivered' THEN $4 ELSE timestamp END,
                     meta_message_id = COALESCE(meta_message_id, $2)
                 WHERE id = $5`,
                [newStatus, metaMessageId, errorMsg, statusTimestamp, existingMsg.id]
              );

              console.log(`📊 Status updated: ${currentStatus} → ${newStatus} for ${recipientId} (${metaMessageId})${errorMsg ? ` [${errorMsg}]` : ''}`);

              // Emit via Socket.IO for real-time tick updates across chat & campaigns
              const io = req.app.get("io");
              if (io) {
                io.emit("message_status", {
                  id: existingMsg.id,
                  campaign_id: existingMsg.campaign_id,
                  meta_message_id: metaMessageId,
                  status: newStatus,
                  recipient: recipientId,
                  error_message: errorMsg,
                  timestamp: statusTimestamp,
                });
              }
            } catch (statusErr) {
              console.error("❌ Error processing individual status update:", statusErr);
            }
          }
        }
      }
    }
  } catch (err) {
    console.error("❌ Webhook processing error:", err);
  }
});

/**
 * GET /status (and /api/webhook/status)
 * Diagnostics endpoint showing current webhook configuration, verify token, and live logs
 */
router.get("/status", async (req, res) => {
  try {
    const totalLogs = await db.query("SELECT COUNT(*) as count FROM webhook_logs");
    const lastLogs = await db.query("SELECT * FROM webhook_logs ORDER BY created_at DESC LIMIT 15");
    const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN || process.env.WEBHOOK_VERIFY_TOKEN || "";
    const baseUrl = (process.env.BASE_URL || "https://mox-wa3.piyushassudani.in").replace(/\/+$/, "");

    res.json({
      configured: !!verifyToken,
      callback_url: `${baseUrl}/webhook`,
      verify_token: verifyToken,
      total_events_received: parseInt(totalLogs.rows[0]?.count || 0, 10),
      recent_events: lastLogs.rows.map(row => {
        let parsed = null;
        try { parsed = JSON.parse(row.payload); } catch(e) {}
        return {
          id: row.id,
          created_at: row.created_at,
          payload: parsed,
        };
      }),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /logs (and /api/webhook/logs)
 * Detailed recent payload dump
 */
router.get("/logs", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
    const logs = await db.query(`SELECT * FROM webhook_logs ORDER BY created_at DESC LIMIT $1`, [limit]);
    res.json(logs.rows.map(l => {
      let payload = null;
      try { payload = JSON.parse(l.payload); } catch (e) {}
      return { id: l.id, created_at: l.created_at, payload };
    }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
