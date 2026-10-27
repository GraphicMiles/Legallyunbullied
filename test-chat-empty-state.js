/**
 * Empty-state UI + disclaimer popup regression suite.
 *
 * Locks in three UI decisions:
 *  1. The empty state has NO starter-prompt template cards (no .prompt-grid,
 *     no .prompt-card, no data-prompt bindings).
 *  2. The legal-information disclaimer is a one-time dismissible popup that
 *     persists dismissal to localStorage — never an always-on footer bar.
 *  3. The composer input is >= 16px so iOS Safari never auto-zooms on focus.
 *
 * Runs against a real browser (Playwright chromium) with the mock server.
 */
const { spawn } = require("child_process");
const puppeteerCore = require("playwright").chromium;

const PORT = 3000;
const BASE = `http://127.0.0.1:${PORT}`;
process.env.MOCK_LLM = "1";
process.env.AUTH_ENABLED = "1";

function spawnServer() {
  const child = spawn("node", ["server.js"], {
    env: { ...process.env, PORT: String(PORT), MOCK_LLM: "1", AUTH_ENABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    let out = "";
    child.stdout.on("data", (d) => {
      out += d.toString();
      if (out.includes("running") || out.includes(`port ${PORT}`)) resolve(child);
    });
    child.stderr.on("data", (d) => process.stderr.write(d));
    child.on("exit", (code) => reject(new Error(`server exited ${code}: ${out}`)));
    setTimeout(() => reject(new Error("server start timeout\n" + out)), 15000);
  });
}

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.error(`  FAIL  ${name}`); }
}

(async () => {
  const server = await spawnServer();
  const browser = await puppeteerCore.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

    console.log("\ntest 1: empty state has no template cards");
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#empty-state", { state: "visible", timeout: 10000 });
    const cards = await page.evaluate(() => ({
      grid: document.querySelectorAll(".prompt-grid").length,
      card: document.querySelectorAll(".prompt-card").length,
      bound: document.querySelectorAll("[data-prompt]").length,
      title: document.querySelector(".empty-state__title")?.textContent || "",
      subtitle: document.querySelector(".empty-state__subtitle")?.textContent || "",
    }));
    check("no .prompt-grid element", cards.grid === 0);
    check("no .prompt-card element", cards.card === 0);
    check("no [data-prompt] bindings", cards.bound === 0);
    check("title survives", /legal situation/i.test(cards.title));
    check("subtitle present and compact copy", rulesOk(cards.subtitle));
    function rulesOk(sub) { return sub.length > 0 && sub.length <= 120; }

    console.log("\ntest 2: disclaimer is a one-time dismissible popup");
    const first = await page.evaluate(() => {
      const pop = document.getElementById("disclaimer-pop");
      return pop ? { present: true, hidden: pop.hidden } : { present: false };
    });
    check("popup exists on first load", first.present === true);
    check("popup visible on first load", first.hidden === false);
    check("no static footer disclaimer", await page.evaluate(() => !document.querySelector(".composer__disclaimer")));
    await page.click("#disclaimer-pop-close");
    await page.waitForFunction(() => document.getElementById("disclaimer-pop").hidden, { timeout: 3000 });
    check("dismiss hides popup", true);
    check("dismiss persisted", await page.evaluate(() => localStorage.getItem("lu.disclaimer.dismissed") === "1"));
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#empty-state", { state: "visible", timeout: 10000 });
    const second = await page.evaluate(() => document.getElementById("disclaimer-pop").hidden);
    check("popup stays hidden after reload", second === true);

    console.log("\ntest 3: composer input is >= 16px (no iOS auto-zoom)");
    const fontSize = await page.evaluate(() => {
      const input = document.querySelector(".beui-prompt-bar__input");
      return input ? parseFloat(getComputedStyle(input).fontSize) : 0;
    });
    check(`input font-size ${fontSize}px >= 16px`, fontSize >= 16);
  } finally {
    await browser.close();
    server.kill("SIGKILL");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
