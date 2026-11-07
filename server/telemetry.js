/**
 * Outcome telemetry — one daily counter document per UTC day in `telemetry_daily`.
 *
 * Counts ONLY pipeline outcomes (no PII, no content): terminal status
 * occurrences, safety acknowledgements, guest-quota exhaustion. Used to see
 * the shape of traffic before changing the gate/judge/retrieval rules.
 *
 * Fire-and-forget: never blocks or fails a user request; if Firestore is
 * unavailable the increment is a silent no-op (warn once per failure).
 */
const { getFirestore } = require("./firebaseAdmin");

const COLLECTION = process.env.TELEMETRY_COLLECTION || "telemetry_daily";
const KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;

function sanitizeKey(name) {
  const key = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return KEY_RE.test(key) ? key : null;
}

const utcDate = () => new Date().toISOString().slice(0, 10);

async function increment(name) {
  try {
    const key = sanitizeKey(name);
    if (!key) return;
    const db = getFirestore();
    if (!db) return;
    const { FieldValue } = require("firebase-admin").firestore;
    await db.collection(COLLECTION).doc(utcDate()).set(
      { date: utcDate(), [key]: FieldValue.increment(1) },
      { merge: true }
    );
  } catch (err) {
    console.warn("[telemetry] increment failed:", err.message);
  }
}

/** Count a terminal pipeline status (done/error/casual/... — future statuses track themselves). */
function countTerminalStatus(status) {
  return increment("status_" + String(status || ""));
}

/** Most recent `limit` day documents, newest first. limit clamped to 1..92. */
async function exportRecent(limit = 14) {
  const db = getFirestore();
  if (!db) return null;
  const capped = Math.min(Math.max(Number.parseInt(limit, 10) || 14, 1), 92);
  const snap = await db.collection(COLLECTION).orderBy("date", "desc").limit(capped).get();
  return snap.docs.map((doc) => ({ date: doc.id, ...doc.data() }));
}

module.exports = { increment, countTerminalStatus, exportRecent };
