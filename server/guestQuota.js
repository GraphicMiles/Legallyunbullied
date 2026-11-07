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
 * Storage: Firestore when configured (Admin SDK), one document per bucket
 * in `guest_buckets` keyed by the bucket hash. Transactions make the
 * read-modify-write atomic, so concurrent requests from the same visitor
 * cannot overspend the cap, and buckets survive restarts and are shared
 * across instances. Documents are upserted lazily — old-day documents are
 * overwritten on the visitor's next request, so the collection does not
 * accumulate unbounded stale rows per active visitor.
 *
 * When Firestore is unavailable (local dev, missing credential, or a
 * transient Firestore error), the gate falls back to an in-memory bucket
 * and logs a warning. The gate never hard-fails: blocking a legal question
 * because the counter store hiccuped would be worse than a slightly loose
 * trial allowance.
 *
 * Limits to know (deliberate, documented):
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
const COLLECTION = "guest_buckets";
const buckets = new Map(); // in-memory fallback: key -> { day, count }

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

function memoryAllow(key, day) {
  let b = buckets.get(key);
  if (!b || b.day !== day) {
    b = { day, count: 0 };
    buckets.set(key, b);
  }
  if (b.count >= GUEST_CAP) return { allowed: false, remaining: 0, day, limit: GUEST_CAP };
  b.count += 1;
  return { allowed: true, remaining: GUEST_CAP - b.count, day, limit: GUEST_CAP };
}

function memoryRefund(key) {
  const b = key ? buckets.get(key) : null;
  if (b && b.count > 0) b.count -= 1;
}

function firestore() {
  try {
    const { getFirestore } = require("./firebaseAdmin");
    return getFirestore();
  } catch (_) {
    return null;
  }
}

async function firestoreAllow(db, key, day) {
  const ref = db.collection(COLLECTION).doc(key);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : null;
    if (!data || data.day !== day) {
      tx.set(ref, { day, count: 1, updatedAt: new Date().toISOString() });
      return { allowed: true, remaining: GUEST_CAP - 1, day, limit: GUEST_CAP };
    }
    if ((data.count || 0) >= GUEST_CAP) {
      return { allowed: false, remaining: 0, day, limit: GUEST_CAP };
    }
    const count = (data.count || 0) + 1;
    tx.update(ref, { count, updatedAt: new Date().toISOString() });
    return { allowed: true, remaining: GUEST_CAP - count, day, limit: GUEST_CAP };
  });
}

async function firestoreRefund(db, key) {
  const ref = db.collection(COLLECTION).doc(key);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : null;
    if (data && (data.count || 0) > 0) {
      tx.update(ref, { count: data.count - 1, updatedAt: new Date().toISOString() });
    }
  });
}

/** Consume one guest credit. Returns { allowed, key, remaining, day, limit }. */
async function allow(req) {
  const key = keyFor(req);
  const day = dayKey();
  const db = firestore();
  if (db) {
    try {
      const verdict = await firestoreAllow(db, key, day);
      return { ...verdict, key };
    } catch (err) {
      console.warn("[guestQuota] Firestore transaction failed — using in-memory bucket:", err.message);
    }
  }
  return { ...memoryAllow(key, day), key };
}

/** Refund one credit (question was served from cache; cost was zero). Never throws. */
async function refund(key) {
  if (!key) return;
  const db = firestore();
  if (db) {
    try {
      await firestoreRefund(db, key);
      return;
    } catch (err) {
      console.warn("[guestQuota] Firestore refund failed — refunding in-memory bucket:", err.message);
    }
  }
  memoryRefund(key);
}

// Hourly sweep of stale-day entries so the in-memory map can't grow without bound.
setInterval(() => {
  const day = dayKey();
  for (const [k, v] of buckets) if (v.day !== day) buckets.delete(k);
}, 60 * 60 * 1000).unref();

module.exports = { allow, refund, GUEST_CAP };
