/**
 * Browser test for the chat URL identity / lifecycle fix (anonymous mode).
 *
 * Verifies the client-side invariants:
 *   1. Base URL ("/") shows the landing state and does NOT auto-create a chat.
 *   2. "New chat" creates exactly one conversation and sets the URL to its ID.
 *   3. Refresh keeps the exact same URL / conversation ID.
 *   4. Sidebar navigation resolves to the original (unchanged) ID.
 *   5. A direct URL for an unknown ID shows "Chat not found" (and never
 *      creates a replacement chat).
 *   6. Deleting the current chat returns to home and leaves 0 conversations.
 *
 * Run: node test-chat-lifecycle-browser.js
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
      if (!done && d.toString().includes("listening on port")) {
        done = true;
        resolve(proc);
      }
    });
    proc.on("exit", (code) => {
      if (!done) { done = true; reject(new Error(`server exited early: ${code}`)); }
    });
    setTimeout(() => { if (!done) { done = true; reject(new Error("server start timeout")); } }, 10000);
  });
}

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL  ${name}\n        ${err.message}`);
  }
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  try {
    console.log("\n=== Chat lifecycle browser tests ===\n");

    // ── 1. Base URL: landing state, no auto-created chat ──────────────────
    await check("base URL shows landing state and creates no chat", async () => {
      await page.goto(BASE, { waitUntil: "load" });
      await page.waitForTimeout(800); // let init() settle
      const info = await page.evaluate(() => ({
        hash: window.location.hash,
        emptyShown: document.getElementById("empty-state").style.display,
        stored: JSON.parse(localStorage.getItem("lu.conversations.v3.anonymous") || "null"),
        historyItems: document.querySelectorAll(".history__item").length,
      }));
      assert.strictEqual(info.hash, "", "base URL must have no #chat hash");
      assert.strictEqual(info.emptyShown, "flex", "landing empty state should be visible");
      assert.strictEqual(info.historyItems, 0, "no sidebar entries should exist yet");
      const convos = info.stored ? info.stored.conversations : [];
      assert.strictEqual(convos.length, 0, "no conversation should be auto-created");
    });

    // ── 2. New chat → exactly one ID, URL set to it ───────────────────────
    let firstId = null;
    await check("New chat creates one conversation and sets URL to its ID", async () => {
      await page.click("#new-chat-btn");
      await page.waitForTimeout(300);
      const info = await page.evaluate(() => ({
        hash: window.location.hash,
        stored: JSON.parse(localStorage.getItem("lu.conversations.v3.anonymous") || "null"),
        historyItems: document.querySelectorAll(".history__item").length,
      }));
      assert.ok(info.hash.startsWith("#chat/"), `URL should be #chat/{id}, got "${info.hash}"`);
      firstId = info.hash.slice("#chat/".length);
      assert.ok(firstId && firstId.length > 0, "chat id must be non-empty");
      const convos = info.stored ? info.stored.conversations : [];
      assert.strictEqual(convos.length, 1, "exactly one conversation should exist");
      assert.strictEqual(convos[0].id, firstId, "persisted id must equal URL id");
      assert.strictEqual(info.historyItems, 1, "sidebar should show one entry");
    });

    // ── 3. Refresh keeps the same URL / ID ────────────────────────────────
    await check("refresh keeps the exact same URL and ID", async () => {
      await page.reload({ waitUntil: "load" });
      await page.waitForTimeout(800);
      const info = await page.evaluate(() => ({
        hash: window.location.hash,
        stored: JSON.parse(localStorage.getItem("lu.conversations.v3.anonymous") || "null"),
      }));
      assert.strictEqual(info.hash, `#chat/${firstId}`, "URL must survive refresh unchanged");
      const convos = info.stored ? info.stored.conversations : [];
      assert.strictEqual(convos.length, 1);
      assert.strictEqual(convos[0].id, firstId, "ID must survive refresh unchanged");
    });

    // ── 4. Sidebar navigation resolves to the original ID ─────────────────
    await check("sidebar navigation resolves to the original ID (no new ID)", async () => {
      // Create a second chat
      await page.click("#new-chat-btn");
      await page.waitForTimeout(300);
      const secondHash = await page.evaluate(() => window.location.hash);
      const secondId = secondHash.slice("#chat/".length);
      assert.notStrictEqual(secondId, firstId, "second chat should have a distinct ID");

      // Click the first chat in the sidebar (older entry)
      await page.click(`.history__item[data-id="${firstId}"]`);
      await page.waitForTimeout(300);
      const info = await page.evaluate(() => ({
        hash: window.location.hash,
        activeIdAttr: document.querySelector(".history__row.is-active .history__item")?.dataset.id || null,
      }));
      assert.strictEqual(info.hash, `#chat/${firstId}`, "returning to chat A must use its original ID");
      assert.strictEqual(info.activeIdAttr, firstId, "sidebar active item must be the original chat");

      // Verify no extra conversations were created
      const stored = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("lu.conversations.v3.anonymous") || "null"));
      assert.strictEqual(stored.conversations.length, 2, "still exactly 2 conversations");
      const ids = stored.conversations.map((c) => c.id);
      assert.deepStrictEqual(ids.sort(), [firstId, secondId].sort(), "IDs must remain stable");
    });

    // ── 4b. Main URL never opens a chat, even when chats exist ────────────
    await check("opening the main URL shows the welcome screen, never a chat", async () => {
      await page.goto(BASE, { waitUntil: "load" });
      await page.waitForTimeout(800);
      const info = await page.evaluate(() => ({
        hash: window.location.hash,
        emptyShown: document.getElementById("empty-state").style.display,
        activeRow: document.querySelector(".history__row.is-active"),
        stored: JSON.parse(localStorage.getItem("lu.conversations.v3.anonymous") || "null"),
      }));
      assert.strictEqual(info.hash, "", "main URL must have no #chat hash");
      assert.strictEqual(info.emptyShown, "flex", "welcome screen must be shown");
      assert.strictEqual(info.activeRow, null, "no chat may be active on the main URL");
      assert.strictEqual(info.stored.conversations.length, 2, "existing chats must be untouched (no auto-create/delete)");
    });

    // ── 5. Unknown direct URL → "Chat not found", no replacement ──────────
    await check("unknown direct URL shows 'Chat not found' (no replacement chat)", async () => {
      await page.goto(`${BASE}/#chat/does-not-exist-123`, { waitUntil: "load" });
      await page.waitForFunction(
        () => document.getElementById("chat-status") && !document.getElementById("chat-status").hidden && document.getElementById("chat-status-title").textContent === "Chat not found",
        null, { timeout: 8000 }
      );
      const info = await page.evaluate(() => ({
        hash: window.location.hash,
        stored: JSON.parse(localStorage.getItem("lu.conversations.v3.anonymous") || "null"),
      }));
      assert.strictEqual(info.hash, "#chat/does-not-exist-123", "URL must not be rewritten or silently cleared");
      const convos = info.stored ? info.stored.conversations : [];
      assert.strictEqual(convos.length, 2, "unknown URL must not create a new conversation");
      const hasFake = convos.some((c) => c.id === "does-not-exist-123");
      assert.strictEqual(hasFake, false, "must never fabricate a conversation for the missing ID");
    });

    // "Back to home" returns to the landing state
    await check("'Back to home' returns to landing state", async () => {
      await page.click("#chat-status-home");
      await page.waitForTimeout(300);
      const info = await page.evaluate(() => ({
        hash: window.location.hash,
        emptyShown: document.getElementById("empty-state").style.display,
      }));
      assert.strictEqual(info.hash, "", "URL should be cleared on go-home");
      assert.strictEqual(info.emptyShown, "flex", "landing empty state should be shown");
    });

    // ── 6. Deleting the current chat → home, 0 conversations, no replacement
    await check("deleting the current chat leaves 0 conversations (no replacement)", async () => {
      // Open the first chat via its original URL
      await page.goto(`${BASE}/#chat/${firstId}`, { waitUntil: "load" });
      await page.waitForTimeout(800);
      const before = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("lu.conversations.v3.anonymous") || "null").conversations.length);
      assert.strictEqual(before, 2, "expected 2 conversations before delete");

      // Open kebab for the ACTIVE chat's row and choose "Delete chat"
      await page.click(`.history__row.is-active .history__kebab`);
      await page.waitForTimeout(200);
      await page.click(".menu-popover__item--danger");
      await page.waitForTimeout(200);
      await page.click("#confirm-modal-confirm");
      await page.waitForTimeout(400);

      const info = await page.evaluate(() => ({
        hash: window.location.hash,
        stored: JSON.parse(localStorage.getItem("lu.conversations.v3.anonymous") || "null"),
        historyItems: document.querySelectorAll(".history__item").length,
      }));
      assert.strictEqual(info.hash, "", "URL must not point at the deleted chat");
      assert.strictEqual(info.stored.conversations.length, 1, "exactly 1 conversation should remain");
      assert.strictEqual(info.historyItems, 1, "sidebar should show 1 remaining entry");
      assert.ok(!info.stored.conversations.some((c) => c.id === firstId), "deleted chat must be gone");
    });

    // Delete the last remaining chat → 0 conversations is a valid state
    await check("deleting the last chat reaches a valid 0-conversation state", async () => {
      // Use a selector click (auto-waits + re-resolves) instead of holding
      // element handles, so a benign sidebar re-render can't stale the handle.
      const rows = await page.$$(".history__row .history__kebab");
      assert.strictEqual(rows.length, 1, "one chat should remain");
      await page.click(".history__row .history__kebab");
      await page.waitForTimeout(200);
      await page.click(".menu-popover__item--danger");
      await page.waitForTimeout(200);
      await page.click("#confirm-modal-confirm");
      await page.waitForTimeout(400);

      const info = await page.evaluate(() => ({
        hash: window.location.hash,
        stored: JSON.parse(localStorage.getItem("lu.conversations.v3.anonymous") || "null"),
        historyItems: document.querySelectorAll(".history__item").length,
        emptyShown: document.getElementById("empty-state").style.display,
      }));
      assert.strictEqual(info.stored.conversations.length, 0, "0 conversations is a valid state");
      assert.strictEqual(info.historyItems, 0, "sidebar must be empty");
      assert.strictEqual(info.hash, "", "URL must be cleared");
      assert.strictEqual(info.emptyShown, "flex", "landing state should be shown");
    });

    console.log(failures === 0 ? "\nALL BROWSER TESTS PASSED" : `\n${failures} BROWSER TEST(S) FAILED`);
  } finally {
    await browser.close();
    server.kill();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
