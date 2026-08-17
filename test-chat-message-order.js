/**
 * Client test for Bug 2: messages must render in conversational order
 * (question above answer), even if the data arrives out of order.
 *
 * Seeds a conversation whose messages array is REVERSED (agent answer first,
 * user question second) and asserts the DOM renders the user bubble above the
 * agent answer — sorted by createdAt, not array position.
 *
 * Run: node test-chat-message-order.js
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

function agentMsg() {
  return {
    id: "am1", role: "agent", status: "done", createdAt: 2000, thinkingElapsedMs: 4200, unread: false,
    steps: [{ key: "read", title: "Reading", detail: "", state: "done", elapsedMs: 100 }],
    result: { lawMd: "Under the law, you can report this to the police.", actionsMd: "- Step 1: Report it", sources: [], escalate: false, escalateReason: "", followUps: [] },
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  try {
    console.log("\n=== Message-order tests ===\n");

    // REVERSED array: agent (createdAt 2000) BEFORE user (createdAt 1000).
    const userMsg = { id: "um1", role: "user", content: "Someone killed my mom", createdAt: 1000 };
    const convo = {
      id: "c1", title: "Crime", createdAt: 1000, updatedAt: 2000,
      messages: [agentMsg(), userMsg],
    };
    await page.addInitScript(({ key, convo }) => {
      localStorage.setItem(key, JSON.stringify({ conversations: [convo], activeId: null }));
    }, { key: "lu.conversations.v3.anonymous", convo });

    await page.goto(`${BASE}/#chat/c1`, { waitUntil: "load" });
    await page.waitForFunction(() => document.querySelectorAll(".msg").length >= 2, null, { timeout: 10000 });

    await check("question renders ABOVE the answer regardless of array order", async () => {
      const order = await page.evaluate(() => {
        const msgs = [...document.querySelectorAll(".msg")];
        return msgs.map((m) => ({
          isUser: m.classList.contains("msg--user"),
          text: m.textContent.slice(0, 60),
        }));
      });
      assert.strictEqual(order.length, 2, "both messages must render");
      assert.strictEqual(order[0].isUser, true, "the USER question must render first");
      assert.ok(order[0].text.includes("Someone killed my mom"), "user content present");
      assert.strictEqual(order[1].isUser, false, "the agent answer must render second");
    });

    await check("the trace shows the persisted thinking duration (not 0.0s)", async () => {
      const label = await page.evaluate(() => {
        const span = document.querySelector(".beui-thinking-header span");
        return span ? span.textContent : null;
      });
      assert.ok(label && /Thought for 4\.2s/.test(label), `expected 'Thought for 4.2s', got '${label}'`);
    });

    await browser.close();
    console.log(failures === 0 ? "\nALL MESSAGE-ORDER TESTS PASSED" : `\n${failures} MESSAGE-ORDER TEST(S) FAILED`);
  } finally {
    server.kill();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
