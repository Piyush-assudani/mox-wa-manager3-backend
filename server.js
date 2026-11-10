const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");
const { Server } = require("socket.io");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

dotenv.config({ path: path.resolve(__dirname, ".env") });

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5050;

// ============================================
// Socket.IO Configuration
// ============================================
const io = new Server(server, {
  cors: {
    origin: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    credentials: true,
  },
});

app.set("io", io);

io.on("connection", (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);
  socket.on("disconnect", () => {
    console.log(`🔌 Client disconnected: ${socket.id}`);
  });
});

// ============================================
// Universal Permissive CORS & Security Headers
// Guarantees zero CORS blocking while applying safety headers
// ============================================
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization, Range"
  );
  res.setHeader("Access-Control-Allow-Credentials", "true");

  // Security Headers
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  next();
});

app.disable("x-powered-by");
app.use(cors({ origin: true, credentials: true }));

// ============================================
// IP Abuse & Jail Protection
// Automatically suspends abusive clients flooding the server
// ============================================
const ipViolationMap = new Map();
const IP_JAIL_TIME_MS = 15 * 60 * 1000; // 15 mins jail
const MAX_VIOLATIONS = 60;

app.use((req, res, next) => {
  const ip = req.ip || req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
  const record = ipViolationMap.get(ip);
  const now = Date.now();

  if (record && record.jailedUntil && now < record.jailedUntil) {
    const minutesLeft = Math.ceil((record.jailedUntil - now) / 60000);
    return res.status(429).json({
      error: `Too many abusive requests. Access suspended for ${minutesLeft} more minute(s).`,
    });
  }

  next();
});

// ============================================
// Rate Limiters
// ============================================
// Global API rate limit: 2000 requests per 15 minutes per IP
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." },
});

// Strict Auth rate limiter: 30 attempts per 15 minutes to prevent brute-forcing
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts from this IP. Please try again after 15 minutes." },
});

// ============================================
// Body Parsers & JSON Error Handling
// ============================================
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

// Catch malformed JSON payloads gracefully
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ error: "Malformed JSON payload provided." });
  }
  next(err);
});

// ============================================
// Routes
// ============================================
const apiRoutes = require("./routes/api");
const contactRoutes = require("./routes/contacts");
const messageRoutes = require("./routes/messages");
const campaignRoutes = require("./routes/campaigns");
const webhookRoutes = require("./routes/webhook");
const authRoutes = require("./routes/auth");
const contactListsRoutes = require("./routes/contact_lists");
const templateRoutes = require("./routes/templates");
const mediaRoutes = require("./routes/media");
const dashboardRoutes = require("./routes/dashboard");
const privacyRoutes = require("./routes/privacy");

app.use("/api", apiLimiter, apiRoutes);
app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/contact_lists", contactListsRoutes);
app.use("/api/contacts", contactRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/campaigns", campaignRoutes);
app.use("/api/templates", templateRoutes);
app.use("/api/media", mediaRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/privacy", privacyRoutes);
app.use("/privacy", privacyRoutes);
app.use("/webhook", webhookRoutes);
app.use("/api/webhook", webhookRoutes);

// Local Media & Uploads Static Hosting
const uploadsPath = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, { recursive: true });
}
app.use("/uploads", express.static(uploadsPath));

// API Root Status
app.get("/", (req, res) => {
  res.json({
    message: "Morihix WA Manager 3 Backend API",
    status: "running",
    timestamp: new Date().toISOString(),
    endpoints: {
      health: "GET /api/health",
      auth: "POST /api/auth/login",
      contact_lists: "GET/POST /api/contact_lists",
      contacts: "GET /api/contacts",
      messages: "GET /api/messages/:contactId",
      campaigns: "GET /api/campaigns",
      webhook: "GET/POST /webhook",
      privacy: "GET /privacy",
      uploads: "GET /uploads/:folder/:filename",
    },
  });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// 500 Central Error Handler
app.use((err, req, res, next) => {
  console.error("Central Error Caught:", err.message || err);
  res.status(err.status || 500).json({
    error: "Internal Server Error",
    message: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

// ============================================
// Campaign Processor & Worker Initialization
// ============================================
const { initBullMQ } = require("./services/campaignProcessor");
const db = require("./db");
initBullMQ(io);

// Server Listen
server.listen(PORT, () => {
  console.log(`🚀 Morihix WA Manager 3 Backend running on http://localhost:${PORT}`);
  console.log(`📦 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`🔌 WebSocket server ready`);
  console.log(`📡 Webhook endpoint: http://localhost:${PORT}/webhook`);
});

process.on("uncaughtException", (err) => {
  console.error("🔥 Uncaught Exception caught safely:", err.message || err);
});

process.on("unhandledRejection", (reason) => {
  console.error("🔥 Unhandled Rejection caught safely:", reason?.message || reason);
});
