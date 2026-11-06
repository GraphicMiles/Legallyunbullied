/**
 * Answer feedback (thumbs up/down) — Firestore-backed, one write per tap.
 *
 * Ratings are stored in the top-level `feedback` collection via the Admin
 * SDK only. firestore.rules denies all client access (the catch-all), so
 * browsers can never read other users' ratings or write forged documents;
 * the only write path is this authenticated, validated endpoint.
 *
 * Kept deliberately small: no reads, no aggregation, no quota pressure.
 * If Firestore is not configured the endpoint answers 503 and the client
 * simply resets the button — the rating is never silently queued or
 * retried in a loop.
 *
 * POST /api/feedback
 *   body: { rating: "up" | "down", conversationId?, messageId?, practiceArea? }
 *   201: { ok: true }
 */

const express = require("express");
const router = express.Router();
const { getFirestore } = require("./firebaseAdmin");
const { requireAuth } = require("./authMiddleware");

// All feedback routes require auth (req.uid set by requireAuth).
router.use(requireAuth);

const ID_RE = /^[A-Za-z0-9._~-]{1,128}$/;

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
      createdAt: new Date().toISOString(),
    });

    res.status(201).json({ ok: true });
  } catch (err) {
    console.error("[feedback] write failed:", err.message);
    res.status(500).json({ error: "feedback_failed", message: "Could not save the rating." });
  }
});

module.exports = router;
