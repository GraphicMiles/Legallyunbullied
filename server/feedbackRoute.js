/**
 * Answer feedback (thumbs up/down) — Firestore-backed, one write per tap.
 *
 * Ratings are stored in the top-level `feedback` collection via the Admin
 * SDK only. firestore.rules denies all client access (the catch-all), so
 * browsers can never read other users' ratings or write forged documents;
 * the only write path is this authenticated, validated endpoint.
 *
 * Each rating is stored WITH the question the user asked and the answer they
 * rated, so a thumbs-down can be traced to the exact exchange that failed.
 * Q + A are only ever sent for signed-in users (the client keeps guest
 * ratings on-device), and only through this endpoint.
 *
 * Endpoints:
 *   POST /api/feedback          — submit a rating (requires Firebase ID token)
 *   GET  /api/feedback/export   — owner fine-tuning export (Bearer FEEDBACK_ADMIN_TOKEN)
 */

const express = require("express");
const router = express.Router();
const { getFirestore } = require("./firebaseAdmin");
const { requireAuth } = require("./authMiddleware");
const { checkAdminAuth } = require("./adminToken");

const ID_RE = /^[A-Za-z0-9._~-]{1,128}$/;
const MAX_QUESTION = 4000;
const MAX_ANSWER = 16000;
const MAX_LIMIT = 500;

function trimTo(value, max) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/**
 * GET /api/feedback/export
 *   Authorization: Bearer $FEEDBACK_ADMIN_TOKEN      (set by the owner; never shipped to clients)
 *   query: limit? (1-500, default 200)  since? (ISO-8601 — inclusive lower bound on createdAt)
 *   200: { ok: true, count, items: [...] }
 *   401/503: unauthorized / not configured
 *
 * Server-side Admin SDK read — firestore.rules still deny all client reads.
 * Unset token => the endpoint answers 503 and leaks nothing.
 */
router.get("/export", async (req, res) => {
  try {
    if (!checkAdminAuth(req, res)) return;

    let limit = Number.parseInt(req.query.limit, 10);
    if (Number.isNaN(limit) || limit < 1) limit = 200;
    if (limit > MAX_LIMIT) limit = MAX_LIMIT;

    let since = null;
    if (req.query.since) {
      const parsed = Date.parse(String(req.query.since));
      if (Number.isNaN(parsed)) {
        return res.status(400).json({ error: "invalid_since", message: "since must be an ISO-8601 date string." });
      }
      since = new Date(parsed).toISOString();
    }

    const db = getFirestore();
    if (!db) {
      return res.status(503).json({ error: "feedback_unavailable", message: "Feedback storage isn't configured." });
    }

    let query = db.collection("feedback");
    if (since) query = query.where("createdAt", ">=", since);
    query = query.orderBy("createdAt", "desc").limit(limit);

    const snap = await query.get();
    const items = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, count: items.length, since, items });
  } catch (err) {
    console.error("[feedback] export failed:", err.message);
    res.status(500).json({ error: "export_failed", message: "Could not export feedback." });
  }
});

// Everything below requires a signed-in Firebase user.
router.use(requireAuth);

/**
 * POST /api/feedback
 *   body: { rating: "up" | "down", conversationId?, messageId?, practiceArea?, question?, answer? }
 *   201: { ok: true }
 */
router.post("/", async (req, res) => {
  try {
    const { rating, conversationId, messageId, practiceArea } = req.body || {};

    if (rating !== "up" && rating !== "down") {
      return res.status(400).json({ error: "invalid_rating", message: "rating must be 'up' or 'down'." });
    }
    for (const [name, value] of Object.entries({ conversationId, messageId })) {
      if (value !== undefined && value !== null && !ID_RE.test(String(value))) {
        return res.status(400).json({ error: "invalid_id", message: `${name} is not a valid identifier.` });
      }
    }
    if (practiceArea !== undefined && practiceArea !== null &&
        (typeof practiceArea !== "string" || practiceArea.length > 64)) {
      return res.status(400).json({ error: "invalid_practice_area", message: "practiceArea must be a short string." });
    }

    // The question asked and the answer given — kept so a failing answer can
    // be traced and used for fine-tuning. Long prose is capped, never
    // rejected, so a tap always saves.
    const question = trimTo(req.body && req.body.question, MAX_QUESTION);
    const answer = trimTo(req.body && req.body.answer, MAX_ANSWER);

    const db = getFirestore();
    if (!db) {
      return res.status(503).json({ error: "feedback_unavailable", message: "Feedback storage isn't configured." });
    }

    await db.collection("feedback").add({
      uid: req.uid,
      rating,
      conversationId: conversationId || null,
      messageId: messageId || null,
      practiceArea: typeof practiceArea === "string" ? practiceArea.slice(0, 64) : null,
      question,
      answer,
      createdAt: new Date().toISOString(),
    });

    res.status(201).json({ ok: true });
  } catch (err) {
    console.error("[feedback] write failed:", err.message);
    res.status(500).json({ error: "feedback_failed", message: "Could not save the rating." });
  }
});

module.exports = router;
