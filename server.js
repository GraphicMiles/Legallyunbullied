/**
 * Legally Unbullied — single Render Web Service.
 *
 * Right now this just serves the static front-end (public/). It exists as an
 * Express server (not a Static Site) on purpose: this is the same process
 * that will grow the Phase 1 AI orchestration routes (e.g. POST /api/chat)
 * described in the PRD, so there's only ever one Render service to manage —
 * no separate static host + API host to keep in sync.
 */

require("dotenv").config(); // no-op in production if there's no .env file — Render injects real env vars directly

const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

app.disable("x-powered-by");

/**
 * Firebase client config, injected at runtime from environment variables —
 * never hardcoded or committed. See .env.example for the required keys.
 * The Firebase web API key isn't a secret by design (it's scoped/restricted
 * by Firebase Security Rules + authorized domains, not by hiding it), but we
 * still keep it out of the repo so the project can point at different
 * Firebase projects (dev/staging/prod) without touching code.
 */
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

// Static assets (index.html, app.js, future css/img/etc.)
app.use(express.static(PUBLIC_DIR, { extensions: ["html"] }));

// Health check for Render / uptime monitors.
app.get("/healthz", (req, res) => {
  res.status(200).json({ status: "ok" });
});

/**
 * Placeholder for the Phase 1 AI orchestration endpoint.
 * The front-end (public/app.js) currently classifies + answers client-side
 * with mock data. When the real agent is ready, point it at this route
 * instead and remove the client-side mock logic.
 */
app.post("/api/chat", (req, res) => {
  res.status(501).json({
    error: "not_implemented",
    message: "The AI orchestration endpoint isn't wired up yet — the front-end currently runs on client-side mock data.",
  });
});

// Single-page fallback: any unmatched GET route serves the app shell.
app.get("*", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Legally Unbullied listening on port ${PORT}`);
});
