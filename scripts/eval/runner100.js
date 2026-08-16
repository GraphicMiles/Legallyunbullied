/**
 * runner100.js — drives the LIVE Legally Unbullied agent through the 100
 * multi-turn scenarios, one user message at a time (the agent never sees the
 * whole script up front), and records every turn plus the retrieval
 * reproduction (what the server's corpus returned for each question).
 *
 * Output: a JSONL file (one line per scenario) — resumable. Re-running with
 * the same --out skips scenarios already completed.
 *
 * Usage:
 *   node scripts/eval/runner100.js [--limit N] [--start N] [--only id1,id2]
 *     [--categories a,b] [--delay ms] [--base-url URL] [--out path]
 *     [--no-retrieval] [--dry-run]
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const REPO_ROOT = path.join(__dirname, "..", "..");

// Load .env into process.env so firebase-admin / legalCorpus can initialise.
function loadDotEnv() {
  const envPath = path.join(REPO_ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] == null) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
loadDotEnv();

const { getIdToken, clearTokenCache } = require("./liveAuth");
const { findProvisions } = require("../../server/legalCorpus");

const SCENARIOS_PATH = path.join(REPO_ROOT, "server", "eval", "scenarios100.json");

// ── CLI ────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const o = { delay: 3200, baseUrl: "https://legally-unbullied.onrender.com" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--limit" && argv[i + 1]) o.limit = parseInt(argv[++i], 10);
    else if (a === "--start" && argv[i + 1]) o.start = parseInt(argv[++i], 10);
    else if (a === "--only" && argv[i + 1]) o.only = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--categories" && argv[i + 1]) o.categories = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--delay" && argv[i + 1]) o.delay = parseInt(argv[++i], 10);
    else if (a === "--base-url" && argv[i + 1]) o.baseUrl = argv[++i];
    else if (a === "--out" && argv[i + 1]) o.out = argv[++i];
    else if (a === "--no-retrieval") o.noRetrieval = true;
    else if (a === "--dry-run") o.dryRun = true;
  }
  return o;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── HTTP POST with retries / backoff / token refresh ───────────────────────
const agent = new https.Agent({ keepAlive: true, maxSockets: 1 });

async function postChat(baseUrl, body, token, timeoutMs = 180000) {
  const url = new URL("/api/chat", baseUrl);
  const payload = Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: "POST",
        agent,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": payload.length,
          Authorization: "Bearer " + token,
        },
        timeout: timeoutMs,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let parsed = null;
          try { parsed = JSON.parse(data); } catch (e) { /* non-JSON */ }
          resolve({ status: res.statusCode, body: parsed || data });
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("Request timed out")));
    req.write(payload);
    req.end();
  });
}

async function callOnce(baseUrl, question, history, timeoutMs) {
  const token = await getIdToken({ uid: "eval-suite" });
  const body = { question, history: (history || []).slice(-18) };
  let res = await postChat(baseUrl, body, token, timeoutMs);

  // 401 → token may have expired; re-mint once.
  if (res.status === 401) {
    clearTokenCache();
    const fresh = await getIdToken({ uid: "eval-suite" });
    res = await postChat(baseUrl, body, fresh, timeoutMs);
  }
  return res;
}

async function callWithRetry(baseUrl, question, history, timeoutMs, maxAttempts = 4) {
  let delay = 3000;
  let lastErr = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await callOnce(baseUrl, question, history, timeoutMs);
      if (res.status === 429) {
        console.log(`    [429] backing off ${delay}ms`);
        await sleep(delay);
        delay = Math.min(delay * 2, 60000);
        continue;
      }
      if ((res.status === 502 || res.status === 503 || res.status === 504) && attempt < maxAttempts - 1) {
        console.log(`    [${res.status}] transient — retrying`);
        await sleep(delay);
        delay = Math.min(delay * 2, 60000);
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      console.log(`    [err] ${err.message} — retrying`);
      if (attempt < maxAttempts - 1) { await sleep(delay); delay = Math.min(delay * 2, 60000); }
    }
  }
  throw lastErr || new Error("All attempts failed");
}

// ── Retrieval reproduction (local, same corpus the server queries) ─────────
async function reproduceRetrieval(classification, evidence) {
  if (!classification || classification.is_legal_question === false) return null;
  if (classification.needs_sourcing === false) {
    return { noSourcing: true, primary: [], general: [], candidateActs: [] };
  }
  const pa = classification.practice_area;
  const kw = Array.isArray(classification.keywords) ? classification.keywords : [];
  const jur = classification.jurisdiction;
  let primary = [];
  let general = [];
  try { primary = await findProvisions({ practiceArea: pa, jurisdiction: jur, keywords: kw }); }
  catch (e) { console.warn(`    [retrieval] primary query failed: ${e.message}`); }
  const broadened = !!(evidence && Array.isArray(evidence.retrievedFrom) && evidence.retrievedFrom.includes("general"));
  if (broadened) {
    try { general = await findProvisions({ practiceArea: "general", jurisdiction: jur, keywords: kw }); }
    catch (e) { console.warn(`    [retrieval] general query failed: ${e.message}`); }
  }
  const candidateActs = Array.from(new Set(primary.concat(general).map((p) => p.act)));
  return {
    noSourcing: false,
    practiceArea: pa,
    primary: primary.map((p) => ({ act: p.act, section: p.section })),
    general: general.map((p) => ({ act: p.act, section: p.section })),
    candidateActs,
  };
}

