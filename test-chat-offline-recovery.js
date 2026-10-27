/**
 * Browser test for boot-on-a-shaky-connection recovery.
 *
 * Regression: booting while the device is offline used to fail silently —
 * Firebase's securetoken refresh 5xx'd, GET /api/conversations failed with a
 * network error, the sidebar stayed empty, and only a manual page refresh
 * recovered. The app now (a) surfaces an "offline" pill when the browser is
 * offline and (b) re-runs the boot load when connectivity returns.
 *
 * Checks:
 *   1. Boot with network failure on /api/conversations → the offline pill
 *      appears as soon as the browser goes offline.
 *   2. When connectivity returns, /api/conversations is re-fetched WITHOUT a
 *      reload and the sidebar populates.
 *   3. A clean boot never shows the pill.
 *
 * Run: node test-chat-offline-recovery.js
 */

const { chromium } = require("playwright");
const { spawn } = require("child_process");
const assert = require("assert");

const PORT = Number(process.env.TEST_PORT) || 3000;
const BASE = `http://127.0.0.1:${PORT}`;

const FAKE_USER = { uid: "offline-user", email: "offline@test.dev", displayName: null, photoURL: null };

function startServer() {
  const proc = spawn("node", ["server.js"], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    let done = false;
    proc.stdout.on("data", (d) => {
      if (!done && d.toString().includes("listening on port")) { done = true; resolve(proc); }
    });
    proc.on("exit", () => { if (!done) { done = true; reject(new Error("server exited early")); } });
    setTimeout(() => { if (!done) { done = true; reject(new Error("server start timeout")); } }, 10000);
  });
}

const STUBS = {
  "firebase-app.js": `export function initializeApp(cfg){ return {}; }`,
  "firebase-firestore.js": `export function getFirestore(app){ return {}; }`,
  "firebase-auth.js": `
    export function getAuth(app){ return window.__FAKE_AUTH__; }
    export function onAuthStateChanged(auth, cb){
      auth._listeners = auth._listeners || [];
      auth._listeners.push(cb);
      setTimeout(() => cb(auth.currentUser), 0);
      return () => {};
    }
    export async function getIdToken(user){ return "fake-token"; }
    export class GoogleAuthProvider {}
    export async function signInWithEmailAndPassword(){}
    export async function createUserWithEmailAndPassword(){}
    export async function signInWithPopup(){}
    export async function signOut(auth){ auth.currentUser = null; (auth._listeners||[]).forEach(cb => cb(null)); }
  `,
};

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); }
  catch (err) { failures++; console.log(`  FAIL  ${name}\n        ${err.stack || err.message}`); }
}

(async () => {
  console.log("\n=== Offline recovery tests ===\n");
  const server = await startServer();
  const browser = await chromium.launch();

  try {
    // ── 1. Offline boot → pill appears, auto-recovery on reconnect ────────
    await check("offline boot shows the pill and reconnecting reloads the list", async () => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();

      await page.addInitScript((user) => {
        window.__FAKE_AUTH__ = { currentUser: user, _listeners: [] };
        window.firebaseAuth = window.__FAKE_AUTH__;
      }, FAKE_USER);

      await page.route("https://www.gstatic.com/firebasejs/**", (route) => {
        const name = route.request().url().split("/").pop().split("?")[0];
        route.fulfill({ status: 200, contentType: "text/javascript", body: STUBS[name] || "export {};" });
      });
      await page.route("**/api/conversations/migrate", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, idMap: {}, migrated: 0, skipped: 0 }) }));

      let listCalls = 0;
      const conversationsRespond = (route) => {
        listCalls += 1;
        if (context.__offline) {
          return route.abort("failed");
        }
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          conversations: [{ id: "recovered-chat", title: "Recovered", createdAt: 1, updatedAt: 1, messages: [] }],
        }) });
      };
      context.__offline = true; // start offline
      await page.route("**/api/conversations?limit=*", conversationsRespond);

      await page.goto(`${BASE}`, { waitUntil: "load" });

      // Boot happened while offline: load fails. Wait for the app's own
      // recovery wiring to be in place.
      await page.waitForFunction(() => typeof window.LUDebug !== "undefined", null, { timeout: 8000 });
      await page.waitForTimeout(1200);

      // Simulate the browser reporting offline (the real offline event).
      await page.evaluate(() => window.dispatchEvent(new Event("offline")));
      const pill = page.locator("#lu-offline-pill");
      await pill.waitFor({ state: "visible", timeout: 3000 });

      // Connectivity returns.
      context.__offline = false;
      await page.evaluate(() => window.dispatchEvent(new Event("online")));

      // The pill hides and the boot load re-runs.
      await pill.waitFor({ state: "detached", timeout: 3000 });
      await page.waitForFunction(() => {
        const items = [...document.querySelectorAll(".history__item")];
        return items.some((b) => b.dataset.id === "recovered-chat");
      }, null, { timeout: 5000 });
      assert.ok(listCalls >= 2, `conversations list must be re-fetched after reconnect (got ${listCalls} calls)`);

      await context.close();
    });

    // ── 2. Clean boot never shows the pill ────────────────────────────────
    await check("clean boot never shows the offline pill", async () => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      await page.addInitScript((user) => {
        window.__FAKE_AUTH__ = { currentUser: user, _listeners: [] };
        window.firebaseAuth = window.__FAKE_AUTH__;
      }, FAKE_USER);
      await page.route("https://www.gstatic.com/firebasejs/**", (route) => {
        const name = route.request().url().split("/").pop().split("?")[0];
        route.fulfill({ status: 200, contentType: "text/javascript", body: STUBS[name] || "export {};" });
      });
      await page.route("**/api/conversations**", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ conversations: [] }) }));

      await page.goto(`${BASE}`, { waitUntil: "load" });
      await page.waitForFunction(() => typeof window.LUDebug !== "undefined", null, { timeout: 8000 });
      await page.waitForTimeout(1000);

      const visible = await page.locator("#lu-offline-pill").count();
      assert.strictEqual(visible, 0, "pill must not exist on a clean boot");
      await context.close();
    });
  } finally {
    await browser.close();
    server.kill();
  }

  // Server may linger briefly while shutting down.
  await new Promise((r) => setTimeout(r, 300));

  if (failures > 0) {
    console.error(`\n${failures} OFFLINE RECOVERY TEST(S) FAILED`);
    process.exit(1);
  }
  console.log("\nALL OFFLINE RECOVERY TESTS PASSED");
})();
