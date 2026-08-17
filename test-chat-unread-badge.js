/**
 * Browser tests for the "check back later" unread badge.
 *
 * Verifies:
 *   1. A conversation with a finished-but-unread agent answer shows an unread
 *      dot in the sidebar.
 *   2. Opening that conversation clears the dot (and persists unread:false).
 *   3. A conversation whose answers are all read shows NO dot.
 *
 * Run: node test-chat-unread-badge.js
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

function agentMsg(id, unread, title) {
  return {
    id, role: "agent", status: "done", createdAt: 1000, thinkingElapsedMs: 1000, unread,
    steps: [{ key: "read", title: "Reading", detail: "", state: "done", elapsedMs: 10 }],
    result: { lawMd: `The law says ${title}.`, actionsMd: "- Step 1: x\n- Step 2: y", sources: [], escalate: false, escalateReason: "", followUps: [] },
  };
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
    console.log("\n=== Unread-badge tests ===\n");

    const convos = [
      {
        id: "unread-chat", title: "Unread chat", createdAt: 1000, updatedAt: 1000,
        messages: [
          { id: "u1", role: "user", content: "I witnessed a crime", createdAt: 900 },
          agentMsg("a1", true, "report it"),
        ],
      },
      {
        id: "read-chat", title: "Read chat", createdAt: 2000, updatedAt: 2000,
        messages: [
          { id: "u2", role: "user", content: "Hi", createdAt: 1900 },
          agentMsg("a2", false, "greet you"),
        ],
      },
    ];

    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.addInitScript(({ key, convos }) => {
      localStorage.setItem(key, JSON.stringify({ conversations: convos, activeId: null }));
    }, { key: "lu.conversations.v3.anonymous", convos });
    await page.goto(`${BASE}`, { waitUntil: "load" });
    await page.waitForFunction(() => document.querySelectorAll(".history__item").length === 2, null, { timeout: 10000 });

    await check("unread conversation shows a badge dot; read one does not", async () => {
      const state = await page.evaluate(() => {
        const rows = [...document.querySelectorAll(".history__row")];
        const byId = {};
        rows.forEach((r) => {
          const id = r.querySelector(".history__item").dataset.id;
          byId[id] = !!r.querySelector(".history__unread-dot");
        });
        return byId;
      });
      assert.strictEqual(state["unread-chat"], true, "unread chat must show a dot");
      assert.strictEqual(state["read-chat"], false, "read chat must NOT show a dot");
    });

    await check("opening the unread chat clears the badge", async () => {
      await page.click('.history__item[data-id="unread-chat"]');
      await page.waitForTimeout(300);
      const state = await page.evaluate(() => ({
        dotStillThere: !!document.querySelector('.history__row .history__unread-dot'),
        stored: JSON.parse(localStorage.getItem("lu.conversations.v3.anonymous")),
      }));
      assert.strictEqual(state.dotStillThere, false, "badge must clear after opening");
      const unreadChat = state.stored.conversations.find((c) => c.id === "unread-chat");
      const agent = unreadChat.messages.find((m) => m.id === "a1");
      assert.strictEqual(agent.unread, false, "stored unread flag must be cleared");
    });

    await browser.close();
    console.log(failures === 0 ? "\nALL UNREAD-BADGE TESTS PASSED" : `\n${failures} UNREAD-BADGE TEST(S) FAILED`);
  } finally {
    server.kill();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