// ── History building (mirrors public/app.js runPipeline) ───────────────────
function agentTextForHistory(response) {
  if (!response) return "";
  if (response.isCasual) return response.casualReply || "";
  if (response.needsInput) return response.question || "";
  if (response.result && response.result.lawMd) return response.result.lawMd;
  if (response.result && response.result.actionsMd) return response.result.actionsMd;
  if (response.message) return response.message;
  return "";
}

function capHistory(history) {
  // Keep each entry's content bounded so a long multi-turn thread can never
  // exceed the server's 50kb body limit (the real client sends full lawMd;
  // capping the oldest entries is a faithful-but-safe approximation).
  let out = history.map((h) => ({ role: h.role, content: String(h.content || "").slice(0, 2200) }));
  out = out.slice(-18);
  return out;
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const outPath = opts.out || path.join(REPO_ROOT, "server", "eval", "results100.jsonl");

  const data = JSON.parse(fs.readFileSync(SCENARIOS_PATH, "utf-8"));
  let scenarios = data.scenarios;

  if (opts.categories) scenarios = scenarios.filter((s) => opts.categories.includes(s.category));
  if (opts.only) {
    const set = new Set(opts.only);
    scenarios = scenarios.filter((s) => set.has(s.id));
  }
  if (opts.start) scenarios = scenarios.slice(opts.start);
  if (opts.limit) scenarios = scenarios.slice(0, opts.limit);

  // Resume: read already-completed ids from the JSONL.
  const done = new Set();
  if (fs.existsSync(outPath)) {
    for (const line of fs.readFileSync(outPath, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      try { done.add(JSON.parse(line).id); } catch (e) { /* partial line */ }
    }
  }
  const todo = scenarios.filter((s) => !done.has(s.id));

  console.log(`[runner] ${scenarios.length} scenarios selected; ${done.size} already done; ${todo.length} to run.`);
  if (opts.dryRun) {
    console.log("[runner] DRY RUN — plan:");
    for (const s of scenarios) console.log(`  - ${s.id} (${s.turns.length} turns)`);
    return;
  }

  const ws = fs.createWriteStream(outPath, { flags: "a" });

  for (let si = 0; si < todo.length; si++) {
    const s = todo[si];
    const t0 = Date.now();
    console.log(`\n[${done.size + si + 1}/${scenarios.length}] ${s.id} (${s.category}, ${s.turns.length} turns)`);

    const history = [];
    const turnsOut = [];

    for (let ti = 0; ti < s.turns.length; ti++) {
      const userText = s.turns[ti];
      console.log(`  turn ${ti + 1}/${s.turns.length}: "${userText.slice(0, 60)}${userText.length > 60 ? "…" : ""}"`);
      const tt0 = Date.now();
      let response = null;
      let httpStatus = null;
      let error = null;
      let retrieved = null;

      try {
        const res = await callWithRetry(opts.baseUrl, userText, capHistory(history));
        httpStatus = res.status;
        response = typeof res.body === "object" ? res.body : { raw: String(res.body).slice(0, 500) };
        if (!opts.noRetrieval) {
          retrieved = await reproduceRetrieval(response.classification, response.evidence);
        }
      } catch (err) {
        error = err.message;
        response = { error: "network", message: err.message };
      }

      const elapsed = Date.now() - tt0;
      turnsOut.push({
        index: ti,
        user: userText,
        elapsedMs: elapsed,
        httpStatus,
        error,
        response,
        retrieved,
      });

      history.push({ role: "user", content: userText });
      history.push({ role: "agent", content: agentTextForHistory(response) });

      if (ti < s.turns.length - 1) await sleep(opts.delay);
    }

    const record = {
      id: s.id,
      category: s.category,
      title: s.title,
      tags: s.tags || [],
      expected: s.expected || {},
      turn_checks: s.turn_checks || [],
      notes: s.notes || "",
      turns: turnsOut,
      completedAt: new Date().toISOString(),
      scenarioMs: Date.now() - t0,
    };
    ws.write(JSON.stringify(record) + "\n");
    console.log(`  ✓ recorded (${Math.round(record.scenarioMs / 1000)}s)`);

    if (si < todo.length - 1) await sleep(opts.delay);
  }

  ws.end();
  console.log(`\n[runner] Done. Wrote ${todo.length} scenarios to ${outPath}`);
}

main().catch((err) => {
  console.error("[runner] Fatal:", err);
  process.exit(1);
});
