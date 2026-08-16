/**
 * Quick diagnostic: dump DOM structure of the prompt area
 * and take a screenshot so we can find the right selectors.
 */
const { chromium } = require("playwright");
const fs = require("fs");

async function run() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  
  // Capture all console output
  const logs = [];
  page.on("console", msg => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on("pageerror", err => logs.push(`[PAGE_ERROR] ${err.message}`));
  
  await page.goto("https://legally-unbullied.onrender.com", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(5000);
  
  // Screenshot
  await page.screenshot({ path: "/home/user/debug-screenshot.png", fullPage: true });
  console.log("Screenshot saved to /home/user/debug-screenshot.png");
  
  // Dump all inputs, textareas, and contenteditable elements
  const inputs = await page.evaluate(() => {
    const allInputs = Array.from(document.querySelectorAll("input, textarea, [contenteditable], [role='textbox']"));
    return allInputs.map(el => ({
      tag: el.tagName,
      type: el.type || "",
      id: el.id,
      className: el.className,
      placeholder: el.placeholder || "",
      name: el.name || "",
      role: el.getAttribute("role") || "",
      contentEditable: el.contentEditable,
      visible: el.offsetParent !== null,
      parentClass: el.parentElement?.className || "",
      parentTag: el.parentElement?.tagName || "",
    }));
  });
  console.log("\n=== All input-like elements ===");
  console.log(JSON.stringify(inputs, null, 2));
  
  // Check for the prompt-bar-container specifically
  const promptBar = await page.evaluate(() => {
    const container = document.getElementById("prompt-bar-container");
    if (!container) return "NO #prompt-bar-container found";
    return container.innerHTML.slice(0, 2000);
  });
  console.log("\n=== Prompt bar container HTML ===");
  console.log(promptBar);
  
  // Check BeUIPromptBar
  const beuiCheck = await page.evaluate(() => {
    return {
      promptBar: !!window.promptBar,
      BeUIPromptBar: !!window.BeUIPromptBar,
      inputElement: window.promptBar?.inputElement ? {
        tag: window.promptBar.inputElement.tagName,
        class: window.promptBar.inputElement.className,
        id: window.promptBar.inputElement.id,
      } : null,
    };
  });
  console.log("\n=== BeUI Prompt Bar state ===");
  console.log(JSON.stringify(beuiCheck, null, 2));
  
  // Console logs
  console.log("\n=== Console output ===");
  logs.forEach(l => console.log(l));
  
  await browser.close();
}

run().catch(console.error);
