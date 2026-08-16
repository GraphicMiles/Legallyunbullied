/**
 * Regression test: opening a direct chat URL must NOT double-load the chat.
 *
 * Reproduces the reported bug: a signed-in user with a cached copy of the chat
 * (write-behind cache) opens the chat URL. Previously resolveUrl()'s fast path
 * rendered the STALE cached copy before the authoritative server list loaded,
 * then the list replaced local state and the chat was fetched again via the
 * single-chat endpoint — a visible render-then-reload (flicker) plus a
 * redundant round-trip.
 *
 * Verifies:
 *   1. Exactly ONE single-chat GET (never two) when the chat isn't in the
 *      server list.
 *   2. The stale cached content is NEVER rendered (no flicker) — the chat area
 *      goes loading → final server content.
 *   3. In-list case: ZERO single-chat GETs (fast path only after list load).
 *   4. Part 1 not regressed: not-in-list still loads via the single endpoint.
 *
 * Run: node test-chat-no-duplicate-load.js
 */

const { chromium } = require("playwright");
const { spawn } = require("child_process");
const assert = require("assert");

const PORT = 3000;
const BASE = `http://127.0.0.1:${PORT}`;

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
    proc.on("exit", (code) => { if (!done) { done = true; reject(new Error("server exited early")); } });
    setTimeout(() => { if (!done) { done = true; reject(new Error("server start timeout")); } }, 10000);
  });
}

// Accurate double-fire auth (null first, then the restored user) like real
// Firebase session restoration.
const AUTH_STUB = `
  export function getAuth(app){ return window.__FAKE_AUTH__; }
  export function onAuthStateChanged(auth, cb){
    auth._listeners = auth._listeners || [];
    auth._listeners.push(cb);
    setTimeout(() => { auth.currentUser = null; cb(null); }, 5);
    setTimeout(() => { auth.currentUser = auth._user; cb(auth._user); }, 60);
    return () => {};
  }
  export async function getIdToken(){ return "fake-token"; }
  export class GoogleAuthProvider {}
  export async function signInWithEmailAndPassword(){}
  export async function createUserWithEmailAndPassword(){}
  export async function signInWithPopup(){}
  export async function signOut(auth){ auth.currentUser = null; (auth._listeners||[]).forEach(cb => cb(null)); }
`;
const APP_STUB = "export function initializeApp(){}; export function getFirestore(){};";

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); }
  catch (err) { failures += 1; console.log(`  FAIL  ${name}\n        ${err.message}`); }
}

