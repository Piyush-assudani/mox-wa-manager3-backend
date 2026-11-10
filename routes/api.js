const express = require("express");
const router = express.Router();
const { getAccountHealth } = require("../services/metaApi");

// In-memory cache for Meta Account Health (30s TTL to prevent hitting Meta rate limits)
let accountHealthCache = null;
let accountHealthCacheTime = 0;
const HEALTH_CACHE_TTL = 30 * 1000;

router.get("/health", (req, res) => {
  res.json({
    status: "ok",
    app: "Mox WA Manager 3",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

router.get("/account-health", async (req, res) => {
  const phoneId = process.env.META_PHONE_ID || process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.META_WHATSAPP_TOKEN || process.env.META_ACCESS_TOKEN;

  if (!phoneId || !accessToken) {
    return res.json({
      status: "PENDING_CONFIG",
      display_phone_number: "Not Configured",
      quality_rating: "UNKNOWN",
      messaging_limit_tier: "TIER_250",
      configured: false,
      message: "Meta Cloud API credentials not yet set in backend .env.",
    });
  }

  const now = Date.now();
  if (accountHealthCache && now - accountHealthCacheTime < HEALTH_CACHE_TTL) {
    return res.json(accountHealthCache);
  }

  try {
    const result = await getAccountHealth();
    if (result.success && result.data) {
      const data = {
        ...result.data,
        configured: true,
      };
      accountHealthCache = data;
      accountHealthCacheTime = now;
      return res.json(data);
    } else {
      return res.json({
        status: "DISCONNECTED",
        display_phone_number: "Unavailable",
        quality_rating: "UNKNOWN",
        messaging_limit_tier: "TIER_250",
        configured: false,
        error: result.error,
        message: result.error || "Unable to reach Meta Cloud API. Please verify token.",
      });
    }
  } catch (err) {
    console.error("❌ Account health route error:", err.message);
    if (accountHealthCache) return res.json(accountHealthCache);
    return res.json({
      status: "ERROR",
      quality_rating: "UNKNOWN",
      messaging_limit_tier: "TIER_250",
      configured: false,
      error: err.message,
      message: "Failed to connect to Meta Cloud API.",
    });
  }
});

module.exports = router;
