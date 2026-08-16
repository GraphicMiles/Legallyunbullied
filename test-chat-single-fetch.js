/**
 * Part 1 tests: direct chat URLs must resolve via the single-chat endpoint
 * (GET /api/conversations/:id), NOT by searching the bulk list.
 *
 * Verification items:
 *   1. Valid chat URL (chat NOT in the loaded list) loads via the single-chat
 *      endpoint — verified by tracking actual network calls.
 *   2. A chat belonging to a different user → single endpoint 404 → "Chat not
 *      found" (never the chat content).
 *   3. Bulk list endpoint failing (non-retryable error) → direct chat URL
 *      still loads correctly via the single-chat endpoint.
 *   4. The sidebar itself still uses the bulk endpoint (unchanged in this
 *      pass), while the main area resolves the URL independently.
 *
 * Run: node test-chat-single-fetch.js
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

const AUTH_STUB = `
  export function getAuth(app){ return window.__FAKE_AUTH__; }
  export function onAuthStateChanged(auth, cb){
    auth._listeners = auth._listeners || [];
    auth._listeners.push(cb);
    setTimeout(() => cb(auth.currentUser), 0);
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

function chatDetail(id, title, messages = []) {
  return { id, title, createdAt: 1000, updatedAt: 1000, messages };
}

async function signedInPage(browser, { seed } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(() => {
    window.__FAKE_AUTH__ = { currentUser: { uid: "user-abc", email: "a@b.com", displayName: null, photoURL: null }, _listeners: [] };
    window.firebaseAuth = window.__FAKE_AUTH__;
  });
  if (seed) {
    await page.addInitScript(({ key, convos }) => {
      localStorage.setItem(key, JSON.stringify({ conversations: convos, activeId: null, questionsUsedToday: 0 }));
    }, { key: "lu.conversations.v3.user-abc", convos: seed });
  }
  await page.route("https://www.gstatic.com/firebasejs/**", (route) => {
    const name = route.request().url().split("/").pop().split("?")[0];
    if (name === "firebase-auth.js") return route.fulfill({ status: 200, contentType: "text/javascript", body: AUTH_STUB });
    return route.fulfill({ status: 200, contentType: "text/javascript", body: APP_STUB });
  });
  // Default mocks for the auth bootstrap endpoints.
  await page.route("**/api/conversations/migrate", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, idMap: {}, migrated: 0, skipped: 0 }) }));
  await page.route("**/api/conversations/cleanup", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, deleted: 0 }) }));
  return page;
}

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); }
  catch (err) { failures += 1; console.log(`  FAIL  ${name}\n        ${err.message}`); }
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({ args: ["--no-sandbox"] });

  try {
    console.log("\n=== Single-chat URL resolution tests ===\n");

    // ── 1. Valid URL not in the list → loads via the single-chat endpoint ──
    await check("valid chat URL (not in list) loads via the single-chat endpoint", async () => {
      const page = await signedInPage(browser);
      let listCalls = 0;
      let singleCalls = 0;
      await page.route("**/api/conversations?full=*", (r) => {
        listCalls += 1;
        // List contains a DIFFERENT chat, not the target.
        r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ conversations: [chatDetail("other-chat", "Some other chat")] }) });
      });
      await page.route("**/api/conversations/chat-target", (r) => {
        singleCalls += 1;
        r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(chatDetail("chat-target", "My targeted chat", [
          { id: "m1", role: "user", content: "hello", createdAt: 900 },
          { id: "m2", role: "agent", status: "done", content: "", createdAt: 950, result: { lawMd: "Under the law...", actionsMd: "- Step 1", sources: [], escalate: false, escalateReason: "", followUps: [] } },
        ])) });
      });

      await page.goto(`${BASE}/#chat/chat-target`, { waitUntil: "load" });
      await page.waitForFunction(() => document.querySelector(".history__row.is-active"), null, { timeout: 8000 });

      assert.ok(listCalls >= 1, "bulk list was fetched during bootstrap");
      assert.strictEqual(singleCalls, 1, `single-chat endpoint must be called exactly once, got ${singleCalls}`);
      const state = await page.evaluate(() => ({
        active: document.querySelector(".history__row.is-active .history__item")?.dataset.id || null,
        titles: [...document.querySelectorAll(".history__item-title")].map((t) => t.textContent),
        storedIds: JSON.parse(localStorage.getItem("lu.conversations.v3.user-abc")).conversations.map((c) => c.id).sort(),
      }));
      assert.strictEqual(state.active, "chat-target", "target chat must be active");
      assert.ok(state.titles.includes("My targeted chat"), "fetched chat title must appear in the sidebar");
      assert.ok(state.storedIds.includes("chat-target"), "fetched chat must be persisted locally");
      await page.close();
    });

    // ── 2. Foreign chat (different owner) → 404 → "Chat not found" ────────
    await check("foreign chat URL returns 404 → 'Chat not found' (no content)", async () => {
      const page = await signedInPage(browser);
      await page.route("**/api/conversations?full=*", (r) =>
        r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ conversations: [] }) }));
      await page.route("**/api/conversations/foreign-chat", (r) =>
        r.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not_found", message: "Conversation not found." }) }));

      await page.goto(`${BASE}/#chat/foreign-chat`, { waitUntil: "load" });
      await page.waitForFunction(
        () => document.getElementById("chat-status-title").textContent === "Chat not found",
        null, { timeout: 8000 }
      );
      const info = await page.evaluate(() => ({
        bodyText: document.getElementById("chat-messages").textContent,
        answerBlocks: document.querySelectorAll(".answer-block-plain").length,
        storedIds: JSON.parse(localStorage.getItem("lu.conversations.v3.user-abc")).conversations.map((c) => c.id),
      }));
      assert.strictEqual(info.answerBlocks, 0, "must not render the chat content");
      assert.ok(!info.storedIds.includes("foreign-chat"), "must not persist the foreign chat");
      await page.close();
    });

    // ── 3. Bulk list failing → direct URL still loads via single endpoint ─
    await check("bulk list failure does not block direct chat URL loading", async () => {
      const page = await signedInPage(browser);
      let singleCalls = 0;
      // Non-retryable failure on the bulk list (401) so loadFromServer gives up
      // immediately — the direct URL must not depend on it.
      await page.route("**/api/conversations?full=*", (r) =>
        r.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "unauthorized" }) }));
      await page.route("**/api/conversations/chat-target", (r) => {
        singleCalls += 1;
        r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(chatDetail("chat-target", "Survived list failure", [])) });
      });

      await page.goto(`${BASE}/#chat/chat-target`, { waitUntil: "load" });
      await page.waitForFunction(() => document.querySelector(".history__row.is-active"), null, { timeout: 8000 });
      const active = await page.evaluate(() => document.querySelector(".history__row.is-active .history__item")?.dataset.id || null);
      assert.strictEqual(active, "chat-target", "chat must load even though the bulk list failed");
      assert.strictEqual(singleCalls, 1, "single-chat endpoint must be used to recover");
      await page.close();
    });

    // ── 4. Sidebar still uses the bulk endpoint (unchanged) ───────────────
    await check("sidebar continues to render from the bulk list endpoint", async () => {
      const page = await signedInPage(browser);
      let listCalls = 0;
      let singleCalls = 0;
      await page.route("**/api/conversations?full=*", (r) => {
        listCalls += 1;
        r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          conversations: [
            chatDetail("list-a", "List chat A"),
            chatDetail("list-b", "List chat B"),
          ],
        }) });
      });
      await page.route("**/api/conversations/*", (r) => {
        // Any other /api/conversations/<id> GET counts as a single-chat call.
        if (r.request().method() === "GET") singleCalls += 1;
        r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ conversations: [] }) });
      });

      // Open the BASE url (no chat URL) so the sidebar comes from the list.
      await page.goto(`${BASE}`, { waitUntil: "load" });
      await page.waitForFunction(() => document.querySelectorAll(".history__item").length === 2, null, { timeout: 8000 });
      const titles = await page.evaluate(() => [...document.querySelectorAll(".history__item-title")].map((t) => t.textContent));
      assert.deepStrictEqual(titles.sort(), ["List chat A", "List chat B"], "sidebar must list the bulk-list conversations");
      assert.ok(listCalls >= 1, "bulk list endpoint must be used for the sidebar");
      assert.strictEqual(singleCalls, 0, "no single-chat call needed when no chat URL is open");
      await page.close();
    });

    await browser.close();
    console.log(failures === 0 ? "\nALL SINGLE-FETCH TESTS PASSED" : `\n${failures} SINGLE-FETCH TEST(S) FAILED`);
  } finally {
    server.kill();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
