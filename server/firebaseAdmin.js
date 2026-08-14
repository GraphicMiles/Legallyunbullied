/**
 * Firebase Admin SDK — server-side only.
 *
 * Reads the service account credential from FIREBASE_SERVICE_ACCOUNT_JSON
 * (a single-line JSON string). This is a genuinely secret credential
 * (full Firestore/Auth/Storage admin access, bypasses security rules) —
 * unlike the public web config in public/firebase-init.js. Never log it,
 * never send it to the client, never commit it.
 */

const admin = require("firebase-admin");

let app = null;
let db = null;

function getFirestore() {
  if (db) return db;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    console.warn("[firebaseAdmin] FIREBASE_SERVICE_ACCOUNT_JSON is not set — Firestore is disabled.");
    return null;
  }

  try {
    const serviceAccount = JSON.parse(raw);
    app = admin.apps.length ? admin.app() : admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    db = admin.firestore();
    // Some sandboxed/restricted network environments silently hang on the
    // long-lived gRPC (HTTP/2) streams the Admin SDK uses by default for
    // writes specifically (reads worked fine, writes hung indefinitely) —
    // forcing plain REST transport avoids that class of hang entirely.
    db.settings({ preferRest: true });
    return db;
  } catch (err) {
    console.error("[firebaseAdmin] Failed to initialize:", err.message);
    return null;
  }
}

module.exports = { getFirestore };
