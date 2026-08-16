/**
 * Browser test for the "Thought for Xs" freeze fix.
 *
 * The timer must stop when thinking ends (trace collapse), NOT keep counting
 * through the response-streaming phase. Verifies that the STORED
 * thinkingElapsedMs is frozen at the collapse moment and does not grow while
 * the answer streams out — so live display and reload both show the same,
 * correct thinking-only duration.
 *
 * Run: node test-chat-timer-freeze.js
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

// ~55 words so the BeUI streaming phase takes ~5s at 100ms/word — long enough
// that counting streaming time would be clearly visible in the assertion.
const LAW_MD =
  "Under the Lagos State Tenancy Law, a landlord must serve the statutory notice to quit before recovering possession of the premises, and self help eviction is prohibited. " +
  "The tenant is entitled to peaceful and quiet enjoyment of the premises during the tenancy, and any forcible entry or locking out without a court order is unlawful. " +
  "Where a landlord unlawfully evicts a tenant, the tenant may apply to the court for an order of possession and damages for trespass and disturbance of possession.";
const ACTIONS_MD =
  "- Step 1: Document everything including the date and time of the eviction.\n" +
  "- Step 2: Report the matter to the nearest police station.\n" +
  "- Step 3: Engage a lawyer to file an application before the court.";

const LEGAL_RESPONSE = {
  is_legal_question: true,
  classification: {
    practice_area: "tenancy",
    jurisdiction: "Federal",
    urgency: "Medium",
    route: "simple",
  },
  route: "simple",
  plan: null,
  result: {
    lawMd: LAW_MD,
    actionsMd: ACTIONS_MD,
    sources: [{ label: "Lagos State Tenancy Law, s.13", excerpt: "Notice to quit shall be..." }],
    escalate: false,
    escalateReason: "You can likely resolve this with the court directly.",
    followUps: ["What notice period applies?", "Can I get damages?"],
  },
  critique: null,
  evidence: { sufficient: true, sourceCount: 2, minSources: 2 },
  providersBusy: false,
  retryAfter: null,
};

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); }
  catch (err) { failures += 1; console.log(`  FAIL  ${name}\n        ${err.message}`); }
}

function readStoredThinkingElapsedMs(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem("lu.conversations.v3.anonymous");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const convo = (parsed.conversations || [])[0];
    if (!convo) return null;
    const agent = [...convo.messages].reverse().find((m) => m.role === "agent" && m.steps);
    return agent ? agent.thinkingElapsedMs : null;
  });
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  try {
    console.log("\n=== Timer freeze tests ===\n");

    // Mock the chat API so the pipeline runs offline.
    await page.route("**/api/chat", (route) => {
      if (route.request().method() !== "POST") return route.continue();
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(LEGAL_RESPONSE) });
    });

    await page.goto(BASE, { waitUntil: "load" });
    await page.evaluate(() => localStorage.removeItem("lu.conversations.v3.anonymous"));
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => window.promptBar && window.promptBar.inputElement, null, { timeout: 10000 });

    const wallStart = Date.now();

    await page.evaluate(() => {
      window.promptBar.inputElement.value = "My landlord evicted me without notice";
      window.promptBar.submit();
    });

    // Wait for the trace to collapse → answer block appears (thinking complete).
    await page.waitForFunction(() => document.querySelector(".answer-block-plain"), null, { timeout: 15000 });
    const tCollapse = await readStoredThinkingElapsedMs(page);
    const wallAtCollapse = Date.now();

    // Wait for the full streaming sequence to finish: the verdict card is
    // hidden (display:none) until law + actions finish streaming, then it is
    // revealed. offsetParent becomes non-null only when it's actually visible.
    await page.waitForFunction(
      () => {
        const card = document.querySelector(".beui-recommendation-card");
        return !!(card && card.offsetParent !== null);
      },
      null,
      { timeout: 30000 }
    );
    await page.waitForTimeout(1200); // cover the staggered reveal + finalizeAnswer's saveState
    const tFinal = await readStoredThinkingElapsedMs(page);
    const wallEnd = Date.now();

    await check("thinkingElapsedMs is frozen at collapse time (does not grow during streaming)", () => {
      assert.ok(tCollapse != null, "collapse-time value must be readable");
      assert.ok(tFinal != null, "final value must be readable");
      assert.ok(
        Math.abs(tFinal - tCollapse) <= 100,
        `stored value must not change during streaming (collapse=${tCollapse}ms, final=${tFinal}ms)`
      );
    });

    await check("thinkingElapsedMs excludes the streaming duration", () => {
      const totalWallMs = wallEnd - wallStart;
      assert.ok(
        tFinal < totalWallMs - 1500,
        `thinking time (${tFinal}ms) must be clearly less than total wall time (${totalWallMs}ms) — streaming must not be counted`
      );
    });

    await check("streaming actually took a measurable amount of time", () => {
      const streamMs = wallEnd - wallAtCollapse;
      assert.ok(streamMs >= 2000, `streaming should take >= 2s for this test to be meaningful (took ${streamMs}ms)`);
    });

    await browser.close();
    console.log(failures === 0 ? "\nALL TIMER-FREEZE TESTS PASSED" : `\n${failures} TIMER-FREEZE TEST(S) FAILED`);
  } finally {
    server.kill();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
