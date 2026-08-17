/**
 * Client-side tests for confidence labeling:
 *   1. A stored message whose own text hedges about citation fit must render
 *      "Limited evidence" (never "High confidence"), even if its stored
 *      evidence.sufficient was true (legacy/pre-downgrade data).
 *   2. A noSourcing (practical/procedural) answer renders "Practical guidance"
 *      and "Handle yourself".
 *
 * Run: node test-chat-procedural-client.js
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

function agentMsg(id, result) {
  return {
    id, role: "agent", status: "done", createdAt: 1000, thinkingElapsedMs: 1000,
    steps: [{ key: "read", title: "Reading", detail: "", state: "done", elapsedMs: 10 }],
    result,
  };
}

function verdictState(page) {
  return page.evaluate(() => {
    const card = document.querySelector(".beui-recommendation-card");
    if (!card) return null;
    return card.textContent;
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

  try {
    console.log("\n=== Client procedural/hedging label tests ===\n");

    // ── 1. Hedging message (legacy: evidence.sufficient still true) ───────
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const hedged = agentMsg("m1", {
        lawMd: "The provided statute excerpts do not directly address how to note down key facts. The Harmful Waste Act discusses parties to a crime, which might be relevant when describing roles.",
        actionsMd: "- Step 1: Document it\n- Step 2: Report it",
        sources: [
          { label: "Prevention of Crimes Act, s.2", excerpt: "..." },
          { label: "Harmful Waste (Special Criminal Provisions) Act, s.2", excerpt: "..." },
        ],
        escalate: false,
        escalateReason: "",
        followUps: [],
        // LEGACY: evidence says sufficient, but the text hedges.
        evidence: { sufficient: true, sourceCount: 2, minSources: 2, reason: "directly on point" },
      });
      await page.addInitScript(({ key, convo }) => {
        localStorage.setItem(key, JSON.stringify({ conversations: [convo], activeId: null }));
      }, {
        key: "lu.conversations.v3.anonymous",
        convo: { id: "c1", title: "Witness", createdAt: 1000, updatedAt: 1000, messages: [{ id: "u1", role: "user", content: "I witnessed a crime", createdAt: 900 }, hedged] },
      });
      await page.goto(`${BASE}/#chat/c1`, { waitUntil: "load" });
      await page.waitForFunction(() => document.querySelector(".beui-recommendation-card"), null, { timeout: 10000 });
      await page.waitForTimeout(300);

      await check("hedging message shows 'Limited evidence' (never 'High confidence')", async () => {
        const text = await verdictState(page);
        assert.ok(text.includes("Limited evidence"), `expected 'Limited evidence', got: ${text}`);
        assert.ok(!text.includes("High confidence"), "must never say High confidence for a hedging response");
      });
      await page.close();
    }

    // ── 2. noSourcing (practical) message ─────────────────────────────────
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const practical = agentMsg("m1", {
        lawMd: "Write things down while they're fresh: who, what, when, where. Keep it factual.",
        actionsMd: "- Step 1: Note the key facts\n- Step 2: Keep it factual",
        sources: [],
        escalate: false,
        escalateReason: "A practical task you can handle yourself.",
        followUps: [],
        evidence: { sufficient: true, sourceCount: 0, minSources: 0, noSourcing: true, reason: "no statute required" },
      });
      await page.addInitScript(({ key, convo }) => {
        localStorage.setItem(key, JSON.stringify({ conversations: [convo], activeId: null }));
      }, {
        key: "lu.conversations.v3.anonymous",
        convo: { id: "c2", title: "Notes", createdAt: 1000, updatedAt: 1000, messages: [{ id: "u1", role: "user", content: "How do I note down key facts", createdAt: 900 }, practical] },
      });
      await page.goto(`${BASE}/#chat/c2`, { waitUntil: "load" });
      await page.waitForFunction(() => document.querySelector(".beui-recommendation-card"), null, { timeout: 10000 });
      await page.waitForTimeout(300);

      await check("noSourcing message shows 'Practical guidance' + self-handle body", async () => {
        const text = await verdictState(page);
        assert.ok(text.includes("Practical guidance"), `expected 'Practical guidance', got: ${text}`);
        assert.ok(text.includes("handle this yourself"), "practical answer should not force a lawyer recommendation");
        assert.ok(!text.includes("High confidence"), "no-sourcing answers must not claim High confidence");
      });
      await page.close();
    }

    await browser.close();
    console.log(failures === 0 ? "\nALL CLIENT LABEL TESTS PASSED" : `\n${failures} CLIENT LABEL TEST(S) FAILED`);
  } finally {
    server.kill();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
