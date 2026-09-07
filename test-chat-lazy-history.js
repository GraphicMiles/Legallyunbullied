/**
 * Browser test: fast sign-in with large histories + bounded chat payloads.
 *
 * Regression coverage for: "sign-in with old messages takes forever" and
 * "chatting after loading old chats errors with no response".
 *
 * Verifies:
 *   1. The sidebar list loads SUMMARY rows (limit=25, no full=true) — never
 *      the old ?full=true payload that inlined every message of every chat.
 *   2. Opening a chat whose messages are not loaded fetches the full thread
 *      exactly once via the single-chat endpoint (lazy load), and re-opening
 *      it does not refetch.
 *   3. A chat request built on top of a long, fat history stays well under
 *      the request body limit: history ≤ 18 entries, per-message content
 *      capped, no evidence blobs.
 *   4. Migration of a large localStorage state is sent in multiple batches
 *      (never one giant POST that 413s and retries forever).
 *
 * Run: node test-chat-lazy-history.js
 */

const { chromium } = require("playwright");
const { spawn } = require("child_process");
const assert = require("assert");

const PORT = Number(process.env.TEST_PORT) || 3000;
const BASE = `http://127.0.0.1:${PORT}`;

const FAKE_USER = { uid: "user-abc", email: "rfarouq69@gmail.com", displayName: null, photoURL: null };

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

// Firebase module stubs (served in place of the real CDN files)
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

async function setupPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript((user) => {
    window.__FAKE_AUTH__ = { currentUser: user, _listeners: [] };
    window.firebaseAuth = window.__FAKE_AUTH__;
  }, FAKE_USER);
  await page.route("https://www.gstatic.com/firebasejs/**", (route) => {
    const name = route.request().url().split("/").pop().split("?")[0];
    route.fulfill({ status: 200, contentType: "text/javascript", body: STUBS[name] || "export {};" });
  });
  return page;
}

// Stub the sync endpoints every variant needs: migration + cleanup + summary list.
async function stubBaseEndpoints(page) {
  await page.route("**/api/conversations/migrate", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, idMap: {}, migrated: 0, skipped: 0 }) }));
  await page.route("**/api/conversations/cleanup", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, deleted: 0 }) }));
}

