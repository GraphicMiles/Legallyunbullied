/**
 * Browser test for context-derived chat titles.
 *
 * Verifies the chat title is drawn from the user's first message (never a
 * fixed "Legal question" placeholder):
 *   1. Casual message ("Hi")            → title is "Hi"
 *   2. Legal-keyword message            → title is the category (e.g. "Tenancy question")
 *   3. Non-keyword, non-legal message   → title is a snippet of the message itself
 *
 * Run: node test-chat-title-browser.js
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

async function titleAfterFirstMessage(browser, message) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(BASE, { waitUntil: "load" });
  // Start from a clean anonymous state so each case is independent.
  await page.evaluate(() => localStorage.removeItem("lu.conversations.v3.anonymous"));
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.promptBar && window.promptBar.inputElement, null, { timeout: 10000 });

  await page.evaluate((msg) => {
    window.promptBar.inputElement.value = msg;
    window.promptBar.submit();
  }, message);

  // The title is derived synchronously from the first message; wait for the
  // sidebar to render it.
  await page.waitForFunction(
    (msg) => {
      const el = document.querySelector(".history__item-title");
      return el && el.textContent.trim().length > 0;
    },
    message,
    { timeout: 8000 }
  );
  const title = await page.evaluate(() => document.querySelector(".history__item-title").textContent.trim());
  await page.close();
  return title;
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({ args: ["--no-sandbox"] });

  try {
    console.log("\n=== Chat title context tests ===\n");

    await check("casual greeting uses the message as the title", async () => {
      const title = await titleAfterFirstMessage(browser, "Hi");
      assert.notStrictEqual(title, "Legal question", "must not fall back to 'Legal question'");
      assert.strictEqual(title, "Hi", `expected 'Hi', got '${title}'`);
    });

    await check("legal keyword maps to a category title", async () => {
      const title = await titleAfterFirstMessage(browser, "My landlord locked me out of my flat");
      assert.notStrictEqual(title, "Legal question", "must not fall back to 'Legal question'");
      assert.strictEqual(title, "Tenancy question", `expected 'Tenancy question', got '${title}'`);
    });

    await check("non-keyword message uses a snippet of itself", async () => {
      const title = await titleAfterFirstMessage(browser, "Someone took my phone yesterday");
      assert.notStrictEqual(title, "Legal question", "must not fall back to 'Legal question'");
      assert.strictEqual(title, "Someone took my phone yesterday", `expected the message snippet, got '${title}'`);
    });

    await check("long message is truncated at a word boundary", async () => {
      const msg = "I have a very complicated situation about my business partner and some money";
      const title = await titleAfterFirstMessage(browser, msg);
      assert.notStrictEqual(title, "Legal question");
      assert.ok(title.endsWith("…"), `long title should be truncated with an ellipsis, got '${title}'`);
      assert.ok(title.length <= 49, `title too long: '${title}'`);
    });

    console.log(failures === 0 ? "\nALL TITLE TESTS PASSED" : `\n${failures} TITLE TEST(S) FAILED`);
  } finally {
    await browser.close();
    server.kill();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
