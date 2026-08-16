/**
 * Browser test for Fix 2: the "still working" poll keeps going until the job
 * finishes (previously it stopped after 4 polls).
 *
 * Seeds a conversation whose agent message is still running on the server.
 * The single-chat endpoint returns "running" on the first poll and "done" on
 * the second. Verifies the message transitions from "Still working on this"
 * to the full answer without a manual refresh.
 *
 * Run: node test-chat-running-poll.js
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

const AUTH_STUB = `
  export function getAuth(app){ return window.__FAKE_AUTH__; }
  export function onAuthStateChanged(auth, cb){
    auth._listeners = auth._listeners || [];
    auth._listeners.push(cb);
    setTimeout(() => { auth.currentUser = null; cb(null); }, 5);
    setTimeout(() => { auth.currentUser = auth._user; cb(auth._user); }, 60);
    return () => {};
  }
  export async function getIdToken(){ return "fake-token"; }
  export class GoogleAuthProvider {}
  export async function signInWithEmailAndPassword(){}
  export async function createUserWithEmailAndPassword(){}
  export async function signInWithPopup(){}
  export async function signOut(auth){ auth.currentUser = null; (auth._listeners||[]).forEach(cb => cb(null)); }
`;
const APP_STUB = "export function initializeApp(){}; export function getFirestore(){};";

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
    console.log("\n=== Running-job poll tests ===\n");

    await page.addInitScript(() => {
      window.__FAKE_AUTH__ = { currentUser: null, _user: { uid: "user-abc", email: "a@b.com", displayName: null, photoURL: null }, _listeners: [] };
      window.firebaseAuth = window.__FAKE_AUTH__;
    });
    await page.route("https://www.gstatic.com/firebasejs/**", (route) => {
      const name = route.request().url().split("/").pop().split("?")[0];
      if (name === "firebase-auth.js") return route.fulfill({ status: 200, contentType: "text/javascript", body: AUTH_STUB });
      return route.fulfill({ status: 200, contentType: "text/javascript", body: APP_STUB });
    });
    await page.route("**/api/conversations/migrate", r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, idMap: {}, migrated: 0, skipped: 0 }) }));
    await page.route("**/api/conversations/cleanup", r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, deleted: 0 }) }));

    const runningMessage = {
      id: "m1", role: "agent", status: "thinking", pipelineStatus: "running", createdAt: 1000, thinkingElapsedMs: 1000,
      steps: [{ key: "read", title: "Reading", detail: "", state: "pending", elapsedMs: 0 }],
    };
    const doneMessage = {
      id: "m1", role: "agent", status: "done", pipelineStatus: "done", createdAt: 1000, thinkingElapsedMs: 1000, unread: true,
      steps: [{ key: "read", title: "Reading", detail: "", state: "done", elapsedMs: 10 }],
      result: { lawMd: "Under the law, report what you witnessed.", actionsMd: "- Step 1: Report it\n- Step 2: Keep a record", sources: [], escalate: false, escalateReason: "", followUps: [] },
    };

    // List: the conversation exists with a RUNNING message (so the fast path
    // renders "Still working" and starts polling).
    await page.route("**/api/conversations?full=*", r =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        conversations: [
          { id: "c1", title: "Witness", createdAt: 1, updatedAt: 1, messages: [
            { id: "u1", role: "user", content: "I witnessed a crime", createdAt: 1 },
            runningMessage,
          ] },
        ],
        hasMore: false, nextCursor: null,
      }) }));

    // Single-chat: first poll → still running; second poll → done.
    let singleCalls = 0;
    await page.route("**/api/conversations/c1", r => {
      singleCalls += 1;
      const body = singleCalls === 1
        ? { id: "c1", title: "Witness", createdAt: 1, updatedAt: 1, messages: [{ id: "u1", role: "user", content: "I witnessed a crime", createdAt: 1 }, runningMessage] }
        : { id: "c1", title: "Witness", createdAt: 1, updatedAt: 1, messages: [{ id: "u1", role: "user", content: "I witnessed a crime", createdAt: 1 }, doneMessage] };
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });

    await page.goto(`${BASE}/#chat/c1`, { waitUntil: "load" });
    await page.waitForFunction(() => document.body.textContent.includes("Still working on this"), null, { timeout: 10000 });

    await check("running message initially shows 'Still working on this'", async () => {
      const txt = await page.evaluate(() => document.body.textContent);
      assert.ok(txt.includes("Still working on this"), "should show the running placeholder");
    });

    await check("polling resolves the job to the full answer (no manual refresh)", async () => {
      // The first poll is at ~8s, the second at ~16s (done).
      await page.waitForFunction(
        () => document.body.textContent.includes("Under the law, report what you witnessed."),
        null, { timeout: 30000 }
      );
      const txt = await page.evaluate(() => document.body.textContent);
      assert.ok(!txt.includes("Still working on this"), "the running placeholder must be gone");
      assert.ok(txt.includes("report what you witnessed"), "the answer must be rendered");
      assert.ok(singleCalls >= 2, `expected at least 2 single-chat polls, got ${singleCalls}`);
    });

    await browser.close();
    console.log(failures === 0 ? "\nALL RUNNING-POLL TESTS PASSED" : `\n${failures} RUNNING-POLL TEST(S) FAILED`);
  } finally {
    server.kill();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
