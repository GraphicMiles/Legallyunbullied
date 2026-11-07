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

require("dotenv").config({ quiet: true });

const express = require("express");
const path = require("path");
const cors = require("cors");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const chatRoute = require("./server/chatRoute");
const conversationRoute = require("./server/conversationRoute");
const { requireAuth, requireAdmin } = require("./server/authMiddleware");
const { sweepAndStart } = require("./server/jobRunner");
const { probeProviders, getProviderHealth } = require("./server/providerHealth");
const debugLog = require("./server/debugLog");
debugLog.attach();

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

app.disable("x-powered-by");

// ── Baseline security headers ─────────────────────────────────────────────
// No CSP yet: the client pulls Firebase SDK from Google CDNs and uses inline
// bootstraps, so a policy has to be engineered, not toggled. These three are
// safe everywhere and close framing/mime-sniffing/referrer leaks today.
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "DENY");
  res.set("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

// ── Proxy trust ────────────────────────────────────────────────────────────
// Render (and most PaaS hosts) terminate TLS at a load balancer, so req.ip is
// the proxy's address for EVERY user. Without this setting the rate limiters
// key on that shared proxy IP — one user's 20 req/min chat budget becomes the
// budget for the entire service. One trusted hop = the platform's LB only.
app.set("trust proxy", 1);

// ── CORS ──────────────────────────────────────────────────────────────────
// Exact allowlist only: the production deploy, localhost dev, and any extra
// origins passed in ALLOWED_ORIGINS (comma-separated) — e.g. a Firebase
// Hosting site when you enable it. No wildcard subdomain matching: a cloned
// frontend hosted on a free *.onrender.com / *.firebaseapp.com / *.web.app
// domain would otherwise be allowed to call this API with credentials.
// Local origins follow PORT so running `PORT=4000 node server.js` doesn't
// get the app's own static assets blocked by its own CORS layer.
const ALLOWED_ORIGINS = [
  "https://legally-unbullied.onrender.com",
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  ...String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (server-to-server, curl, mobile apps)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    console.warn(`[cors] Blocked origin: ${origin}`);
    callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 86400, // preflight cache 24h
}));

// ── Body size limits ──────────────────────────────────────────────────────
// Route-specific parsers run BEFORE the global one (body-parser skips
// already-parsed bodies). /api/chat carries an 18-message history window
// with per-message classification context; /api/conversations/migrate
// imports legacy localStorage histories in batches. Both are authenticated
// per-user endpoints. Everything else stays at 50kb.
app.use("/api/chat", express.json({ limit: "300kb" }));
app.use("/api/conversations/migrate", express.json({ limit: "2mb" }));
// Legal answers (sources, evidence, steps) routinely exceed 50kb; a tight
// global cap made message PUTs 413 and those turns never reloaded.
app.use("/api/conversations", express.json({ limit: "300kb" }));
app.use(express.json({ limit: "50kb" }));

// ── Rate limiting ─────────────────────────────────────────────────────────
// General API rate limit — applies to all /api/* endpoints.
// 60 requests per minute per IP. Prevents casual abuse.
const clientIpKey = (req) => {
  // Rightmost XFF entry = the address the edge proxy appended for the real
  // client. Rotating a spoofed XFF prefix no longer mints a fresh bucket.
  // ipKeyGenerator folds IPv6 addresses to a /56 subnet so a client can't
  // rotate through its own address space either.
  const xff = String(req.headers["x-forwarded-for"] || "");
  const last = xff.split(",").pop().trim();
  return ipKeyGenerator(last || req.ip);
};

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true, // Return RateLimit-* headers
  legacyHeaders: false,
  keyGenerator: clientIpKey,
  validate: { xForwardedForHeader: false },
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
  keyGenerator: clientIpKey,
  validate: { xForwardedForHeader: false },
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
    } else if (filePath.includes("\\vendor\\") || filePath.includes("/vendor/")) {
      // Vendored assets (fonts, fontawesome css) never change per deploy;
      // cache hard for a week so repeat loads don't re-fetch them.
      res.set("Cache-Control", "public, max-age=604800, immutable");
    }
  },
}));

// ── Health check ──────────────────────────────────────────────────────────
app.get("/healthz", (req, res) => {
  const providerHealth = getProviderHealth();
  const configured = Object.values(providerHealth.providers).filter((p) => p.configured);
  const healthy = configured.some((p) => p.status === "healthy");
  res.status(200).json({
    status: configured.length && !healthy ? "degraded" : "ok",
    providers: providerHealth.providers,
    providerHealthCheckedAt: providerHealth.checkedAt,
  });
});

