/**
 * Tests the "providers busy → auto-retry" path.
 *
 * Regression: the auto-retry used to call `lastUserText(agentMsg)` with a
 * MESSAGE object (which has no `.messages` array), throwing
 * `TypeError: Cannot read properties of undefined (reading 'filter')` and
 * silently killing the retry. This test verifies:
 *
 *   A. The retry does NOT crash (no pageerror) — the TypeError is gone.
 *   B. The retry re-runs the SAME question and the answer appears.
 *   C. The retry does NOT duplicate the user's message.
 *   D. A pending auto-retry does not fire after the user has moved on
 *      (manual resend) — no duplicate / no spurious third API call.
 *
 * Run: node test-chat-providers-busy-retry.js
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

const BUSY_RESPONSE = {
  classification: { practice_area: "tenancy", jurisdiction: "Federal", urgency: "Medium", route: "complex" },
  route: "complex",
  result: {
    lawMd: "All legal reasoning providers are currently busy. Please wait a moment and try again.",
    actionsMd: "- Step 1: Wait a moment and resend your question.\n- Step 2: If the issue persists, try rephrasing your question.",
    sources: [],
    escalate: false,
    escalateReason: "System under load — retry needed.",
    followUps: [],
  },
  critique: null,
  evidence: null,
  providersBusy: true,
  retryAfter: 1, // 1s cooldown so the test doesn't wait 30s
};

const DONE_RESPONSE = {
  classification: { practice_area: "tenancy", jurisdiction: "Federal", urgency: "Medium", route: "complex" },
  route: "complex",
  result: {
    lawMd: "A landlord must follow due process and cannot use self-help to recover possession.",
    actionsMd: "- Step 1: Document what happened.\n- Step 2: Report to the police.\n- Step 3: Consult a lawyer.",
    sources: [{ label: "Recovery of Premises Act, s.6", excerpt: "…" }],
    escalate: false,
    escalateReason: "You can likely handle this.",
    followUps: [],
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

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    // ── Scenario 1: busy → auto-retry succeeds ──────────────────────────────
    await check("auto-retry re-runs the question without crashing or duplicating", async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const pageErrors = [];
      page.on("pageerror", (e) => pageErrors.push(e.message));

      let calls = 0;
      await page.route("**/api/chat", async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        calls += 1;
        const body = calls === 1 ? BUSY_RESPONSE : DONE_RESPONSE;
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      });

      await page.goto(BASE, { waitUntil: "load" });
      await page.evaluate(() => localStorage.removeItem("lu.conversations.v3.anonymous"));
      await page.reload({ waitUntil: "load" });
      await page.waitForFunction(() => window.promptBar && window.promptBar.inputElement, null, { timeout: 10000 });
      await page.waitForFunction(() => document.querySelector(".auth-signin-btn[disabled]"), null, { timeout: 8000 });

      await page.evaluate(() => {
        window.promptBar.inputElement.value = "My landlord wants to evict me";
        window.promptBar.submit();
      });

      // The busy banner renders immediately.
      await page.waitForSelector(".providers-busy", { timeout: 10000 });

      // After the ~1s cooldown the retry re-runs and the answer appears.
      await page.waitForSelector(".answer-text-block", { timeout: 15000 });

      // The retry must not throw (the old TypeError surfaces as a pageerror).
      assert.deepStrictEqual(pageErrors, [], "page errors: " + pageErrors.join(" | "));

      // Exactly two API calls: the busy response + the successful retry.
      assert.strictEqual(calls, 2, `expected 2 /api/chat calls, got ${calls}`);

      // The user's question must not be duplicated by the retry.
      const userCount = await page.evaluate(() => document.querySelectorAll(".msg--user").length);
      assert.strictEqual(userCount, 1, `expected 1 user message, got ${userCount}`);

      await page.close();
    });

    // ── Scenario 2: pending retry is abandoned once the user moves on ───────
    await check("a manual resend does not trigger a stale auto-retry duplicate", async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const pageErrors = [];
      page.on("pageerror", (e) => pageErrors.push(e.message));

      let calls = 0;
      await page.route("**/api/chat", async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        calls += 1;
        // First call is busy (5s cooldown), everything after succeeds.
        const body = calls === 1 ? { ...BUSY_RESPONSE, retryAfter: 5 } : DONE_RESPONSE;
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      });

      await page.goto(BASE, { waitUntil: "load" });
      await page.evaluate(() => localStorage.removeItem("lu.conversations.v3.anonymous"));
      await page.reload({ waitUntil: "load" });
      await page.waitForFunction(() => window.promptBar && window.promptBar.inputElement, null, { timeout: 10000 });
      await page.waitForFunction(() => document.querySelector(".auth-signin-btn[disabled]"), null, { timeout: 8000 });

      await page.evaluate(() => {
        window.promptBar.inputElement.value = "My landlord wants to evict me";
        window.promptBar.submit();
      });
      await page.waitForSelector(".providers-busy", { timeout: 10000 });

      // User manually asks again before the 5s cooldown elapses.
      await page.evaluate(() => {
        window.promptBar.inputElement.value = "Actually, can he change my locks?";
        window.promptBar.submit();
      });
      await page.waitForSelector(".answer-text-block", { timeout: 15000 });

      // Wait past the original 5s cooldown: the stale timer must not add a
      // third call or a duplicate message.
      await page.waitForTimeout(6500);

      assert.deepStrictEqual(pageErrors, [], "page errors: " + pageErrors.join(" | "));
      assert.strictEqual(calls, 2, `expected 2 /api/chat calls (busy + resend), got ${calls}`);
      const userCount = await page.evaluate(() => document.querySelectorAll(".msg--user").length);
      assert.strictEqual(userCount, 2, `expected 2 user messages (original + resend), got ${userCount}`);

      await page.close();
    });

    await browser.close();
    console.log(failures === 0 ? "\nALL PROVIDERS-BUSY-RETRY TESTS PASSED" : `\n${failures} PROVIDERS-BUSY-RETRY TEST(S) FAILED`);
  } finally {
    server.kill();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
