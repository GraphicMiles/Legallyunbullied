/**
 * Legally Unbullied — Node/Express server.
 *
 * Phase A security hardening:
 *   - CORS with explicit origin allowlist
 *   - Body size limits
 *   - Rate limiting on /api/chat
 *   - Firebase ID token auth on /api/chat
 *   - Cache-invalidate endpoint locked behind auth
 */

require("dotenv").config();

const express = require("express");
const path = require("path");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const chatRoute = require("./server/chatRoute");
const { requireAuth, optionalAuth } = require("./server/authMiddleware");

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

app.disable("x-powered-by");

// ── CORS ──────────────────────────────────────────────────────────────────
// Allow the Render deployment, localhost dev, and Firebase hosting preview.
// Expand this list if you add custom domains.
const ALLOWED_ORIGINS = [
  "https://legally-unbullied.onrender.com",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
];

// Also allow any *.onrender.com preview and firebaseapp.com hosting
const ORIGIN_REGEX = /^https:\/\/.*\.(onrender\.com|firebaseapp\.com|web\.app)$/;

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (server-to-server, curl, mobile apps)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    if (ORIGIN_REGEX.test(origin)) return callback(null, true);
    console.warn(`[cors] Blocked origin: ${origin}`);
    callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 86400, // preflight cache 24h
}));

// ── Body size limits ──────────────────────────────────────────────────────
// 50kb is generous for chat messages + conversation history.
// Prevents memory exhaustion from oversized payloads.
app.use(express.json({ limit: "50kb" }));

// ── Rate limiting ─────────────────────────────────────────────────────────
// General API rate limit — applies to all /api/* endpoints.
// 60 requests per minute per IP. Prevents casual abuse.
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true, // Return RateLimit-* headers
  legacyHeaders: false,
  message: { error: "rate_limited", message: "Too many requests. Please slow down." },
});
app.use("/api/", generalLimiter);

// Stricter rate limit specifically for /api/chat — each call costs LLM tokens.
// 20 chat requests per minute per IP. Most legitimate users send 1-3 per minute.
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "chat_rate_limited", message: "Too many chat requests. Please wait a moment." },
});

// ── Firebase config endpoint ──────────────────────────────────────────────
const FIREBASE_ENV_KEYS = [
  "FIREBASE_API_KEY",
  "FIREBASE_AUTH_DOMAIN",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_STORAGE_BUCKET",
  "FIREBASE_MESSAGING_SENDER_ID",
  "FIREBASE_APP_ID",
];

app.get("/firebase-config.js", (req, res) => {
  const missing = FIREBASE_ENV_KEYS.filter((key) => !process.env[key]);
  if (missing.length) {
    console.warn(`[firebase-config] missing env vars: ${missing.join(", ")}`);
  }

  const config = {
    apiKey: process.env.FIREBASE_API_KEY || null,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || null,
    projectId: process.env.FIREBASE_PROJECT_ID || null,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || null,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || null,
    appId: process.env.FIREBASE_APP_ID || null,
  };

  res.type("application/javascript");
  res.set("Cache-Control", "no-store");
  res.send(`window.__FIREBASE_CONFIG__ = ${JSON.stringify(config)};`);
});

// ── Static assets ─────────────────────────────────────────────────────────
app.use(express.static(PUBLIC_DIR, {
  extensions: ["html"],
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".js")) {
      res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.set("Pragma", "no-cache");
      res.set("Expires", "0");
    }
  },
}));

// ── Health check ──────────────────────────────────────────────────────────
app.get("/healthz", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// ── Cache management (auth required) ──────────────────────────────────────
app.get("/api/cache-stats", (req, res) => {
  const { getCacheStats } = require("./server/legalCorpus");
  res.json(getCacheStats());
});

// Bug fix: cache-invalidate now requires authentication.
// Previously anyone could wipe the legal corpus cache.
app.post("/api/cache-invalidate", requireAuth, (req, res) => {
  const { invalidateCache } = require("./server/legalCorpus");
  invalidateCache();
  console.log(`[cache] Invalidated by user: ${req.uid}`);
  res.json({ success: true, message: "Cache invalidated" });
});

// ── Chat API (auth required + stricter rate limit) ────────────────────────
// Each /api/chat call invokes LLM providers (Groq/Gemini/etc.) which cost
// tokens and have their own rate limits. Require auth + apply stricter limit.
app.use("/api/chat", chatLimiter, requireAuth);
app.use(chatRoute);

// ── SPA fallback ──────────────────────────────────────────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// ── Global error handler ──────────────────────────────────────────────────
app.use((err, req, res, next) => {
  // CORS errors
  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({ error: "cors_blocked", message: err.message });
  }
  // Body parser errors (payload too large, malformed JSON)
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "payload_too_large", message: "Request body exceeds the 50kb limit." });
  }
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "invalid_json", message: "Request body is not valid JSON." });
  }
  // Rate limit errors
  if (err.status === 429) {
    return res.status(429).json({ error: "rate_limited", message: "Too many requests. Please slow down." });
  }
  // Unexpected errors
  console.error("[server] Unhandled error:", err);
  res.status(500).json({ error: "internal_error", message: "Something went wrong on the server." });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Legally Unbullied listening on port ${PORT}`);
  console.log(`  CORS origins: ${ALLOWED_ORIGINS.join(", ")} + *.onrender.com, *.firebaseapp.com`);
  console.log(`  Rate limit: 60 req/min general, 20 req/min /api/chat`);
  console.log(`  Auth: required for /api/chat and /api/cache-invalidate`);
  console.log(`  Body limit: 50kb`);
});
