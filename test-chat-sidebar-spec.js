/**
 * Browser test for the Recents sidebar visual spec.
 *
 * Verifies the structure and interaction pattern without touching the
 * conversation architecture:
 *   1. A stable "Recents" heading sits above the scrollable list.
 *   2. Rows are flat (no card border/shadow), full-width.
 *   3. The active row gets a full-width highlight (edge-to-edge, not a pill).
 *   4. The kebab menu is anchored at the far right of every row at the same
 *      horizontal position, and clicking it does NOT navigate.
 *   5. Long titles truncate with an ellipsis.
 *   6. Sidebar rows use the conversation's existing persisted ID (no new ID).
 *
 * Run: node test-chat-sidebar-spec.js
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

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); }
  catch (err) { failures += 1; console.log(`  FAIL  ${name}\n        ${err.message}`); }
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({ args: ["--no-sandbox"] });

  // Conversations with stable, known IDs and titles (seeded into anonymous storage).
  const seeded = [
    { id: "chat-a", title: "Can my landlord increase my rent?", createdAt: 3000, updatedAt: 3000, messages: [] },
    { id: "chat-b", title: "What are my rights after an arrest?", createdAt: 2000, updatedAt: 2000, messages: [] },
    { id: "chat-c", title: "This is an extremely long conversation title that should definitely be truncated with an ellipsis at some point", createdAt: 1000, updatedAt: 1000, messages: [] },
  ];

  try {
    console.log("\n=== Recents sidebar visual spec tests ===\n");

    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.addInitScript(({ storageKey, convos }) => {
      localStorage.setItem(storageKey, JSON.stringify({ conversations: convos, activeId: null, questionsUsedToday: 0 }));
    }, { storageKey: "lu.conversations.v3.anonymous", convos: seeded });

    // Open chat-b directly so it is the active conversation.
    await page.goto(`${BASE}/#chat/chat-b`, { waitUntil: "load" });
    await page.waitForFunction(() => document.querySelectorAll(".history__row").length === 3, null, { timeout: 10000 });
    await page.waitForTimeout(300);

    await check("'Recents' heading exists outside the scrollable list", async () => {
      const info = await page.evaluate(() => {
        const heading = document.querySelector(".history__heading");
        const list = document.getElementById("history-list");
        return {
          text: heading ? heading.textContent.trim() : null,
          insideList: heading ? list.contains(heading) : null,
          listScrollable: list ? getComputedStyle(list).overflowY : null,
        };
      });
      assert.strictEqual(info.text, "Recents", "heading text must be 'Recents'");
      assert.strictEqual(info.insideList, false, "heading must sit outside the scrollable list (stable)");
      assert.ok(["auto", "scroll"].includes(info.listScrollable), "list must be the scroll container");
    });

    await check("rows are flat: no card border, transparent background", async () => {
      const info = await page.evaluate(() => {
        const item = document.querySelector(".history__row:not(.is-active) .history__item");
        const s = getComputedStyle(item);
        return { borderWidth: s.borderTopWidth, background: s.backgroundColor, shadow: s.boxShadow };
      });
      assert.strictEqual(info.borderWidth, "0px", "title button must have no border");
      assert.strictEqual(info.background, "rgba(0, 0, 0, 0)", "normal row title must be transparent");
      assert.strictEqual(info.shadow, "none", "rows must have no shadow");
    });

    await check("active row highlight is full-width (edge to edge, not a pill)", async () => {
      const info = await page.evaluate(() => {
        const row = document.querySelector(".history__row.is-active");
        const list = document.getElementById("history-list");
        const rowRect = row.getBoundingClientRect();
        const listRect = list.getBoundingClientRect();
        const rowStyle = getComputedStyle(row);
        return {
          activeIsRow: row.classList.contains("is-active"),
          background: rowStyle.backgroundColor,
          rowWidth: rowRect.width,
          listWidth: listRect.width,
          rowLeft: rowRect.left,
          listLeft: listRect.left,
        };
      });
      assert.strictEqual(info.activeIsRow, true, "active state must be on the row");
      assert.notStrictEqual(info.background, "rgba(0, 0, 0, 0)", "active row must have a highlight");
      // Full-width: the highlight should span essentially the whole list width
      // (allow a tiny tolerance for sub-pixel rounding).
      assert.ok(
        Math.abs(info.rowWidth - info.listWidth) <= 1,
        `active highlight must span the list width (row ${info.rowWidth}px vs list ${info.listWidth}px)`
      );
      assert.ok(
        Math.abs(info.rowLeft - info.listLeft) <= 1,
        "active highlight must touch the list's left edge"
      );
    });

    await check("kebab menu is anchored at the same far-right position on every row", async () => {
      const rights = await page.evaluate(() => {
        return [...document.querySelectorAll(".history__kebab")].map((k) => {
          const s = getComputedStyle(k);
          return { right: k.getBoundingClientRect().right, shrink: s.flexShrink, width: k.getBoundingClientRect().width };
        });
      });
      assert.ok(rights.length === 3, "three rows should each have a kebab");
      const first = rights[0].right;
      rights.forEach((r, i) => {
        assert.ok(Math.abs(r.right - first) <= 1, `kebab #${i} is not at the same right edge`);
        assert.strictEqual(r.shrink, "0", `kebab #${i} must be fixed (flex-shrink 0)`);
      });
    });

    await check("long titles truncate with an ellipsis", async () => {
      const info = await page.evaluate(() => {
        const title = [...document.querySelectorAll(".history__item-title")]
          .find((t) => t.textContent.startsWith("This is an extremely long"));
        const s = getComputedStyle(title);
        return {
          overflow: s.textOverflow,
          nowrap: s.whiteSpace,
          scrollWiderThanClient: title.scrollWidth > title.clientWidth,
        };
      });
      assert.strictEqual(info.overflow, "ellipsis", "title must use text-overflow: ellipsis");
      assert.strictEqual(info.nowrap, "nowrap", "title must not wrap");
      assert.strictEqual(info.scrollWiderThanClient, true, "long title must actually be clipped");
    });

    await check("kebab click opens actions without navigating", async () => {
      const before = await page.evaluate(() => window.location.hash);
      await page.click(".history__row.is-active .history__kebab");
      await page.waitForTimeout(200);
      const after = await page.evaluate(() => ({
        hash: window.location.hash,
        popoverOpen: !!document.querySelector(".menu-popover"),
        items: [...document.querySelectorAll(".menu-popover__item")].map((b) => b.textContent.trim()),
      }));
      assert.strictEqual(after.hash, before, "clicking the kebab must not change the URL");
      assert.strictEqual(after.popoverOpen, true, "kebab must open the action menu");
      assert.ok(after.items.some((t) => t.includes("Delete chat")), "menu must include Delete chat");
    });

    await check("title click opens the chat using its existing ID (no new ID)", async () => {
      await page.evaluate(() => document.querySelector(".menu-popover")?.remove()); // close any open popover
      await page.click('.history__item[data-id="chat-a"]');
      await page.waitForTimeout(300);
      const info = await page.evaluate(() => ({
        hash: window.location.hash,
        active: document.querySelector(".history__row.is-active .history__item")?.dataset.id || null,
        storedIds: JSON.parse(localStorage.getItem("lu.conversations.v3.anonymous")).conversations.map((c) => c.id),
      }));
      assert.strictEqual(info.hash, "#chat/chat-a", "must navigate to the existing conversation's ID");
      assert.strictEqual(info.active, "chat-a", "the clicked chat must become active");
      assert.deepStrictEqual(info.storedIds.sort(), ["chat-a", "chat-b", "chat-c"], "no new conversation IDs may be created");
    });

    await browser.close();

    console.log(failures === 0 ? "\nALL SIDEBAR SPEC TESTS PASSED" : `\n${failures} SIDEBAR TEST(S) FAILED`);
  } finally {
    server.kill();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