async function setupPage(browser, { seedCache = true } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(({ seed }) => {
    window.__FAKE_AUTH__ = { currentUser: null, _user: { uid: "user-abc", email: "a@b.com", displayName: null, photoURL: null }, _listeners: [] };
    window.firebaseAuth = window.__FAKE_AUTH__;
    if (seed) {
      localStorage.setItem("lu.conversations.v3.user-abc", JSON.stringify({
        conversations: [{ id: "target-chat", title: "Cached target", createdAt: 1, updatedAt: 1, messages: [{ id: "m1", role: "user", content: "CACHED_STALE_CONTENT", createdAt: 1 }] }],
        activeId: null, questionsUsedToday: 0,
      }));
    }
    // MutationObserver: record whenever the stale cached bubble ever renders.
    // (Start on DOMContentLoaded — document.body isn't available yet inside
    // addInitScript.)
    window.__staleSeen = false;
    window.__staleObserver = new MutationObserver(() => {
      const b = document.querySelector(".msg__bubble");
      if (b && b.textContent.includes("CACHED_STALE_CONTENT")) window.__staleSeen = true;
    });
    window.addEventListener("DOMContentLoaded", () => {
      window.__staleObserver.observe(document.body, { childList: true, subtree: true });
    });
  }, { seed: seedCache });
  await page.route("https://www.gstatic.com/firebasejs/**", (route) => {
    const name = route.request().url().split("/").pop().split("?")[0];
    if (name === "firebase-auth.js") return route.fulfill({ status: 200, contentType: "text/javascript", body: AUTH_STUB });
    return route.fulfill({ status: 200, contentType: "text/javascript", body: APP_STUB });
  });
  await page.route("**/api/conversations/migrate", r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, idMap: {}, migrated: 0, skipped: 0 }) }));
  await page.route("**/api/conversations/cleanup", r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, deleted: 0 }) }));
  return page;
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({ args: ["--no-sandbox"] });

  try {
    console.log("\n=== No-duplicate-load tests ===\n");

    // ── 1. Not-in-list + cached → exactly one single-chat GET, no stale render
    {
      const page = await setupPage(browser, { seedCache: true });
      let singleGets = 0;
      let listGets = 0;
      await page.route("**/api/conversations?full=*", r => {
        listGets += 1;
        r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          conversations: [{ id: "other-chat", title: "Other", createdAt: 1, updatedAt: 1, messages: [] }],
          hasMore: false, nextCursor: null,
        }) });
      });
      await page.route("**/api/conversations/target-chat", r => {
        if (r.request().method() === "GET") singleGets += 1;
        r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          id: "target-chat", title: "Target", createdAt: 1, updatedAt: 1,
          messages: [{ id: "m1", role: "user", content: "FINAL_SERVER_CONTENT", createdAt: 1 }],
        }) });
      });

      await page.goto(`${BASE}/#chat/target-chat`, { waitUntil: "load" });
      await page.waitForFunction(
        () => { const b = document.querySelector(".msg__bubble"); return !!(b && b.textContent.includes("FINAL_SERVER_CONTENT")); },
        null, { timeout: 10000 }
      );
      await page.waitForTimeout(500); // allow any stray late render to appear

      await check("not-in-list + cached: exactly ONE single-chat GET", () => {
        assert.strictEqual(singleGets, 1, `expected 1 single-chat GET, got ${singleGets}`);
        assert.strictEqual(listGets, 1, `expected 1 list GET, got ${listGets}`);
      });

      await check("not-in-list + cached: stale cached content never rendered (no flicker)", async () => {
        const staleSeen = await page.evaluate(() => window.__staleSeen);
        assert.strictEqual(staleSeen, false, "the stale cached bubble must never render before the server resolves");
        const bubble = await page.evaluate(() => document.querySelector(".msg__bubble")?.textContent || "");
        assert.ok(bubble.includes("FINAL_SERVER_CONTENT"), "final server content must be shown");
      });
      await page.close();
    }

    // ── 2. In-list → ZERO single-chat GETs (fast path only) ───────────────
    {
      const page = await setupPage(browser, { seedCache: false });
      let singleGets = 0;
      await page.route("**/api/conversations?full=*", r => {
        r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          conversations: [{ id: "target-chat", title: "Target", createdAt: 1, updatedAt: 1, messages: [{ id: "m1", role: "user", content: "LIST_CONTENT", createdAt: 1 }] }],
          hasMore: false, nextCursor: null,
        }) });
      });
      await page.route("**/api/conversations/target-chat", r => {
        if (r.request().method() === "GET") singleGets += 1;
        r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "target-chat", title: "Target", createdAt: 1, updatedAt: 1, messages: [] }) });
      });

      await page.goto(`${BASE}/#chat/target-chat`, { waitUntil: "load" });
      await page.waitForFunction(() => document.querySelector(".history__row.is-active"), null, { timeout: 10000 });

      await check("in-list: ZERO single-chat GETs (no redundant load)", () => {
        assert.strictEqual(singleGets, 0, `expected 0 single-chat GETs when the chat is in the list, got ${singleGets}`);
      });
      const active = await page.evaluate(() => document.querySelector(".history__row.is-active .history__item")?.dataset.id || null);
      assert.strictEqual(active, "target-chat", "the chat must still open correctly");
      await page.close();
    }

    await browser.close();
    console.log(failures === 0 ? "\nALL NO-DUPLICATE-LOAD TESTS PASSED" : `\n${failures} NO-DUPLICATE-LOAD TEST(S) FAILED`);
  } finally {
    server.kill();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
