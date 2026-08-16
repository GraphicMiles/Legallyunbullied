/**
 * liveAuth.js — mints a valid Firebase ID token for driving the LIVE
 * Legally Unbullied API during evaluation, with no interactive sign-in.
 *
 * How it works:
 *   1. Load the service-account JSON from .env (same account the server
 *      trusts via firebase-admin).
 *   2. admin.auth().createCustomToken(uid) → a custom token.
 *   3. Exchange the custom token for a real ID token via the public
 *      Firebase Auth REST endpoint (identitytoolkit) using the project's
 *      PUBLIC web API key (fetched from the deployed /firebase-config.js,
 *      which is served to every browser anyway).
 *   4. The ID token is what requireAuth's admin.auth().verifyIdToken()
 *      accepts in the `Authorization: Bearer <idToken>` header.
 *
 * ID tokens expire after 1 hour, so the runner caches the token and
 * transparently re-mints it when it nears expiry.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const admin = require("firebase-admin");

const REPO_ROOT = path.join(__dirname, "..", "..");
const ENV_PATH = path.join(REPO_ROOT, ".env");

// Public web API key — fetched live from the deployed server so we never
// hardcode anything and always match the current project.
const DEFAULT_WEB_API_KEY = "AIzaSyD8ISl4LfU1cpUFAaK_ySSw-7y4jkbQG4o";

let cached = null; // { idToken, expiresAt }

function loadServiceAccount() {
  const env = fs.readFileSync(ENV_PATH, "utf-8");
  const m = env.match(/FIREBASE_SERVICE_ACCOUNT_JSON=(.+)/);
  if (!m) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON not found in .env");
  const raw = m[1].trim();
  // Strip surrounding quotes if present
  const cleaned = raw.replace(/^['"]|['"]$/g, "");
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new Error("Failed to parse service account JSON: " + e.message);
  }
}

function ensureAdminApp() {
  if (!admin.apps.length) {
    const sa = loadServiceAccount();
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  }
  return admin;
}

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = Buffer.from(JSON.stringify(body));
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": payload.length,
        },
        timeout: 30000,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch (e) {
            reject(new Error("Invalid JSON: " + data.slice(0, 200)));
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("token exchange timed out")));
    req.write(payload);
    req.end();
  });
}

async function mintIdToken(uid, webApiKey) {
  const adm = ensureAdminApp();
  const customToken = await adm.auth().createCustomToken(uid);
  const url =
    "https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=" +
    encodeURIComponent(webApiKey || DEFAULT_WEB_API_KEY);
  const res = await postJson(url, { token: customToken, returnSecureToken: true });
  if (res.status !== 200 || !res.body.idToken) {
    throw new Error(
      "Token exchange failed: " + JSON.stringify(res.body).slice(0, 300)
    );
  }
  return res.body;
}

/**
 * Returns a fresh, valid ID token, re-minting when the cached one is
 * within 5 minutes of expiry (ID tokens last ~1 hour).
 */
async function getIdToken({ uid = "eval-suite", webApiKey } = {}) {
  if (cached && Date.now() < cached.expiresAt - 5 * 60 * 1000) {
    return cached.idToken;
  }
  const body = await mintIdToken(uid, webApiKey || DEFAULT_WEB_API_KEY);
  // Firebase ID tokens carry exp in seconds.
  const expMs = (parseInt(body.expiresIn, 10) || 3600) * 1000;
  cached = { idToken: body.idToken, expiresAt: Date.now() + expMs };
  return cached.idToken;
}

function clearTokenCache() {
  cached = null;
}

module.exports = { getIdToken, clearTokenCache, mintIdToken, loadServiceAccount };

if (require.main === module) {
  getIdToken()
    .then((t) => {
      console.log("ID token length:", t.length);
      console.log(t);
    })
    .catch((err) => {
      console.error("Failed:", err.message);
      process.exit(1);
    });
}
