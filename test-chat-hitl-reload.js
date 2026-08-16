/**
 * Browser test for the HITL-reload corruption bug.
 *
 * Repro: agent asks a HITL clarifying question → user answers (request
 * completes) → LATER the page is reloaded → the completed exchange must NOT
 * show "NOT SOURCED YET / didn't finish processing".
 *
 * Verifies:
 *   1. A completed HITL clarifying question is stored with status "needsInput"
 *      and re-renders as an answerable card after reload (not "incomplete").
 *   2. The follow-up full answer survives reload as "done" with its result.
 *   3. A genuinely interrupted message still renders an honest incomplete
 *      state (no misleading "page may have reloaded mid-request" text).
 *
 * Run: node test-chat-hitl-reload.js
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

const FULL_RESULT = {
  classification: { practice_area: "tenancy", jurisdiction: "Lagos State", urgency: "Medium", route: "simple" },
  route: "simple",
  result: {
    lawMd: "Under the Lagos State Tenancy Law 2011, a landlord must serve notice to quit before recovering possession.",
    actionsMd: "- Step 1: Document it\n- Step 2: Report to the police\n- Step 3: Engage a lawyer",
    sources: [{ label: "Lagos State Tenancy Law, s.13", excerpt: "Notice..." }],
    escalate: false,
    escalateReason: "You can likely resolve this directly.",
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

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  try {
    console.log("\n=== HITL reload tests ===\n");

    let chatCalls = 0;
    await page.route("**/api/chat", (route) => {
      if (route.request().method() !== "POST") return route.continue();
      chatCalls += 1;
      if (chatCalls === 1) {
        // First call → HITL clarifying question (jurisdiction unclear).
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          needsInput: true,
          question: "Which state did this happen in? The laws can differ by state.",
          field: "jurisdiction",
          context: { practice_area: "tenancy", urgency: "Medium" },
        }) });
      } else {
        // Subsequent calls → full legal answer.
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FULL_RESULT) });
      }
    });

    await page.goto(BASE, { waitUntil: "load" });
    await page.evaluate(() => localStorage.removeItem("lu.conversations.v3.anonymous"));
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => window.promptBar && window.promptBar.inputElement, null, { timeout: 10000 });

    // 1. Ask the question → clarifying card appears.
    await page.evaluate(() => {
      window.promptBar.inputElement.value = "My landlord evicted me";
      window.promptBar.submit();
    });
    await page.waitForFunction(() => document.querySelector(".needs-input"), null, { timeout: 15000 });

    await check("completed HITL question is stored with status 'needsInput' (not 'thinking')", async () => {
      const status = await page.evaluate(() => {
        const raw = JSON.parse(localStorage.getItem("lu.conversations.v3.anonymous"));
        const agent = [...raw.conversations[0].messages].reverse().find((m) => m.role === "agent");
        return agent && agent.status;
      });
      assert.strictEqual(status, "needsInput", `expected 'needsInput', got '${status}'`);
    });

    // 2. Answer the clarifying question → full answer streams.
    await page.fill(".needs-input input", "Lagos State");
    await page.click(".needs-input button");
    // Wait until the answer FULLY completes: the verdict card becomes visible
    // only after law + actions finish streaming, and finalizeAnswer runs just
    // after. This mirrors a genuinely completed (non-interrupted) request.
    await page.waitForFunction(
      () => {
        const card = document.querySelector(".beui-recommendation-card");
        return !!(card && card.offsetParent !== null);
      },
      null,
      { timeout: 30000 }
    );
    await page.waitForTimeout(700); // finalizeAnswer + saveState settle

    // Sanity: the completed answer must be stored as "done" BEFORE reloading.
    await check("completed follow-up answer is stored as 'done' before reload", async () => {
      const status = await page.evaluate(() => {
        const raw = JSON.parse(localStorage.getItem("lu.conversations.v3.anonymous"));
        const agents = raw.conversations[0].messages.filter((m) => m.role === "agent");
        return agents.map((m) => m.status);
      });
      assert.deepStrictEqual(status, ["needsInput", "done"], `got ${JSON.stringify(status)}`);
    });

    // 3. Reload (the key step — a LATER, unrelated reload).
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => document.querySelectorAll(".msg--agent").length >= 2, null, { timeout: 10000 });
    await page.waitForTimeout(400);

    await check("after reload the HITL question re-renders as a card, not 'not sourced'", async () => {
      const info = await page.evaluate(() => ({
        needsInputCard: !!document.querySelector(".needs-input"),
        notSourced: document.body.textContent.includes("didn't finish processing"),
        notSourcedTitle: document.body.textContent.includes("Response incomplete"),
      }));
      assert.strictEqual(info.needsInputCard, true, "clarifying question card must re-render");
      assert.strictEqual(info.notSourced, false, "must not show 'didn't finish processing'");
      assert.strictEqual(info.notSourcedTitle, false, "must not show 'Response incomplete'");
    });

    await check("after reload the follow-up answer still renders its result", async () => {
      const info = await page.evaluate(() => {
        const blocks = document.querySelectorAll(".answer-block-plain");
        return blocks.length;
      });
      assert.strictEqual(info, 1, "the full answer block must still be present");
    });

    await check("stored statuses are correct after reload", async () => {
      const statuses = await page.evaluate(() => {
        const raw = JSON.parse(localStorage.getItem("lu.conversations.v3.anonymous"));
        const agents = raw.conversations[0].messages.filter((m) => m.role === "agent");
        return agents.map((m) => m.status);
      });
      assert.deepStrictEqual(statuses, ["needsInput", "done"], `got ${JSON.stringify(statuses)}`);
    });

    // 4. A genuinely interrupted message shows an honest (non-blameful) state.
    await check("genuinely incomplete message shows honest text (no reload blame)", async () => {
      const info = await page.evaluate(() => {
        const raw = JSON.parse(localStorage.getItem("lu.conversations.v3.anonymous"));
        const convo = raw.conversations[0];
        // Inject a truly-interrupted agent message (no result, thinking status).
        convo.messages.push({
          id: "interrupted-1", role: "agent", status: "thinking", createdAt: Date.now(),
          steps: [{ key: "read", title: "Reading", detail: "", state: "pending", elapsedMs: 0 }],
          thinkingElapsedMs: 0,
        });
        localStorage.setItem("lu.conversations.v3.anonymous", JSON.stringify(raw));
        return true;
      });
      await page.reload({ waitUntil: "load" });
      await page.waitForFunction(() => document.querySelectorAll(".msg--agent").length >= 3, null, { timeout: 10000 });
      await page.waitForTimeout(300);

      const txt = await page.evaluate(() => document.body.textContent);
      assert.ok(txt.includes("Response incomplete"), "interrupted message should say 'Response incomplete'");
      assert.ok(!txt.includes("may have reloaded mid-request"), "must not blame a reload that didn't happen");
      assert.ok(!txt.includes("NOT SOURCED YET"), "must not use the 'not sourced' wording for an interrupted message");
    });

    await browser.close();
    console.log(failures === 0 ? "\nALL HITL-RELOAD TESTS PASSED" : `\n${failures} HITL-RELOAD TEST(S) FAILED`);
  } finally {
    server.kill();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
