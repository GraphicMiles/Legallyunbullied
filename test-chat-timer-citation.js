/**
 * Browser tests for the "Thought for Xs" timer and the example.com leak.
 *
 * Verifies:
 *   1. BeUIThinkingState with a startedAt shows the real elapsed time
 *      (not the hardcoded "Thought for 4 seconds").
 *   2. BeUIThinkingState without startedAt keeps the demo fallback.
 *   3. BeUIStreamingText never renders a fabricated "example.com" chip —
 *      neither with citations disabled nor when no real source is provided.
 *
 * Run: node test-chat-timer-citation.js
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

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  try {
    console.log("\n=== Timer + citation tests ===\n");
    await page.goto(BASE, { waitUntil: "load" });
    await page.waitForFunction(() => window.BeUIThinkingState && window.BeUIStreamingText, null, { timeout: 10000 });

    await check("thinking state shows real elapsed time when startedAt is provided", async () => {
      const label = await page.evaluate(() => {
        const host = document.createElement("div");
        document.body.appendChild(host);
        const comp = new window.BeUIThinkingState(host, { startedAt: Date.now() - 5000 });
        const out = comp.doneLabel({ done: "Thought for 4 seconds" });
        comp.destroy();
        host.remove();
        return out;
      });
      assert.notStrictEqual(label, "Thought for 4 seconds", "must not show the hardcoded value");
      const m = label.match(/Thought for ([\d.]+)s/);
      assert.ok(m, `expected 'Thought for X.Xs', got '${label}'`);
      const secs = parseFloat(m[1]);
      assert.ok(secs >= 4.9 && secs <= 5.5, `elapsed should be ~5s, got ${secs}s ('${label}')`);
    });

    await check("thinking state keeps demo fallback without startedAt", async () => {
      const label = await page.evaluate(() => {
        const host = document.createElement("div");
        document.body.appendChild(host);
        const comp = new window.BeUIThinkingState(host, {});
        const out = comp.doneLabel({ done: "Thought for 4 seconds" });
        comp.destroy();
        host.remove();
        return out;
      });
      assert.strictEqual(label, "Thought for 4 seconds");
    });

    await check("streaming text never renders an example.com chip (citations disabled)", async () => {
      const hasExample = await page.evaluate(() => {
        const host = document.createElement("div");
        document.body.appendChild(host);
        const text = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
        const comp = new window.BeUIStreamingText(host, { text, citations: false, sources: [], oneShot: true, showActions: false });
        const result = host.textContent.includes("example.com");
        comp.destroy();
        host.remove();
        return result;
      });
      assert.strictEqual(hasExample, false, "no example.com chip may be rendered");
    });

    await check("streaming text never renders example.com even with no sources", async () => {
      const hasExample = await page.evaluate(() => {
        const host = document.createElement("div");
        document.body.appendChild(host);
        const text = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
        // citations left at default (true), but no sources provided —
        // the old code would render a chip with domain 'example.com'.
        const comp = new window.BeUIStreamingText(host, { text, sources: [], oneShot: true, showActions: false });
        const result = host.textContent.includes("example.com");
        comp.destroy();
        host.remove();
        return result;
      });
      assert.strictEqual(hasExample, false, "no example.com chip may be fabricated when sources are missing");
    });

    await check("streaming text renders real citation chips when a source is given", async () => {
      const info = await page.evaluate(async () => {
        const host = document.createElement("div");
        document.body.appendChild(host);
        const text = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
        let captured = null;
        await new Promise((resolve) => {
          const comp = new window.BeUIStreamingText(host, {
            text,
            sources: [{ name: "Source", domain: "placng.org", href: "https://placng.org" }],
            oneShot: true,
            showActions: false,
            onDone: () => {
              captured = host.textContent;
              comp.destroy();
              resolve();
            },
          });
        });
        host.remove();
        return {
          hasPlac: (captured || "").includes("placng.org"),
          hasExample: (captured || "").includes("example.com"),
        };
      });
      assert.strictEqual(info.hasExample, false, "example.com must never appear");
      assert.strictEqual(info.hasPlac, true, "real source domain should render");
    });

    await browser.close();
    console.log(failures === 0 ? "\nALL TIMER/CITATION TESTS PASSED" : `\n${failures} TIMER/CITATION TEST(S) FAILED`);
  } finally {
    server.kill();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
