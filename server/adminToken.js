/**
 * Shared bearer-token check for owner-only export endpoints.
 * Same posture as the feedback export: unset token => 503 (disabled),
 * wrong/missing token => 401, nothing valid => the endpoint leaks nothing.
 */
const crypto = require("crypto");

function safeEqual(a, b) {
  const ba = Buffer.from(String(a), "utf8");
  const bb = Buffer.from(String(b), "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Returns true when the request is authorized; otherwise sends the response
 * (503/401) and returns false.
 */
function checkAdminAuth(req, res) {
  const adminToken = process.env.FEEDBACK_ADMIN_TOKEN;
  if (!adminToken) {
    res.status(503).json({ error: "export_not_configured", message: "Set FEEDBACK_ADMIN_TOKEN to enable the export." });
    return false;
  }
  const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  if (!match || !safeEqual(match[1].trim(), adminToken)) {
    res.status(401).json({ error: "unauthorized", message: "Invalid export token." });
    return false;
  }
  return true;
}

module.exports = { checkAdminAuth };
