/**
 * Firebase client initialization.
 *
 * Loaded as an ES module after /firebase-config.js has set
 * window.__FIREBASE_CONFIG__ (values come from server-side environment
 * variables — see server.js and .env.example). Nothing here is hardcoded.
 *
 * This only sets up the SDK instances and exposes them globally; nothing
 * in app.js consumes them yet (the app still runs on localStorage + mock
 * data per the current build). This is groundwork for wiring real Firebase
 * Auth + Firestore persistence per the PRD, without disrupting what's
 * already working.
 *
 * Module scripts are deferred until after HTML parsing, so other code that
 * needs Firebase should wait for the "firebase-ready" event rather than
 * assuming window.firebaseApp exists immediately:
 *
 *   window.addEventListener("firebase-ready", () => { ... });
 *
 * If config is missing (e.g. env vars not set yet on this deploy), this
 * fails quietly with a console warning instead of breaking the rest of the
 * app — the product works fully on localStorage without Firebase today.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const config = window.__FIREBASE_CONFIG__;
const hasConfig = config && Object.values(config).every(Boolean);

if (!hasConfig) {
  console.warn(
    "[firebase-init] Firebase config is incomplete — skipping init. " +
    "Set FIREBASE_* environment variables (see .env.example) to enable it."
  );
} else {
  try {
    const app = initializeApp(config);
    window.firebaseApp = app;
    window.firebaseAuth = getAuth(app);
    window.firebaseDb = getFirestore(app);
    window.dispatchEvent(new CustomEvent("firebase-ready"));
    console.info("[firebase-init] Firebase initialized for project:", config.projectId);
  } catch (err) {
    console.error("[firebase-init] Failed to initialize Firebase:", err);
  }
}
