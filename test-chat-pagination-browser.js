/**
 * Browser tests for sidebar pagination + server-side search (Part 2).
 *
 * Verifies:
 *   1. Initial load requests the first page (?full=true&limit=25) and renders
 *      the page plus a "Load more" button when more exist.
 *   2. Clicking "Load more" requests the next page with the cursor and appends
 *      it (no replacement), removing the button at the end.
 *   3. The search box searches server-side across ALL conversations
 *      (?q=...&full=false), not just the loaded pages.
 *   4. Clicking a search result that isn't in the loaded list loads it via the
 *      single-chat endpoint and renders its messages.
 *   5. Clearing the search returns to the paginated list.
 *
 * Run: node test-chat-pagination-browser.js
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

function convo(id, title, messages = []) {
  return { id, title, createdAt: 1, updatedAt: 1, messages };
}

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); }
  catch (err) { failures += 1; console.log(`  FAIL  ${name}\n        ${err.message}`); }
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  try {
    console.log("\n=== Sidebar pagination + search tests ===\n");

    await page.addInitScript(() => {
      window.__FAKE_AUTH__ = { currentUser: { uid: "user-abc", email: "a@b.com", displayName: null, photoURL: null }, _listeners: [] };
      window.firebaseAuth = window.__FAKE_AUTH__;
    });
    await page.route("https://www.gstatic.com/firebasejs/**", (route) => {
      const name = route.request().url().split("/").pop().split("?")[0];
      if (name === "firebase-auth.js") return route.fulfill({ status: 200, contentType: "text/javascript", body: AUTH_STUB });
      return route.fulfill({ status: 200, contentType: "text/javascript", body: APP_STUB });
    });

    const listRequests = [];
    let searchRequests = 0;
    let singleFetchRequests = 0;

    // Bootstrap endpoints.
    await page.route("**/api/conversations/migrate", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, idMap: {}, migrated: 0, skipped: 0 }) }));
    await page.route("**/api/conversations/cleanup", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, deleted: 0 }) }));

    // Paginated list: page 1 = 25 chats (hasMore), page 2 = 5 more (end).
    await page.route("**/api/conversations?full=*", (route) => {
      const url = route.request().url();
      listRequests.push(url);
      if (url.includes("cursor=")) {
        // Page 2: 5 older chats.
        const page2 = Array.from({ length: 5 }, (_, i) => convo(`chat-${26 + i}`, `Chat ${26 + i}`));
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ conversations: page2, hasMore: false, nextCursor: null }) });
      }
      const page1 = Array.from({ length: 25 }, (_, i) => convo(`chat-${1 + i}`, `Chat ${1 + i}`));
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ conversations: page1, hasMore: true, nextCursor: "chat-25" }) });
    });

    // Server-side search (title summaries only).
    await page.route("**/api/conversations?q=*", (route) => {
      searchRequests += 1;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        conversations: [{ id: "old-chat", title: "Landlord dispute", createdAt: 1, updatedAt: 1 }],
        hasMore: false,
        nextCursor: null,
      }) });
    });

    // Single-chat fetch for a search result not in the loaded list.
    await page.route("**/api/conversations/old-chat", (route) => {
      singleFetchRequests += 1;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(convo("old-chat", "Landlord dispute", [
        { id: "m1", role: "user", content: "my landlord increased my rent", createdAt: 10 },
        { id: "m2", role: "agent", status: "done", content: "", createdAt: 20, result: { lawMd: "The law says...", actionsMd: "- Step 1", sources: [], escalate: false, escalateReason: "", followUps: [] } },
      ])) });
    });

    await page.goto(`${BASE}`, { waitUntil: "load" });
    await page.waitForFunction(() => document.querySelectorAll(".history__item").length === 25, null, { timeout: 10000 });

    await check("initial load requests the first page with limit=25", () => {
      assert.ok(listRequests.length >= 1, "list request must have been made");
      assert.ok(listRequests[0].includes("full=true&limit=25"), `first list request should paginate: ${listRequests[0]}`);
    });

    await check("'Load more' button appears when more pages exist", async () => {
      const btn = await page.evaluate(() => {
        const b = document.querySelector(".history__load-more");
        return b ? b.textContent.trim() : null;
      });
      assert.strictEqual(btn, "Load more", `expected 'Load more' button, got '${btn}'`);
    });

    await check("clicking 'Load more' appends the next page via the cursor", async () => {
      await page.click(".history__load-more");
      await page.waitForFunction(() => document.querySelectorAll(".history__item").length === 30, null, { timeout: 8000 });
      assert.ok(listRequests.length >= 2, "a second list request must have been made");
      assert.ok(listRequests[listRequests.length - 1].includes("cursor=chat-25"), `second request must use the cursor: ${listRequests[listRequests.length - 1]}`);
      const btn = await page.evaluate(() => document.querySelector(".history__load-more"));
      assert.strictEqual(btn, null, "load-more button must disappear at the end");
      // No replacement: all 30 rows present.
      const ids = await page.evaluate(() => [...document.querySelectorAll(".history__item")].map((b) => b.dataset.id).length);
      assert.strictEqual(ids, 30, "all 30 conversations must be present (appended, not replaced)");
    });

    await check("search box searches server-side across all conversations", async () => {
      await page.fill("#history-search", "landlord");
      await page.waitForFunction(() => document.querySelectorAll(".history__item").length === 1, null, { timeout: 8000 });
      assert.ok(searchRequests >= 1, "a search request must have been made");
      const title = await page.evaluate(() => document.querySelector(".history__item-title").textContent);
      assert.strictEqual(title, "Landlord dispute", `search result should be the landlord chat, got '${title}'`);
    });

    await check("clicking a search result not in the list loads it via the single-chat endpoint", async () => {
      await page.click(".history__item");
      await page.waitForFunction(() => document.querySelectorAll(".msg__bubble").length >= 1, null, { timeout: 8000 });
      assert.strictEqual(singleFetchRequests, 1, "single-chat endpoint must be called once");
      const state = await page.evaluate(() => ({
        active: document.querySelector(".history__row.is-active .history__item")?.dataset.id || null,
        bubble: document.querySelector(".msg__bubble")?.textContent || null,
      }));
      assert.strictEqual(state.active, "old-chat", "the fetched chat must become active");
      assert.ok(state.bubble.includes("landlord"), `user message should render, got '${state.bubble}'`);
    });

    await check("clearing the search returns to the paginated list", async () => {
      await page.fill("#history-search", "");
      // 30 loaded from the list + 1 fetched via single-chat = 31.
      await page.waitForFunction(() => document.querySelectorAll(".history__item").length === 31, null, { timeout: 8000 });
      const ids = await page.evaluate(() => [...document.querySelectorAll(".history__item")].map((b) => b.dataset.id));
      assert.ok(ids.includes("old-chat"), "fetched chat must remain in the list after clearing search");
      const btn = await page.evaluate(() => document.querySelector(".history__load-more"));
      assert.strictEqual(btn, null, "list is fully loaded (no more pages)");
    });

    await browser.close();
    console.log(failures === 0 ? "\nALL PAGINATION TESTS PASSED" : `\n${failures} PAGINATION TEST(S) FAILED`);
  } finally {
    server.kill();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
