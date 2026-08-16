/**
 * Test: widened conversation context window.
 *
 * Drives a real conversation: an early HITL clarifying exchange, then several
 * follow-ups (10+ messages total). Captures the ACTUAL /api/chat request
 * bodies the client sends and verifies:
 *   1. The history window carries >= 10 messages (not 6).
 *   2. An early clarifying answer ("Lagos State") is still present in the
 *      history of a LATER request.
 *   3. Agent legal replies carry non-empty content (lawMd), not "".
 *   4. The agent's own HITL clarifying question text is present.
 *
 * Run: node test-chat-context-window.js
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

const LAW = "Under the Lagos State Tenancy Law, a landlord must serve notice to quit before recovering possession, and self help eviction is prohibited.";
const ACTIONS = "- Step 1: Document it\n- Step 2: Report to the police\n- Step 3: Consult a lawyer";

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
    console.log("\n=== Context-window tests ===\n");

    const requestBodies = [];
    let chatCalls = 0;
    await page.route("**/api/chat", (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const body = route.request().postDataJSON();
      requestBodies.push(body);
      chatCalls += 1;
      if (chatCalls === 1) {
        // First question → HITL clarifying question (jurisdiction unclear).
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          needsInput: true,
          question: "Which state did this happen in? The laws can differ by state.",
          field: "jurisdiction",
          context: { practice_area: "tenancy", urgency: "Medium" },
        }) });
      } else {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          classification: { practice_area: "tenancy", jurisdiction: "Lagos State", urgency: "Medium", route: "simple" },
          route: "simple",
          result: { lawMd: LAW, actionsMd: ACTIONS, sources: [{ label: "Lagos State Tenancy Law, s.13", excerpt: "..." }], escalate: false, escalateReason: "resolvable", followUps: ["What notice period?"] },
          critique: null,
          evidence: { sufficient: true, sourceCount: 1, minSources: 2, reason: "ok" },
          providersBusy: false,
          retryAfter: null,
        }) });
      }
    });

    await page.goto(BASE, { waitUntil: "load" });
    await page.evaluate(() => localStorage.removeItem("lu.conversations.v3.anonymous"));
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => window.promptBar && window.promptBar.inputElement, null, { timeout: 10000 });
    await page.waitForFunction(() => document.querySelector(".auth-signin-btn[disabled]"), null, { timeout: 8000 });

    // 1. Ask the first question → HITL clarifying card.
    await page.evaluate(() => { window.promptBar.inputElement.value = "My landlord evicted me"; window.promptBar.submit(); });
    await page.waitForFunction(() => document.querySelector(".needs-input"), null, { timeout: 15000 });

    // 2. Answer the clarifying question (early in the conversation).
    await page.fill(".needs-input input", "Lagos State");
    await page.click(".needs-input button");
    await page.waitForFunction(
      () => { const c = document.querySelector(".beui-recommendation-card"); return !!(c && c.offsetParent !== null); },
      null, { timeout: 30000 }
    );
    await page.waitForTimeout(700);

    // 3. Ask 4 more follow-ups to build 10+ messages. Wait for the pipeline to
    // actually finish (prompt bar leaves submitting state) before each one, so
    // a follow-up isn't dropped while busy.
    for (const q of ["How do I note down the key facts?", "What should I bring to the police station?", "How do I find a lawyer?", "What are my rights as a tenant?"]) {
      await page.waitForFunction(
        () => window.promptBar && window.promptBar.isSubmitting === false,
        null, { timeout: 30000 }
      );
      await page.evaluate((text) => { window.promptBar.inputElement.value = text; window.promptBar.submit(); }, q);
      await page.waitForFunction(
        () => { const c = document.querySelector(".beui-recommendation-card"); return !!(c && c.offsetParent !== null); },
        null, { timeout: 30000 }
      );
    }
    // Wait for the final pipeline to settle before reading the captured bodies.
    await page.waitForFunction(
      () => window.promptBar && window.promptBar.isSubmitting === false,
      null, { timeout: 30000 }
    );
    await page.waitForTimeout(500);

    await check("history window carries >= 10 messages (not 6)", () => {
      const last = requestBodies[requestBodies.length - 1];
      assert.ok(last, "must have captured at least one request body");
      assert.ok(Array.isArray(last.history), "history must be an array");
      assert.ok(last.history.length >= 10, `expected >= 10 history messages, got ${last.history.length}`);
    });

    await check("the early clarifying answer 'Lagos State' is still present in later history", () => {
      const last = requestBodies[requestBodies.length - 1];
      const contents = last.history.map((m) => m.content);
      assert.ok(contents.some((c) => String(c).includes("Lagos State")), "early clarifying answer must still be in the window");
    });

    await check("agent legal replies carry non-empty content (lawMd)", () => {
      const last = requestBodies[requestBodies.length - 1];
      const agentContents = last.history.filter((m) => m.role === "agent").map((m) => m.content);
      assert.ok(agentContents.length >= 2, "history must include multiple agent turns");
      assert.ok(agentContents.every((c) => String(c).length > 0), `agent turns must be non-empty, got: ${JSON.stringify(agentContents)}`);
      assert.ok(agentContents.some((c) => String(c).includes("Lagos State Tenancy Law")), "agent legal reply content must be carried");
    });

    await check("the agent's own clarifying question text is carried", () => {
      const allContents = requestBodies.flatMap((b) => b.history || []).map((m) => m.content);
      assert.ok(allContents.some((c) => String(c).includes("Which state did this happen")), "HITL clarifying question must be in the history");
    });

    await browser.close();
    console.log(failures === 0 ? "\nALL CONTEXT-WINDOW TESTS PASSED" : `\n${failures} CONTEXT-WINDOW TEST(S) FAILED`);
  } finally {
    server.kill();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
