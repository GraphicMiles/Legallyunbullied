/**
 * Retrieval-only recall check (no LLM calls, no Firestore reads).
 *
 * For every scenario that lists expected.must_cite, runs the in-memory BM25
 * index over the scenario's user turns and checks whether a must-cite Act
 * appears in the top K. Name matching is a rough prefix match on the Act name,
 * so treat a miss as "look at it", not as proof.
 *
 * Usage: node scripts/eval/retrievalRecall.js [--k 8] [--results server/eval/results100.json]
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const idx = require(path.join(ROOT, "server", "legalIndex.js"));

const args = process.argv.slice(2);
const kIdx = args.indexOf("--k");
const K = kIdx >= 0 ? Number(args[kIdx + 1]) : 8;
const rIdx = args.indexOf("--results");
const resultsPath = path.resolve(ROOT, rIdx >= 0 ? args[rIdx + 1] : "server/eval/results100.json");

function loadScenarios() {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, "server", "eval", "scenarios100.json"), "utf8"));
  return Array.isArray(raw) ? raw : raw.scenarios || Object.values(raw).find(Array.isArray);
}

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

function run() {
  const scenarios = loadScenarios();
  const zeroIds = new Set();
  if (fs.existsSync(resultsPath)) {
    for (const r of JSON.parse(fs.readFileSync(resultsPath, "utf8")).results || []) {
      if ((r.retrieval || {}).sourceCount === 0) zeroIds.add(r.scenario_id);
    }
  }
  let withMust = 0, hit = 0, zeroTotal = 0, zeroHit = 0;
  const misses = [];
  for (const s of scenarios) {
    const must = (s.expected && s.expected.must_cite) || [];
    if (!must.length) continue;
    withMust++;
    const top = idx.search(s.turns.join(" "), { k: K });
    const ok = must.some((m) => top.some((t) => norm(t.act).includes(norm(m).split(" ").slice(0, 3).join(" "))));
    if (ok) hit++; else misses.push(s.id);
    if (zeroIds.has(s.id)) { zeroTotal++; if (ok) zeroHit++; }
  }
  return { k: K, scenariosWithMustCite: withMust, hit, misses, zeroSourceScenarios: zeroTotal, zeroSourceHit: zeroHit };
}

module.exports = { run };

if (require.main === module) {
  const r = run();
  console.log(JSON.stringify({ k: r.k, scenariosWithMustCite: r.scenariosWithMustCite, hit: r.hit, miss: r.misses.length, zeroSourceScenarios: r.zeroSourceScenarios, zeroSourceHit: r.zeroSourceHit }));
  console.log("misses:", r.misses.join(", "));
}