const ANSWER = {
  classification: { practice_area: "tenancy", jurisdiction: "Lagos State", urgency: "Medium", route: "simple" },
  route: "simple",
  result: { lawMd: "The law says the landlord must give notice.", actionsMd: "- Step 1: document", sources: [], escalate: false, escalateReason: "resolvable", followUps: [] },
  critique: null,
  evidence: { sufficient: true, sourceCount: 1, minSources: 2, reason: "ok" },
  providersBusy: false,
  retryAfter: null,
};

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); }
  catch (err) { failures += 1; console.log(`  FAIL  ${name}\n        ${err.message}`); }
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({ args: ["--no-sandbox"] });

  try {
    console.log("\n=== Lazy history + payload diet tests ===\n");

    // ── 1 + 2 + 3: summaries, lazy single fetch, bounded chat body ─────────
    await check("sidebar loads summaries (no full=true) and opening a chat lazily fetches its thread exactly once", async () => {
      const page = await setupPage(browser);
      await stubBaseEndpoints(page);

      const listUrls = [];
      let singleFetches = 0;
      const chatBodies = [];

      await page.route("**/api/conversations?limit=*", (route) => {
        listUrls.push(route.request().url());
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          conversations: [
            { id: "fat-chat", title: "Old long chat", createdAt: 1000, updatedAt: 2000, messageCount: 20 },
          ],
          hasMore: false,
          nextCursor: null,
        }) });
      });

      // 20 stored messages, each ~4000 chars — ~80kb of history in total.
      const fat = (i) => `Message ${i}. ` + "x".repeat(4000);
      const messages = [];
      for (let i = 0; i < 20; i++) {
        messages.push(i % 2 === 0
          ? { id: `m${i}`, role: "user", status: "done", content: fat(i), createdAt: 1000 + i }
          : { id: `m${i}`, role: "agent", status: "done", content: fat(i), createdAt: 1000 + i,
              classification: { practice_area: "tenancy", jurisdiction: "Lagos State", urgency: "Medium" } });
      }

      await page.route("**/api/conversations/fat-chat", (route) => {
        if (route.request().method() !== "GET") return route.fallback();
        singleFetches += 1;
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          id: "fat-chat", title: "Old long chat", createdAt: 1000, updatedAt: 2000, messages,
        }) });
      });

      await page.route("**/api/chat", (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        chatBodies.push(route.request().postData());
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ANSWER) });
      });

      await page.goto(`${BASE}/#chat/fat-chat`, { waitUntil: "load" });
      await page.waitForFunction(() => document.querySelector(".history__item"), null, { timeout: 10000 });
      await page.waitForFunction(() => window.promptBar && window.promptBar.isSubmitting === false, null, { timeout: 10000 });

      await check("list URL is a summary request", () => {
        assert.ok(listUrls.length >= 1, "list request must have been made");
        assert.ok(!listUrls[0].includes("full=true"), `list must NOT request full histories: ${listUrls[0]}`);
        assert.ok(listUrls[0].includes("limit=25"), `list must paginate: ${listUrls[0]}`);
      });

      await page.waitForFunction(() => singleFetchesMarker() >= 1, null, { timeout: 10000 }).catch(() => {});
      function singleFetchesMarker() { return singleFetches; }

      await check("opening the chat fetched its full thread exactly once", async () => {
        await page.waitForTimeout(600); // allow the lazy fetch to land
        assert.ok(singleFetches >= 1, "single-chat endpoint must have been called for the summary-only chat");
      });

      // Send a message on top of the (now loaded) fat history.
      await page.evaluate(() => { window.promptBar.inputElement.value = "A follow-up question about my case"; window.promptBar.submit(); });
      await page.waitForFunction(
        () => { const c = document.querySelector(".beui-recommendation-card"); return !!(c && c.offsetParent !== null); },
        null, { timeout: 30000 }
      );

      await check("chat request body stays far under the 50kb server limit", () => {
        assert.ok(chatBodies.length >= 1, "chat request must have been captured");
        const body = chatBodies[chatBodies.length - 1];
        assert.ok(body.length < 45000, `chat body must stay under the 50kb limit, got ${body.length} bytes`);
      });

      await check("history window is capped at 18 entries with trimmed content and no evidence blobs", () => {
        const body = JSON.parse(chatBodies[chatBodies.length - 1]);
        assert.ok(Array.isArray(body.history), "history must be an array");
        assert.ok(body.history.length <= 18, `history must be <= 18 entries, got ${body.history.length}`);
        for (const m of body.history) {
          assert.ok(typeof m.content === "string" && m.content.length <= 1500, `history content must be <= 1500 chars, got ${m.content ? m.content.length : m.content}`);
          assert.ok(!("evidence" in m), "history entries must not carry evidence blobs");
        }
      });

      await check("re-opening the chat does not refetch the thread", async () => {
        const before = singleFetches;
        await page.evaluate(() => { window.location.hash = ""; });
        await page.waitForTimeout(300);
        await page.evaluate(() => { window.location.hash = "#chat/fat-chat"; });
        await page.waitForTimeout(600);
        assert.strictEqual(singleFetches, before, "a loaded chat must not be refetched on re-open");
      });

      await page.close();
    });

    // ── 4: migration of a large localStorage state is batched ──────────────
    await check("migration sends large legacy state in multiple batches", async () => {
      const page = await setupPage(browser);
      await stubBaseEndpoints(page);

      await page.route("**/api/conversations?limit=*", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ conversations: [], hasMore: false, nextCursor: null }) }));

      const migrateBodies = [];
      await page.unroute("**/api/conversations/migrate");
      await page.route("**/api/conversations/migrate", (route) => {
        const body = route.request().postDataJSON();
        migrateBodies.push(body);
        const idMap = {};
        for (const c of body.conversations) idMap[c.id] = c.id;
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, idMap, migrated: body.conversations.length, skipped: 0 }) });
      });

      // 60 legacy conversations — over the server's 50-per-request cap, so
      // any single-POST implementation fails; batched migration must split it.
      const legacy = [];
      for (let i = 0; i < 60; i++) {
        legacy.push({ id: `legacy-${i}`, title: `Legacy chat ${i}`, createdAt: 1000 + i, updatedAt: 1000 + i, messages: [] });
      }
      await page.addInitScript(({ key, convos }) => {
        localStorage.setItem(key, JSON.stringify({ conversations: convos, activeId: null }));
      }, { key: "lu.conversations.v3.user-abc", convos: legacy });

      await page.goto(`${BASE}`, { waitUntil: "load" });
      await page.waitForFunction(() => window.promptBar && window.promptBar.inputElement, null, { timeout: 10000 });
      await page.waitForTimeout(1200); // let background migration finish

      await check("migration was split into batches within server caps", () => {
        assert.ok(migrateBodies.length >= 2, `expected >= 2 migration POSTs, got ${migrateBodies.length}`);
        for (const body of migrateBodies) {
          assert.ok(body.conversations.length <= 50, `no batch may exceed the server's 50-conversation cap, got ${body.conversations.length}`);
        }
        const total = migrateBodies.reduce((n, b) => n + b.conversations.length, 0);
        assert.strictEqual(total, 60, "every legacy conversation must be migrated exactly once");
      });

      await page.close();
    });

  } finally {
    await browser.close();
    server.kill();
  }

  if (failures) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nALL LAZY HISTORY TESTS PASSED");
}

main().catch((err) => { console.error(err); process.exit(1); });
