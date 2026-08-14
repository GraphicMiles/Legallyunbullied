/**
 * Legally Unbullied — single Render Web Service.
 *
 * Right now this just serves the static front-end (public/). It exists as an
 * Express server (not a Static Site) on purpose: this is the same process
 * that will grow the Phase 1 AI orchestration routes (e.g. POST /api/chat)
 * described in the PRD, so there's only ever one Render service to manage —
 * no separate static host + API host to keep in sync.
 */

const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

app.disable("x-powered-by");

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
