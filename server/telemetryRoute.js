/**
 * GET /api/telemetry/export — owner-only daily outcome counters.
 *   Authorization: Bearer $FEEDBACK_ADMIN_TOKEN
 *   query: limit? (1-92, default 14)
 *   200: { ok: true, count, items: [{ date, ...counters }] }
 */
const express = require("express");
const router = express.Router();
const { checkAdminAuth } = require("./adminToken");
const { exportRecent } = require("./telemetry");

router.get("/export", async (req, res) => {
  try {
    if (!checkAdminAuth(req, res)) return;
    const items = await exportRecent(req.query.limit);
    if (!items) {
      return res.status(503).json({ error: "telemetry_unavailable", message: "Firestore is not configured." });
    }
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, count: items.length, items });
  } catch (err) {
    console.error("[telemetry] export failed:", err.message);
    res.status(500).json({ error: "export_failed", message: "Could not export telemetry." });
  }
});

module.exports = router;
