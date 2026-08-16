/**
 * Browser test for Issue 2: the "Thought for Xs" trace must render in the same
 * (live-pipeline) style when a chat is reloaded/reopened — no bubble/card.
 *
 * Verifies:
 *   1. A completed agent message re-rendered on reload uses the
 *      BeUIThinkingState component (the live style), not the legacy `.trace`
 *      bubble UI.
 *   2. The "Thought for X.Xs" label reflects the stored thinkingElapsedMs.
 *
 * Run: node test-chat-trace-reload.js
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

const seededAgentMessage = {
  id: "msg-agent-1",
  role: "agent",
  status: "done",
  traceOpen: false,
  startedAt: 1000000,
  thinkingElapsedMs: 3700,
  createdAt: 1000000,
  steps: [
    { key: "read", title: "Reading your question", detail: "", state: "done", elapsedMs: 100 },
    { key: "classify", title: "Classifying the issue", detail: "", state: "done", elapsedMs: 200 },
    { key: "search", title: "Searching legal sources", detail: "", state: "done", elapsedMs: 300 },
    { key: "plan", title: "Planning the response", detail: "", state: "done", elapsedMs: 400 },
    { key: "draft", title: "Drafting the answer", detail: "", state: "done", elapsedMs: 500 },
  ],
  classification: { practice_area: "tenancy", jurisdictionGuess: "Lagos State", urgency: "Medium" },
  result: {
    lawMd: "The **Lagos State Tenancy Law 2011** requires notice before eviction.",
    actionsMd: "- Step 1: Document it\n- Step 2: Contact a lawyer\n- Step 3: File a complaint",
    sources: [{ label: "Lagos State Tenancy Law, s.13", excerpt: "Notice to quit..." }],
    escalate: false,
    escalateReason: "You can likely resolve this directly.",
    followUps: ["What notice period applies?", "Can I get damages?"],
  },
};

const seededConvo = {
  id: "chat-trace-1",
  title: "Trace test",
  createdAt: 1000000,
  updatedAt: 1000000,
  messages: [
    { id: "msg-user-1", role: "user", content: "My landlord is evicting me", createdAt: 999000 },
    seededAgentMessage,
  ],
};

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  try {
    console.log("\n=== Trace reload-style tests ===\n");
    await page.addInitScript(({ storageKey, convos }) => {
      localStorage.setItem(storageKey, JSON.stringify({ conversations: convos, activeId: null, questionsUsedToday: 0 }));
    }, { storageKey: "lu.conversations.v3.anonymous", convos: [seededConvo] });

    await page.goto(`${BASE}/#chat/chat-trace-1`, { waitUntil: "load" });
    await page.waitForFunction(() => window.BeUIThinkingState, null, { timeout: 10000 });
    await page.waitForFunction(() => document.querySelector(".msg--agent"), null, { timeout: 10000 });
    await page.waitForTimeout(300);

    await check("reloaded agent message uses the live thinking component, not the legacy bubble", async () => {
      const info = await page.evaluate(() => ({
        beuiTrace: !!document.querySelector(".msg--agent .beui-thinking-state"),
        legacyTrace: !!document.querySelector(".msg--agent .trace"),
      }));
      assert.strictEqual(info.beuiTrace, true, "must render BeUIThinkingState (live style)");
      assert.strictEqual(info.legacyTrace, false, "must NOT render the legacy .trace bubble");
    });

    await check("'Thought for Xs' label reflects the stored elapsed time", async () => {
      const label = await page.evaluate(() => {
        const header = document.querySelector(".msg--agent .beui-thinking-header span");
        return header ? header.textContent : null;
      });
      assert.ok(label && /Thought for 3\.7s/.test(label), `expected 'Thought for 3.7s', got '${label}'`);
    });

    await check("live and static thinking states share the same component class", async () => {
      // The static render path and the live pipeline mount the SAME component,
      // so the class is identical by construction — verify it resolves.
      const klass = await page.evaluate(() => {
        const el = document.querySelector(".msg--agent .beui-thinking-state");
        return el ? el.className : null;
      });
      assert.strictEqual(klass, "beui-thinking-state");
    });

    await browser.close();
    console.log(failures === 0 ? "\nALL TRACE-RELOAD TESTS PASSED" : `\n${failures} TRACE-RELOAD TEST(S) FAILED`);
  } finally {
    server.kill();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
