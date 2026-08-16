/**
 * Regression test: "Thought for Xs" must stop counting when thinking ends.
 *
 * Covers the exact reported regression (the live label kept ticking forever
 * after the response fully finished) AND the three required response lengths:
 *   A. short casual reply (no trace at all)
 *   B. medium legal answer
 *   C. long multi-source legal answer (slow streaming)
 *
 * Verifies:
 *   1. The live "Thought for Xs" label does NOT keep incrementing after the
 *      response completes — for 8+ seconds past the point where the old bug
 *      resurrected the component (~5.8s after start).
 *   2. The STORED thinkingElapsedMs is frozen at thinking-complete and never
 *      changes during or after streaming.
 *   3. On reload, the static "Thought for X.Xs" label matches the stored value
 *      and does not change.
 *
 * Run: node test-chat-timer-stop.js
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

function makeResult(lawMd, actionsMd, sources) {
  return {
    classification: { practice_area: "tenancy", jurisdiction: "Federal", urgency: "Medium", route: "simple" },
    route: "simple",
    result: { lawMd, actionsMd, sources, escalate: false, escalateReason: "resolvable", followUps: ["More?"] },
    critique: null,
    evidence: { sufficient: true, sourceCount: sources.length, minSources: 2 },
    providersBusy: false,
    retryAfter: null,
  };
}

const SHORT_LAW = "Under the Lagos State Tenancy Law, a landlord must serve notice before recovering possession.";
const SHORT_ACTIONS = "- Step 1: Document it\n- Step 2: Contact a lawyer";

const LONG_LAW = (
  "Under the Lagos State Tenancy Law, a landlord must serve the statutory notice to quit before recovering possession of the premises, and self help eviction is strictly prohibited. " +
  "The tenant is entitled to peaceful and quiet enjoyment of the premises during the tenancy, and any forcible entry or locking out without a court order is unlawful and actionable. " +
  "Where a landlord unlawfully evicts a tenant, the tenant may apply to the court for an order of possession together with damages for trespass and disturbance of possession, and the court may award compensation for any loss suffered by the tenant."
);
const LONG_ACTIONS =
  "- Step 1: Document everything including dates, names, and photographs of the locks changed.\n" +
  "- Step 2: Report the matter to the nearest police station and obtain an extract.\n" +
  "- Step 3: Engage a lawyer to file an application before the appropriate court.\n" +
  "- Step 4: Keep records of any correspondence with the landlord.";
const LONG_SOURCES = [
  { label: "Lagos State Tenancy Law, s.13", excerpt: "Notice to quit shall be served..." },
  { label: "Lagos State Tenancy Law, s.20", excerpt: "Recovery of possession..." },
  { label: "Recovery of Premises Law, s.1", excerpt: "Proceedings for possession..." },
];

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); }
  catch (err) { failures += 1; console.log(`  FAIL  ${name}\n        ${err.message}`); }
}

function storedElapsed(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem("lu.conversations.v3.anonymous");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const convo = (parsed.conversations || [])[0];
    if (!convo) return null;
    const agent = [...convo.messages].reverse().find((m) => m.role === "agent");
    return agent ? agent.thinkingElapsedMs : null;
  });
}

function liveLabel(page) {
  return page.evaluate(() => {
    const span = document.querySelector(".beui-thinking-header span");
    return span ? span.textContent : null;
  });
}

async function freshPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(BASE, { waitUntil: "load" });
  await page.evaluate(() => localStorage.removeItem("lu.conversations.v3.anonymous"));
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.promptBar && window.promptBar.inputElement, null, { timeout: 10000 });
  // Wait for the no-Firebase auth fallback to fire (it renders a disabled
  // sign-in button). This ensures resolveUrl's 3s timer already ran while the
  // chat was empty, so it can't re-render mid/after the pipeline below.
  await page.waitForFunction(() => document.querySelector(".auth-signin-btn[disabled]"), null, { timeout: 8000 });
  return page;
}

// Sample the live label + stored value for `ms` duration and return a summary.
async function sampleWindow(page, ms) {
  const samples = [];
  const step = 500;
  for (let t = 0; t < ms; t += step) {
    await page.waitForTimeout(step);
    samples.push({ label: await liveLabel(page), stored: await storedElapsed(page) });
  }
  return samples;
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({ args: ["--no-sandbox"] });

  try {
    console.log("\n=== Timer-stop regression tests ===\n");

    // ── Scenario A: short casual reply ─────────────────────────────────────
    {
      const page = await freshPage(browser);
      await page.route("**/api/chat", (route) => {
        if (route.request().method() !== "POST") return route.continue();
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ isCasual: true, casualReply: "Hello! I'm here to help." }) });
      });

      await check("A (casual): no 'Thought for' trace is ever shown live", async () => {
        await page.evaluate(() => { window.promptBar.inputElement.value = "hi"; window.promptBar.submit(); });
        await page.waitForFunction(() => document.querySelector(".casual-reply-plain"), null, { timeout: 15000 });
        const samples = await sampleWindow(page, 8000);
        assert.strictEqual(samples.every((s) => s.label === null), true, "no thinking header may appear for a casual reply");
        assert.strictEqual(samples.every((s) => s.stored === samples[0].stored), true, "stored value must be stable");
      });

      await check("A (casual): reload shows the casual reply, no trace", async () => {
        await page.reload({ waitUntil: "load" });
        await page.waitForFunction(() => document.querySelector(".casual-reply-plain"), null, { timeout: 10000 });
        const hasHeader = await page.evaluate(() => !!document.querySelector(".beui-thinking-header"));
        assert.strictEqual(hasHeader, false, "casual reload must not show a trace");
      });
      await page.close();
    }

    // ── Scenario B: medium legal answer ────────────────────────────────────
    {
      const page = await freshPage(browser);
      await page.route("**/api/chat", (route) => {
        if (route.request().method() !== "POST") return route.continue();
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(makeResult(SHORT_LAW, SHORT_ACTIONS, [{ label: "Lagos State Tenancy Law, s.13", excerpt: "..." }])) });
      });

      await check("B (medium): stored value freezes and live label never ticks after completion", async () => {
        await page.evaluate(() => { window.promptBar.inputElement.value = "My landlord evicted me"; window.promptBar.submit(); });
        // Wait until fully complete (verdict card visible = streaming done).
        await page.waitForFunction(() => {
          const c = document.querySelector(".beui-recommendation-card");
          return !!(c && c.offsetParent !== null);
        }, null, { timeout: 30000 });
        await page.waitForTimeout(700); // finalizeAnswer settle

        const frozen = await storedElapsed(page);
        assert.ok(frozen != null && frozen > 0, "stored thinking time must be set");
        const samples = await sampleWindow(page, 8000);
        const distinctStored = new Set(samples.map((s) => s.stored));
        assert.strictEqual(distinctStored.size, 1, "stored value must not change during/after streaming");
        // The live label may be absent (component destroyed) — but it must
        // NEVER be present with a changing value.
        const presentLabels = samples.filter((s) => s.label !== null).map((s) => s.label);
        assert.strictEqual(new Set(presentLabels).size <= 1, true, `live label must be frozen, got: ${JSON.stringify(presentLabels)}`);
      });

      await check("B (medium): reload shows the same frozen value", async () => {
        const before = await storedElapsed(page);
        await page.reload({ waitUntil: "load" });
        await page.waitForFunction(() => document.querySelector(".beui-thinking-header span"), null, { timeout: 10000 });
        const label = await liveLabel(page);
        const m = (label || "").match(/Thought for ([\d.]+)s/);
        assert.ok(m, `expected 'Thought for X.Xs' label, got '${label}'`);
        assert.ok(Math.abs(parseFloat(m[1]) - before / 1000) <= 0.15, `reload label ${m[1]}s should match stored ${(before / 1000).toFixed(1)}s`);
        // Confirm the static label is not ticking.
        const again = await liveLabel(page);
        await page.waitForTimeout(2000);
        const again2 = await liveLabel(page);
        assert.strictEqual(again, again2, "static label must not change over time");
      });
      await page.close();
    }

    // ── Scenario C: long multi-source answer with a slow API ───────────────
    {
      const page = await freshPage(browser);
      await page.route("**/api/chat", async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        await new Promise((r) => setTimeout(r, 2500)); // slow thinking
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(makeResult(LONG_LAW, LONG_ACTIONS, LONG_SOURCES)) });
      });

      await check("C (long): frozen through a long multi-source stream", async () => {
        await page.evaluate(() => { window.promptBar.inputElement.value = "My landlord locked me out of my flat"; window.promptBar.submit(); });
        await page.waitForFunction(() => {
          const c = document.querySelector(".beui-recommendation-card");
          return !!(c && c.offsetParent !== null);
        }, null, { timeout: 60000 });
        await page.waitForTimeout(700);

        const frozen = await storedElapsed(page);
        assert.ok(frozen != null && frozen > 0, "stored thinking time must be set");
        const samples = await sampleWindow(page, 9000);
        assert.strictEqual(new Set(samples.map((s) => s.stored)).size, 1, "stored value must stay frozen");
        const presentLabels = samples.filter((s) => s.label !== null).map((s) => s.label);
        assert.strictEqual(new Set(presentLabels).size <= 1, true, `live label must be frozen, got: ${JSON.stringify(presentLabels)}`);
      });

      await check("C (long): reload shows the same frozen value", async () => {
        const before = await storedElapsed(page);
        await page.reload({ waitUntil: "load" });
        await page.waitForFunction(() => document.querySelector(".beui-thinking-header span"), null, { timeout: 10000 });
        const label = await liveLabel(page);
        const m = (label || "").match(/Thought for ([\d.]+)s/);
        assert.ok(m, `expected 'Thought for X.Xs', got '${label}'`);
        assert.ok(Math.abs(parseFloat(m[1]) - before / 1000) <= 0.15, `reload ${m[1]}s vs stored ${(before / 1000).toFixed(1)}s`);
      });
      await page.close();
    }

    await browser.close();
    console.log(failures === 0 ? "\nALL TIMER-STOP TESTS PASSED" : `\n${failures} TIMER-STOP TEST(S) FAILED`);
  } finally {
    server.kill();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