// ── Cache management (auth required) ──────────────────────────────────────
// Stats leak operational intel (cache sizes, hit rates, whether the Firestore
// circuit breaker is open) — same auth posture as the invalidate endpoint.
app.get("/api/cache-stats", requireAuth, requireAdmin, (req, res) => {
  const { getCacheStats } = require("./server/legalCorpus");
  res.json(getCacheStats());
});

app.post("/api/cache-invalidate", requireAuth, requireAdmin, (req, res) => {
  const { invalidateCache } = require("./server/legalCorpus");
  invalidateCache();
  console.log(`[cache] Invalidated by admin: ${req.uid}`);
  res.json({ success: true, message: "Cache invalidated" });
});

// ── Server debug logs (admin only) ────────────────────────────────────────
// The in-app debug panel pulls this on demand so a bug report can carry the
// server-side pipeline trace too. Admin-gated like the cache intel above —
// log lines can reveal provider state and internal stage timings.
app.get("/api/debug/server-logs", requireAuth, requireAdmin, (req, res) => {
  res.json({ entries: debugLog.snapshot(req.query.limit), captured: true });
});

// ── Conversation persistence API ──────────────────────────────────────────
// Auth is applied inside the route module itself.
app.use("/api/conversations", conversationRoute);

// ── Answer feedback (thumbs up/down) ──────────────────────────────────────
// Auth inside the route module. One Firestore write per explicit tap;
// browsers have no direct access (catch-all deny in firestore.rules).
app.use("/api/feedback", require("./server/feedbackRoute"));

// ── Email OTP for the auth pages ──────────────────────────────────────────
// Backs the /auth signup flow: 6-digit codes, pluggable email sender
// (Resend/SendGrid via env, server log until a provider is configured).
app.use("/api/otp", require("./server/otpRoute"));

// ── Chat API (auth required + stricter rate limit) ────────────────────────
// Each /api/chat call invokes LLM providers (Groq/Gemini/etc.) which cost
// tokens and have their own rate limits. Require auth + apply stricter limit.
app.use("/api/chat", chatLimiter, requireAuth);
app.use("/api/generate-title", chatLimiter, requireAuth);
app.use(chatRoute);

// ── Auth pages (clean URL) ────────────────────────────────────────────────
app.get("/auth", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "auth.html"));
});

// ── API 404 (JSON, before the SPA fallback) ──────────────────────────────
// A typo'd /api/* path must be a JSON 404, never a 200 text/html page.
app.use("/api", (req, res) => {
  res.status(404).json({ error: "not_found", message: "Unknown API endpoint." });
});

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
    return res.status(413).json({ error: "payload_too_large", message: "Request body is too large." });
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
  console.log(`  CORS origins: ${ALLOWED_ORIGINS.join(", ")}`);
  console.log(`  Rate limit: 60 req/min general, 20 req/min /api/chat`);
  console.log(`  Auth: required for /api/chat and /api/cache-invalidate`);
  console.log(`  Body limit: 50kb`);
});

// Background job runner: recovers in-flight requests that were orphaned by a
// restart (restart-and-complete). No-op when Firestore isn't configured.
sweepAndStart();
// Non-blocking startup validation catches retired model IDs before the first
// user request. Health output is metadata-only and never exposes credentials.
probeProviders()
  .then((health) => console.log("[providers] startup health:", JSON.stringify(health.providers)))
  .catch((err) => console.warn("[providers] startup health check failed:", err.message));

// ── Process-level safety net ───────────────────────────────────────────────
// Node 20 terminates the process on any unhandled promise rejection, which on
// Render surfaces as a 502 Bad Gateway for the next request. Express 4 does
// not route async handler rejections to the error middleware, so a single
// stray Firestore/network rejection could otherwise take the whole service
// down. Log rejections instead of dying; log uncaught exceptions and exit
// cleanly (Render restarts the service).
process.on("unhandledRejection", (reason) => {
  console.error("[server] Unhandled promise rejection (kept alive):",
    reason && reason.stack ? reason.stack : reason);
});

process.on("uncaughtException", (err) => {
  console.error("[server] Uncaught exception — exiting for restart:", err && err.stack ? err.stack : err);
  process.exit(1);
});
