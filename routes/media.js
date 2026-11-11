const fs = require("fs");
const express = require("express");
const router = express.Router();
const multer = require("multer");
const db = require("../db");
const { uploadFileToServer, deleteFileFromServer, formatMediaUrl } = require("../services/localStorageService");
const { uploadMediaToMeta } = require("../services/metaApi");
const os = require("os");

const isValidUuid = (val) =>
  typeof val === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(val);

const upload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || "";
      cb(null, `${Date.now()}-${file.originalname}`);
    },
  }),
  limits: { fileSize: 32 * 1024 * 1024 }, // 32MB max ceiling for uploads
});

// Middleware to catch multer limit errors gracefully
const handleUpload = (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          error: "File size exceeds the 32MB maximum server limit.",
        });
      }
      return res.status(400).json({ error: err.message || "Failed to process uploaded file." });
    }
    next();
  });
};

// GET /api/media - list all media assets
router.get("/", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM media_assets ORDER BY created_at DESC`
    );
    const rows = result.rows.map(row => ({
      ...row,
      media_url: formatMediaUrl(row.media_url),
    }));
    res.json(rows);
  } catch (err) {
    console.error("❌ List media error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/media - upload media (images, videos, documents) directly to server storage
router.post("/", handleUpload, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file provided" });
    }

    const mime = (req.file.mimetype || "").toLowerCase();
    const size = req.file.size;

    // Detect resource type
    let resourceType = "auto";
    if (mime.startsWith("image/")) resourceType = "image";
    else if (mime.startsWith("video/")) resourceType = "video";
    else if (mime.startsWith("audio/")) resourceType = "audio";
    else resourceType = "document";

    // Enforce WhatsApp Cloud API media constraints
    if (resourceType === "video") {
      const MAX_VIDEO_BYTES = 16 * 1024 * 1024; // 16MB Meta limit
      if (size > MAX_VIDEO_BYTES) {
        fs.promises.unlink(req.file.path).catch(() => {});
        return res.status(400).json({
          error: `Video size (${(size / (1024 * 1024)).toFixed(1)}MB) exceeds 16MB. WhatsApp Cloud API supports video files up to 16MB only.`,
        });
      }
    } else if (resourceType === "image") {
      const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB Meta limit
      if (size > MAX_IMAGE_BYTES) {
        fs.promises.unlink(req.file.path).catch(() => {});
        return res.status(400).json({
          error: `Image size (${(size / (1024 * 1024)).toFixed(1)}MB) exceeds 5MB. WhatsApp Cloud API supports images up to 5MB only.`,
        });
      }
    }

    // 1. Upload to Meta Cloud API (stream directly from temp file)
    let metaMediaId = null;
    try {
      metaMediaId = await uploadMediaToMeta(req.file.path, req.file.mimetype);
    } catch (metaErr) {
      console.warn("⚠️ Meta upload skipped/failed, saved to server storage:", metaErr.message);
    }

    // 2. Store file directly on local server filesystem (uploads/library)
    const mediaUrl = await uploadFileToServer(req.file.path, "library", resourceType);

    // 3. Clean up temp multer file
    fs.promises.unlink(req.file.path).catch(() => {});

    // 4. Save to database
    const result = await db.query(
      `INSERT INTO media_assets (original_name, media_url, meta_media_id, resource_type)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.file.originalname, mediaUrl, metaMediaId, resourceType]
    );

    const saved = result.rows[0];
    res.status(201).json({
      ...saved,
      media_url: formatMediaUrl(saved.media_url),
    });
  } catch (err) {
    if (req.file?.path) {
      fs.promises.unlink(req.file.path).catch(() => {});
    }
    console.error("❌ Media upload error:", err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/media/:id - delete media from DB and server filesystem
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidUuid(id)) {
      return res.status(400).json({ error: "Invalid media ID format." });
    }

    const existing = await db.query(`SELECT media_url FROM media_assets WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Media asset not found." });
    }

    await deleteFileFromServer(existing.rows[0].media_url);
    await db.query(`DELETE FROM media_assets WHERE id = $1`, [id]);
    res.json({ message: "Media deleted successfully from server" });
  } catch (err) {
    console.error("❌ Media delete error:", err);
    res.status(500).json({ error: "Failed to delete media asset." });
  }
});

module.exports = router;
