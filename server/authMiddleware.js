/**
 * Firebase ID token verification middleware.
 * 
 * Extracts and verifies the Firebase ID token from the Authorization header,
 * attaches the decoded UID to req.uid for downstream handlers.
 * 
 * Bypasses security rules — this is server-side Admin SDK, so we must
 * verify tokens ourselves before trusting any user identity.
 */

const { getFirestore } = require("./firebaseAdmin");

let adminAuth = null;

function getAdminAuth() {
  if (adminAuth) return adminAuth;
  const db = getFirestore();
  if (!db) return null;
  // Admin SDK auth is available once the app is initialized
  const admin = require("firebase-admin");
  if (admin.apps.length) {
    adminAuth = admin.auth();
    return adminAuth;
  }
  return null;
}

/**
 * Middleware: require a valid Firebase ID token.
 * On success, sets req.uid to the authenticated user's Firebase UID.
 * On failure, responds 401.
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return res.status(401).json({ error: "unauthorized", message: "Missing Authorization header. Expected: Bearer <firebase-id-token>" });
  }

  const idToken = match[1];
  const auth = getAdminAuth();
  if (!auth) {
    // Firebase Admin not configured — can't verify tokens
    console.error("[authMiddleware] Firebase Admin SDK not initialized — cannot verify tokens");
    return res.status(503).json({ error: "auth_unavailable", message: "Authentication service is not configured on the server." });
  }

  auth.verifyIdToken(idToken)
    .then((decoded) => {
      req.uid = decoded.uid;
      next();
    })
    .catch((err) => {
      console.warn(`[authMiddleware] Token verification failed: ${err.message}`);
      return res.status(401).json({ error: "invalid_token", message: "Firebase ID token is invalid or expired." });
    });
}

module.exports = { requireAuth };
