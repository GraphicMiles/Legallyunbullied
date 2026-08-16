/**
 * Tests for opening a chat URL while signed out (and the surrounding states).
 *
 * Verifies:
 *   1. Signed-out + chat URL → "Sign in to view this chat" (NOT a misleading
 *      "Chat not found"), a visible Sign in button, and the sidebar resolves
 *      to the empty state instead of hanging on "Loading…".
 *   2. Signed-out + base URL → the normal empty landing state (no sign-in
 *      prompt, no chat status).
 *   3. Signed-in + unknown chat URL → "Chat not found" (ownership messaging
 *      preserved for authenticated users).
 *   4. Signed-in + known chat URL → loads the conversation.
 *
 * Run: node test-chat-signedout-url.js
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

async function setupPage(browser, { signedOut, seed } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const user = signedOut ? null : { uid: "user-abc", email: "a@b.com", displayName: null, photoURL: null };
  await page.addInitScript((u) => {
    window.__FAKE_AUTH__ = { currentUser: u, _listeners: [] };
    window.firebaseAuth = window.__FAKE_AUTH__;
  }, user);
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
    console.log("\n=== Signed-out chat URL tests ===\n");

    await check("signed-out + chat URL shows 'Sign in to view this chat', not 'Chat not found'", async () => {
      const page = await setupPage(browser, { signedOut: true });
      await page.goto(`${BASE}/#chat/69d440c2-d133-4fee-a710-289a3b807b56`, { waitUntil: "load" });
      await page.waitForFunction(() => !document.getElementById("chat-status").hidden, null, { timeout: 8000 });
      const state = await page.evaluate(() => ({
        title: document.getElementById("chat-status-title").textContent,
        subtitle: document.getElementById("chat-status-subtitle").textContent,
        signinVisible: document.getElementById("chat-status-signin").style.display,
        homeVisible: document.getElementById("chat-status-home").style.display,
      }));
      assert.strictEqual(state.title, "Sign in to view this chat", `got '${state.title}'`);
      assert.ok(!state.subtitle.includes("doesn't exist"), "must not claim the chat doesn't exist");
      assert.strictEqual(state.signinVisible, "inline-flex", "sign-in button must be visible");
      assert.strictEqual(state.homeVisible, "none", "home button should not be the primary action here");
      await page.close();
    });

    await check("signed-out sidebar resolves (never hangs on 'Loading…')", async () => {
      const page = await setupPage(browser, { signedOut: true });
      await page.goto(`${BASE}/#chat/69d440c2-d133-4fee-a710-289a3b807b56`, { waitUntil: "load" });
      // Wait for auth to settle (signed out) + resolveUrl to run.
      await page.waitForFunction(() => document.getElementById("history-list").textContent.trim() !== "Loading…", null, { timeout: 8000 });
      const text = await page.evaluate(() => document.getElementById("history-list").textContent.trim());
      assert.strictEqual(text, "No questions yet.", `sidebar must resolve to empty state, got '${text}'`);
      await page.close();
    });

    await check("signed-out + base URL shows the normal landing state", async () => {
      const page = await setupPage(browser, { signedOut: true });
      await page.goto(`${BASE}`, { waitUntil: "load" });
      await page.waitForFunction(() => document.getElementById("history-list").textContent.trim() !== "Loading…", null, { timeout: 8000 });
      const state = await page.evaluate(() => ({
        statusHidden: document.getElementById("chat-status").hidden,
        emptyShown: document.getElementById("empty-state").style.display,
      }));
      assert.strictEqual(state.statusHidden, true, "no chat-status message on the base URL");
      assert.strictEqual(state.emptyShown, "flex", "landing empty state must be shown");
      await page.close();
    });

    await check("signed-in + unknown chat URL still shows 'Chat not found'", async () => {
      const page = await setupPage(browser, { signedOut: false });
      await page.route("**/api/conversations/migrate", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, idMap: {}, migrated: 0, skipped: 0 }) }));
      await page.route("**/api/conversations/cleanup", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, deleted: 0 }) }));
      await page.route("**/api/conversations?full=true", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ conversations: [] }) }));
      // Single-chat endpoint → 404 for a missing/foreign chat.
      await page.route("**/api/conversations/unknown-id-123", (r) => r.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not_found", message: "Conversation not found." }) }));
      await page.goto(`${BASE}/#chat/unknown-id-123`, { waitUntil: "load" });
      await page.waitForFunction(
        () => document.getElementById("chat-status-title").textContent === "Chat not found",
        null, { timeout: 8000 }
      );
      const subtitle = await page.evaluate(() => document.getElementById("chat-status-subtitle").textContent);
      assert.ok(subtitle.includes("doesn't exist"), "authenticated unknown URL must get the real not-found message");
      await page.close();
    });

    await check("signed-in + known chat URL loads the conversation", async () => {
      const page = await setupPage(browser, { signedOut: false, seed: [{ id: "chat-known", title: "My chat", createdAt: 1, updatedAt: 1, messages: [] }] });
      await page.route("**/api/conversations/migrate", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, idMap: {}, migrated: 0, skipped: 0 }) }));
      await page.route("**/api/conversations/cleanup", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, deleted: 0 }) }));
      await page.route("**/api/conversations?full=true", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ conversations: [{ id: "chat-known", title: "My chat", createdAt: 1, updatedAt: 1, messages: [] }] }) }));
      await page.goto(`${BASE}/#chat/chat-known`, { waitUntil: "load" });
      await page.waitForFunction(() => document.querySelector(".history__row.is-active"), null, { timeout: 8000 });
      const active = await page.evaluate(() => document.querySelector(".history__row.is-active .history__item")?.dataset.id || null);
      assert.strictEqual(active, "chat-known", "known chat must become active");
      await page.close();
    });

    await browser.close();
    console.log(failures === 0 ? "\nALL SIGNED-OUT-URL TESTS PASSED" : `\n${failures} SIGNED-OUT-URL TEST(S) FAILED`);
  } finally {
    server.kill();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
