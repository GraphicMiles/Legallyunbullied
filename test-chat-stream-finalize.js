/**
 * Tests for two live-streaming bugs:
 *
 *  A. "Thought for X.Xs" must be visible (frozen) during response streaming
 *     and remain after completion — matching the reload render.
 *  B. Numbered "What you can do" steps must NOT disappear at completion —
 *     they stay visible through the streaming→complete transition and match
 *     what reload shows.
 *
 * Covers a short steps list (2 steps) and a long one (6 steps).
 *
 * Run: node test-chat-stream-finalize.js
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

// ~45 words so the law stream takes several seconds (measurable streaming window).
const LAW_MD =
  "Under the law, anyone who witnesses a crime is generally free to report it to the police without fear of penalty, and may be asked to provide a statement describing what they saw. " +
  "The law also protects witnesses from intimidation and harassment, and a person who has information about a serious offence should promptly report it to the nearest police station or other law enforcement agency.";

const SHORT_STEPS = "- Step 1: Write down what you saw while it is fresh.\n- Step 2: Report it to the nearest police station.";

const LONG_STEPS =
  "- Step 1: Write down every detail you remember while it is fresh.\n" +
  "- Step 2: Note the date, time, location, and people involved.\n" +
  "- Step 3: Report the incident to the nearest police station.\n" +
  "- Step 4: Ask for a written acknowledgment of your report.\n" +
  "- Step 5: Cooperate with any follow-up investigation.\n" +
  "- Step 6: Contact a lawyer if you feel pressured or threatened.";

function legalResponse(actionsMd) {
  return {
    classification: { practice_area: "criminal_offences", jurisdiction: "Federal", urgency: "Medium", route: "simple" },
    route: "simple",
    result: {
      lawMd: LAW_MD,
      actionsMd,
      sources: [{ label: "Criminal Code Act, s.X", excerpt: "…" }],
      escalate: false,
      escalateReason: "You can likely handle this.",
      followUps: ["What if I fear for my safety?"],
    },
    critique: null,
    evidence: { sufficient: true, sourceCount: 2, minSources: 2 },
    providersBusy: false,
    retryAfter: null,
  };
}

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); }
  catch (err) { failures += 1; console.log(`  FAIL  ${name}\n        ${err.message}`); }
}

function liveLabel(page) {
  return page.evaluate(() => {
    const span = document.querySelector(".beui-thinking-header span");
    return span ? span.textContent : null;
  });
}
function liveActionsText(page) {
  return page.evaluate(() => {
    const blocks = document.querySelectorAll(".answer-text-block");
    return blocks.length >= 2 ? blocks[1].textContent : "";
  });
}
function storedActionsMd(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem("lu.conversations.v3.anonymous");
    if (!raw) return "";
    const parsed = JSON.parse(raw);
    const convo = parsed.conversations[0];
    const agent = [...convo.messages].reverse().find((m) => m.role === "agent" && m.result);
    return agent && agent.result ? agent.result.actionsMd : "";
  });
}

async function runScenario(browser, actionsMd) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.route("**/api/chat", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(legalResponse(actionsMd)) });
  });
  await page.goto(BASE, { waitUntil: "load" });
  await page.evaluate(() => localStorage.removeItem("lu.conversations.v3.anonymous"));
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.promptBar && window.promptBar.inputElement, null, { timeout: 10000 });
  // Let the no-Firebase auth fallback (3s) fire while the chat is still empty.
  await page.waitForFunction(() => document.querySelector(".auth-signin-btn[disabled]"), null, { timeout: 8000 });

  await page.evaluate(() => {
    window.promptBar.inputElement.value = "I witnessed a crime";
    window.promptBar.submit();
  });

  return page;
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({ args: ["--no-sandbox"] });

  try {
    console.log("\n=== Streaming-finalize tests ===\n");

    // ── Scenario 1: long steps ────────────────────────────────────────────
    {
      const page = await runScenario(browser, LONG_STEPS);

      await check("long steps: frozen 'Thought for Xs' header appears during streaming", async () => {
        await page.waitForFunction(
          () => {
            const span = document.querySelector(".beui-thinking-header span");
            return !!span && span.textContent.startsWith("Thought for");
          },
          null, { timeout: 15000 }
        );
        const label1 = await liveLabel(page);
        await page.waitForTimeout(1500);
        const label2 = await liveLabel(page);
        assert.strictEqual(label1, label2, `label must be FROZEN during streaming (got '${label1}' then '${label2}')`);
        const m = label1.match(/Thought for ([\d.]+)s/);
        assert.ok(m, `expected 'Thought for X.Xs', got '${label1}'`);
      });

      await check("long steps: steps remain visible through the completion transition", async () => {
        // Wait for full completion (verdict card visible = streaming done +
        // finalizeAnswer ran).
        await page.waitForFunction(
          () => {
            const c = document.querySelector(".beui-recommendation-card");
            return !!(c && c.offsetParent !== null);
          },
          null, { timeout: 30000 }
        );
        await page.waitForTimeout(700); // cover the staggered reveal + finalize

        const text = await liveActionsText(page);
        assert.ok(text.includes("Step 1"), `steps must survive completion — got: "${text.slice(0, 120)}"`);
        assert.ok(text.includes("Step 6"), "all 6 steps must survive completion");
        // After my markdown finalization, live should render bullets (li), not raw "- ".
        assert.ok(!text.includes("- Step 1"), "live completed text should be markdown-formatted, not raw '- Step 1'");
      });

      await check("long steps: frozen header still present (unchanged) after completion", async () => {
        const label = await liveLabel(page);
        const m = (label || "").match(/Thought for ([\d.]+)s/);
        assert.ok(m, `header must still be present after completion, got '${label}'`);
      });

      await check("long steps: live completed render matches reload render", async () => {
        const liveText = (await liveActionsText(page)).trim();
        const storedMd = await storedActionsMd(page);
        await page.reload({ waitUntil: "load" });
        await page.waitForFunction(() => document.querySelectorAll(".answer-text-block").length >= 2, null, { timeout: 10000 });
        await page.waitForTimeout(300);
        const reloadText = (await liveActionsText(page)).trim();
        // Both should contain every step and be markdown-formatted (bullets).
        for (const n of [1, 2, 3, 4, 5, 6]) {
          assert.ok(reloadText.includes(`Step ${n}`), `reload must contain Step ${n}`);
          assert.ok(liveText.includes(`Step ${n}`), `live must contain Step ${n}`);
        }
        assert.strictEqual(reloadText.includes("- Step 1"), false, "reload renders bullets, not raw '- Step 1'");
        assert.ok(storedMd.includes("Step 6"), "stored result must contain the full steps list");
        await page.close();
      });
    }

    // ── Scenario 2: short steps ───────────────────────────────────────────
    {
      const page = await runScenario(browser, SHORT_STEPS);

      await check("short steps: steps survive completion", async () => {
        await page.waitForFunction(
          () => {
            const c = document.querySelector(".beui-recommendation-card");
            return !!(c && c.offsetParent !== null);
          },
          null, { timeout: 30000 }
        );
        await page.waitForTimeout(700);
        const text = await liveActionsText(page);
        assert.ok(text.includes("Step 1"), `Step 1 missing: "${text}"`);
        assert.ok(text.includes("Step 2"), `Step 2 missing: "${text}"`);
        assert.ok(!text.includes("- Step 1"), "short steps should be markdown-formatted too");
      });

      await check("short steps: live matches reload", async () => {
        const liveText = (await liveActionsText(page)).trim();
        await page.reload({ waitUntil: "load" });
        await page.waitForFunction(() => document.querySelectorAll(".answer-text-block").length >= 2, null, { timeout: 10000 });
        const reloadText = (await liveActionsText(page)).trim();
        assert.ok(reloadText.includes("Step 1") && reloadText.includes("Step 2"), "reload must contain both steps");
        assert.ok(liveText.includes("Step 1") && liveText.includes("Step 2"), "live must contain both steps");
        await page.close();
      });
    }

    await browser.close();
    console.log(failures === 0 ? "\nALL STREAM-FINALIZE TESTS PASSED" : `\n${failures} STREAM-FINALIZE TEST(S) FAILED`);
  } finally {
    server.kill();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
