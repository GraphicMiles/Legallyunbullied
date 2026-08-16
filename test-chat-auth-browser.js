/**
 * Browser test for the authenticated server-backed chat lifecycle.
 *
 * Stubs the Firebase CDN modules and the /api/conversations endpoints to
 * simulate a signed-in user, then verifies:
 *   1. A direct #chat/{id} URL resolves against SERVER data (not cleared or
 *      shown as "not found" before the server load finishes).
 *   2. An unknown direct URL shows "Chat not found" and never creates a chat.
 *   3. Migration preserves the original conversation ID (client sends it).
 *   4. Migration runs once per user (flag persists).
 *   5. Base URL does not auto-create a chat even when authenticated.
 *
 * Run: node test-chat-auth-browser.js
 */

const { chromium } = require("playwright");
const { spawn } = require("child_process");
const assert = require("assert");

const PORT = 3000;
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

async function setupPage(browser, { seedConversations } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  // Fake authenticated Firebase user, available before any module runs.
  await page.addInitScript((user) => {
    window.__FAKE_AUTH__ = { currentUser: user, _listeners: [] };
    window.firebaseAuth = window.__FAKE_AUTH__;
  }, FAKE_USER);

  // Stub the Firebase CDN modules.
  await page.route("https://www.gstatic.com/firebasejs/**", (route) => {
    const url = route.request().url();
    const name = url.split("/").pop().split("?")[0];
    if (STUBS[name]) {
      route.fulfill({ status: 200, contentType: "text/javascript", body: STUBS[name] });
    } else {
      route.fulfill({ status: 200, contentType: "text/javascript", body: "export {};" });
    }
  });

  // Seed localStorage for the authenticated user BEFORE app.js runs.
  if (seedConversations) {
    await page.addInitScript(({ storageKey, convos }) => {
      localStorage.setItem(storageKey, JSON.stringify({ conversations: convos, activeId: null, questionsUsedToday: 0 }));
    }, { storageKey: "lu.conversations.v3.user-abc", convos: seedConversations });
  }

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
    console.log("\n=== Authenticated chat lifecycle browser tests ===\n");

    // ── 1. Direct URL resolves against server data ─────────────────────────
    await check("direct URL resolves against server data (no premature not-found)", async () => {
      const page = await setupPage(browser);
      let migrateCalls = 0;
      await page.route("**/api/conversations/migrate", (route) => {
        migrateCalls += 1;
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, idMap: {}, migrated: 0, skipped: 0 }) });
      });
      await page.route("**/api/conversations?full=true", (route) => {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          conversations: [
            { id: "server-chat-1", title: "Server chat", createdAt: 1000, updatedAt: 2000, messages: [] },
          ],
        }) });
      });

      await page.goto(`${BASE}/#chat/server-chat-1`, { waitUntil: "load" });
      await page.waitForFunction(
        () => !document.getElementById("chat-status").hidden === false && document.querySelector(".history__item"),
        null, { timeout: 8000 }
      );
      await page.waitForTimeout(400);

      const info = await page.evaluate(() => ({
        hash: window.location.hash,
        historyItems: [...document.querySelectorAll(".history__item")].map((b) => b.dataset.id),
        activeId: document.querySelector(".history__item.is-active")?.dataset.id || null,
        statusHidden: document.getElementById("chat-status").hidden,
      }));
      assert.strictEqual(info.hash, "#chat/server-chat-1", "direct URL must not be cleared or rewritten");
      assert.deepStrictEqual(info.historyItems, ["server-chat-1"], "sidebar must show the server conversation");
      assert.strictEqual(info.activeId, "server-chat-1", "server conversation must be active");
      assert.strictEqual(info.statusHidden, true, "status view should be hidden once the chat loads");
      await page.close();
    });

    // ── 2. Unknown direct URL → not found, no creation ────────────────────
    await check("unknown direct URL shows 'Chat not found' and creates nothing", async () => {
      const page = await setupPage(browser);
      let createdPosts = 0;
      await page.route("**/api/conversations/migrate", (route) => {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, idMap: {}, migrated: 0, skipped: 0 }) });
      });
      await page.route("**/api/conversations?full=true", (route) => {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ conversations: [] }) });
      });
      await page.route("**/api/conversations", (route) => {
        if (route.request().method() === "POST") createdPosts += 1;
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ conversations: [] }) });
      });

      await page.goto(`${BASE}/#chat/missing-id`, { waitUntil: "load" });
      await page.waitForFunction(
        () => document.getElementById("chat-status-title").textContent === "Chat not found",
        null, { timeout: 8000 }
      );
      const info = await page.evaluate(() => ({
        hash: window.location.hash,
        stored: JSON.parse(localStorage.getItem("lu.conversations.v3.user-abc") || "null"),
      }));
      assert.strictEqual(info.hash, "#chat/missing-id", "URL must remain unchanged");
      const convos = info.stored ? info.stored.conversations : [];
      assert.strictEqual(convos.length, 0, "must not fabricate a conversation");
      assert.strictEqual(createdPosts, 0, "must never POST-create a conversation for a missing URL");
      await page.close();
    });

    // ── 3. Migration preserves original ID + runs once ────────────────────
    await check("migration preserves the original ID and runs once per user", async () => {
      const legacyConvo = {
        id: "legacy-123",
        title: "Legacy chat",
        createdAt: 1000,
        updatedAt: 1000,
        messages: [{ id: "m1", role: "user", content: "hi", createdAt: 1000 }],
      };
      const page = await setupPage(browser, { seedConversations: [legacyConvo] });

      const migrateBodies = [];
      await page.route("**/api/conversations/migrate", (route) => {
        migrateBodies.push(route.request().postDataJSON());
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          success: true, idMap: { "legacy-123": "legacy-123" }, migrated: 1, skipped: 0,
        }) });
      });
      await page.route("**/api/conversations?full=true", (route) => {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          conversations: [{ id: "legacy-123", title: "Legacy chat", createdAt: 1000, updatedAt: 1000, messages: legacyConvo.messages }],
        }) });
      });

      // First load: migration should fire once with the original ID.
      await page.goto(`${BASE}`, { waitUntil: "load" });
      await page.waitForFunction(() => document.querySelector(".history__item"), null, { timeout: 8000 });
      await page.waitForTimeout(400);
      assert.strictEqual(migrateBodies.length, 1, "migration should fire exactly once on first load");
      assert.strictEqual(migrateBodies[0].conversations[0].id, "legacy-123", "client must send the original ID");
      assert.strictEqual(migrateBodies[0].conversations[0].messages[0].id, "m1", "message IDs preserved");

      // Reload: migration must NOT fire again (flag persisted under its own key).
      await page.reload({ waitUntil: "load" });
      await page.waitForFunction(() => document.querySelector(".history__item"), null, { timeout: 8000 });
      await page.waitForTimeout(400);
      assert.strictEqual(migrateBodies.length, 1, "migration must not re-run on subsequent loads");
      await page.close();
    });

    // ── 4. Authenticated base URL does not auto-create a chat ─────────────
    await check("authenticated base URL does not auto-create a chat", async () => {
      const page = await setupPage(browser);
      let createdPosts = 0;
      await page.route("**/api/conversations/migrate", (route) => {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, idMap: {}, migrated: 0, skipped: 0 }) });
      });
      await page.route("**/api/conversations/cleanup", (route) => {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, deleted: 0 }) });
      });
      await page.route("**/api/conversations?full=true", (route) => {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ conversations: [] }) });
      });
      await page.route("**/api/conversations", (route) => {
        if (route.request().method() === "POST") createdPosts += 1;
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ conversations: [] }) });
      });

      await page.goto(`${BASE}`, { waitUntil: "load" });
      await page.waitForTimeout(1000);
      const info = await page.evaluate(() => ({
        hash: window.location.hash,
        emptyShown: document.getElementById("empty-state").style.display,
        historyItems: document.querySelectorAll(".history__item").length,
      }));
      assert.strictEqual(info.hash, "", "no chat URL may be generated from the base URL");
      assert.strictEqual(info.emptyShown, "flex", "landing state must show");
      assert.strictEqual(info.historyItems, 0, "no conversation must exist");
      assert.strictEqual(createdPosts, 0, "no POST /api/conversations from the base URL");
      await page.close();
    });

    // ── 5. Sign-in automatically runs the legacy cleanup ──────────────────
    await check("sign-in automatically runs the safe legacy cleanup", async () => {
      const page = await setupPage(browser);
      let cleanupCalls = 0;
      const order = [];
      await page.route("**/api/conversations/migrate", (route) => {
        order.push("migrate");
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, idMap: {}, migrated: 0, skipped: 0 }) });
      });
      await page.route("**/api/conversations/cleanup", (route) => {
        cleanupCalls += 1;
        order.push("cleanup");
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, deleted: 3 }) });
      });
      await page.route("**/api/conversations?full=true", (route) => {
        order.push("load");
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          conversations: [{ id: "kept-chat", title: "Kept", createdAt: 1, updatedAt: 1, messages: [{ id: "m1", role: "user", content: "hi", createdAt: 1 }] }],
        }) });
      });

      await page.goto(`${BASE}`, { waitUntil: "load" });
      await page.waitForFunction(() => document.querySelector(".history__item"), null, { timeout: 8000 });
      await page.waitForTimeout(400);

      assert.strictEqual(cleanupCalls, 1, "cleanup must run exactly once on sign-in");
      assert.ok(order.indexOf("migrate") < order.indexOf("cleanup"), "cleanup must run after migration");
      assert.ok(order.indexOf("cleanup") < order.indexOf("load"), "cleanup must run before the server load");

      const info = await page.evaluate(() => ({
        historyItems: [...document.querySelectorAll(".history__item")].map((b) => b.dataset.id),
      }));
      assert.deepStrictEqual(info.historyItems, ["kept-chat"], "sidebar reflects the post-cleanup server state");
      await page.close();
    });

    // ── 6. User message AND title are synced (not just the agent reply) ──
    await check("user message and title are synced to the server", async () => {
      const page = await setupPage(browser);
      const messagePuts = []; // captured PUT bodies for /messages
      const titlePuts = [];   // captured PUT bodies for the conversation

      await page.route("**/api/conversations/migrate", (route) => {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, idMap: {}, migrated: 0, skipped: 0 }) });
      });
      await page.route("**/api/conversations/cleanup", (route) => {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, deleted: 0 }) });
      });
      await page.route("**/api/conversations?full=true", (route) => {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ conversations: [] }) });
      });
      // Message upserts (must be registered before the generic conversation route)
      await page.route("**/api/conversations/*/messages/*", (route) => {
        if (route.request().method() === "PUT") {
          const body = route.request().postDataJSON();
          if (body) messagePuts.push(body);
        }
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true }) });
      });
      // Conversation-level PUT (title update)
      await page.route("**/api/conversations/*", (route) => {
        if (route.request().method() === "PUT") {
          const body = route.request().postDataJSON();
          if (body) titlePuts.push(body);
        }
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true }) });
      });
      // Conversation create (POST) — echo the client-supplied id back
      await page.route("**/api/conversations", (route) => {
        if (route.request().method() === "POST") {
          const body = route.request().postDataJSON();
          route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: body.id, title: body.title, createdAt: Date.now(), updatedAt: Date.now() }) });
        } else {
          route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
        }
      });

      await page.goto(`${BASE}`, { waitUntil: "load" });
      await page.waitForFunction(() => window.promptBar && window.promptBar.inputElement, null, { timeout: 10000 });

      // Click New Chat, then send the first message.
      await page.click("#new-chat-btn");
      await page.waitForTimeout(200);
      await page.evaluate(() => {
        window.promptBar.inputElement.value = "My landlord is increasing my rent";
        window.promptBar.submit();
      });

      // Give the async syncToServer a moment to push the messages to the server.
      await page.waitForTimeout(1500);

      assert.ok(messagePuts.some((m) => m.role === "user"), "the user message must be synced to the server");
      assert.ok(messagePuts.some((m) => m.role === "agent"), "the agent message must be synced to the server");
      assert.ok(titlePuts.some((t) => t.title === "Tenancy question"), `title must be synced (got: ${JSON.stringify(titlePuts)})`);
      await page.close();
    });

    // ── 7. Stale localStorage cache must not flash before the server load ──
    await check("stale localStorage cache does not flash before the server load", async () => {
      // Seed 20 stale conversations in localStorage (simulating the spam era).
      const staleConvos = Array.from({ length: 20 }, (_, i) => ({
        id: `stale-${i}`,
        title: `Stale chat ${i}`,
        createdAt: 1000 + i,
        updatedAt: 1000 + i,
        messages: [],
      }));
      const page = await setupPage(browser, { seedConversations: staleConvos });

      await page.route("**/api/conversations/migrate", (route) => {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, idMap: {}, migrated: 0, skipped: 0 }) });
      });
      await page.route("**/api/conversations/cleanup", (route) => {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, deleted: 19 }) });
      });
      // Delay the server response so we can observe the in-flight state.
      await page.route("**/api/conversations?full=true", async (route) => {
        await new Promise((r) => setTimeout(r, 1200));
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          conversations: [{ id: "real-1", title: "Real chat", createdAt: 2000, updatedAt: 2000, messages: [] }],
        }) });
      });

      await page.goto(`${BASE}`, { waitUntil: "load" });
      await page.waitForTimeout(400);

      // While the server load is in flight, the sidebar must show a loading
      // placeholder — NOT the 20 stale conversations.
      const during = await page.evaluate(() => ({
        items: document.querySelectorAll(".history__item").length,
        empty: document.querySelector(".history__empty")?.textContent || null,
      }));
      assert.strictEqual(during.items, 0, `stale chats must not flash (found ${during.items})`);
      assert.strictEqual(during.empty, "Loading…", "sidebar should show a loading placeholder");

      // After the server responds, the sidebar shows the authoritative list.
      await page.waitForFunction(() => document.querySelectorAll(".history__item").length === 1, null, { timeout: 8000 });
      const after = await page.evaluate(() =>
        [...document.querySelectorAll(".history__item")].map((b) => b.dataset.id));
      assert.deepStrictEqual(after, ["real-1"], "sidebar should show only the server's conversation");
      await page.close();
    });

    console.log(failures === 0 ? "\nALL AUTH TESTS PASSED" : `\n${failures} AUTH TEST(S) FAILED`);
  } finally {
    await browser.close();
    server.kill();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
