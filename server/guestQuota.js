/**
 * Guest (signed-out) usage gate for /api/chat.
 *
 * Product rule: a signed-out visitor may send GUEST_CAP questions per UTC
 * calendar day without an account. The bucket is keyed by a hash of
 * (rightmost X-Forwarded-For / socket IP, User-Agent, x-device-fingerprint)
 * so: a cleared cache does not reset the count (UA + IP + fonts stay), a
 * rotated/spoofed XFF prefix cannot mint fresh buckets (rightmost wins),
 * and IPv6 clients are folded to their /56 prefix by the caller inside
 * server.js via ipKeyGenerator (this module receives the already-normalised
 * rightmost XFF entry).
 *
 * Limits to know (deliberate, documented):
 *   - In-memory store. Multi-instance deployments get per-instance buckets
 *     (guests can burn up to CAP per instance per day). For strict global
 *     quotas, swap storage for Firestore/Redis keeping this exact interface.
 *   - UTC calendar-day rollover (00:00 UTC). Local-midnight users see a
 *     fuzzy boundary, which is acceptable for a trial allowance.
 *   - No client-side signal stops a determined VPN user. This gate stops
 *     casual reuse; authentication is the real seam.
 *   - Cache hits are refunded by the caller (free questions shouldn't spend).
 */
const { createHash } = require("crypto");
let ipKeyGenerator = null;
try { ({ ipKeyGenerator } = require("express-rate-limit")); } catch (_) { /* optional */ }
function foldIp(ip) {
  try { return ipKeyGenerator ? ipKeyGenerator(ip) : ip; } catch (_) { return ip; }
}

const GUEST_CAP = 3;
const buckets = new Map(); // key -> { day, count }

function dayKey(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

function keyFor(req) {
  const xff = String(req.headers["x-forwarded-for"] || "");
  const rightmost = xff.split(",").pop().trim();
  const ip = foldIp(rightmost || String(req.ip || "unknown"));
  const ua = String(req.headers["user-agent"] || "").slice(0, 200).trim();
  const fp = String(req.headers["x-device-fingerprint"] || "")
    .slice(0, 120)
    .replace(/[^a-zA-Z0-9|;+/.\-_:]/g, "")
    .trim();
  return createHash("sha256").update([ip, ua, fp].join("|")).digest("hex").slice(0, 24);
}

/** Consume one guest credit. Returns { allowed, key, remaining, day }. */
function allow(req) {
  const key = keyFor(req);
  const day = dayKey();
  let b = buckets.get(key);
  if (!b || b.day !== day) {
    b = { day, count: 0 };
    buckets.set(key, b);
  }
  if (b.count >= GUEST_CAP) return { allowed: false, key, remaining: 0, day, limit: GUEST_CAP };
  b.count += 1;
  return { allowed: true, key, remaining: GUEST_CAP - b.count, day, limit: GUEST_CAP };
}

/** Refund one credit (question was served from cache; cost was zero). */
function refund(key) {
  const b = key ? buckets.get(key) : null;
  if (b && b.count > 0) b.count -= 1;
}

// Hourly sweep of stale-day entries so the map can't grow without bound.
setInterval(() => {
  const day = dayKey();
  for (const [k, v] of buckets) if (v.day !== day) buckets.delete(k);
}, 60 * 60 * 1000).unref();

module.exports = { allow, refund, GUEST_CAP };
