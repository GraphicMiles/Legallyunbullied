/**
 * gates.js: hard pass/fail gates for a raw eval run (JSONL written by runner100.js).
 *
 * The 100-scenario scorer passes a run when it has no critical failures and an
 * average score of at least 3.0. That lets an answer with zero retrieved sources
 * pass. These gates are stricter and do not average anything away:
 *
 *   G1  no HTTP 5xx or network error on any turn
 *   G2  every turn that gives law content has at least one retrieved source
 *   G3  every claim in a law-giving turn is supported (evidenceLink "retrieved"
 *       and a verified span); a single unsupported claim fails the turn
 *   G4  a turn with no sources must say so (the answer is a refusal or a
 *       "not in our library" note), not give law content
 *   G5  latency is reported (p50 and p95 of turn elapsedMs)
 *
 * Usage:
 *   node scripts/eval/gates.js <run.jsonl> [--max-p95-ms 8000] [--json]
 *   node scripts/eval/gates.js --self-test
 *
 * Exit code 0 when every gate passes, 1 otherwise.
 */

const fs = require("fs");

const NOT_IN_LIBRARY = /\b(not yet|does not yet|doesn.t yet|isn.t yet)\s+(cover|covered|be in|appear in)\b|\bnot (yet )?(in|covered (by|in)|found in) (our|the) (library|sources|corpus)\b|\bno ingested legal sources\b|\bnot sourced yet\b|\bcould not find (a )?(source|provision)\b/i;

function lawTextOf(response) {
  const r = response && response.result;
  if (!r) return "";
  return `${r.lawMd || ""}\n${r.actionsMd || ""}`.trim();
}

function sourceCountOf(turn) {
  const r = turn.response && turn.response.result;
  const fromResult = r && Array.isArray(r.sources) ? r.sources.length : 0;
  const fromRetrieval = turn.retrieved && typeof turn.retrieved.sourceCount === "number" ? turn.retrieved.sourceCount : 0;
  return Math.max(fromResult, fromRetrieval);
}

function claimsOf(turn) {
  const r = turn.response && turn.response.result;
  return r && Array.isArray(r.claims) ? r.claims : null;
}

/** Evaluate one turn. Returns { id, issues[], givesLaw, sources, unsupported }. */
function gateTurn(scenarioId, turn) {
  const issues = [];
  const response = turn.response || {};
  const status = Number(turn.httpStatus || 0);
  if (turn.error || status >= 500 || status === 0) issues.push("G1 transport or 5xx error");

  const law = lawTextOf(response);
  const refusal = NOT_IN_LIBRARY.test(law) || response.corpusEmpty === true || (response.result && response.result.notInLibrary === true);
  const givesLaw = law.length > 0 && !refusal && !response.isCasual && !response.needsInput && !response.providersBusy;
  const sources = sourceCountOf(turn);
  const claims = claimsOf(turn);

  if (givesLaw && sources === 0) issues.push("G2 law content with zero retrieved sources");

  if (givesLaw) {
    if (claims === null) {
      issues.push("G3 law content without a claim list, so support cannot be checked");
    } else {
      const bad = claims.filter((c) => c.evidenceLink !== "retrieved" || c.verifiedSpan !== true);
      if (claims.length === 0) issues.push("G3 law content with no claims");
      if (bad.length) issues.push(`G3 ${bad.length} unsupported claim(s)`);
    }
  }

  if (!givesLaw && law.length > 0 && !refusal && sources === 0 && !response.isCasual && !response.needsInput) {
    issues.push("G4 no sources but the answer does not say so");
  }

  return { id: scenarioId, issues, givesLaw, sources, elapsedMs: Number(turn.elapsedMs) || null };
}

function percentile(values, p) {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const idx = Math.min(xs.length - 1, Math.max(0, Math.ceil((p / 100) * xs.length) - 1));
  return xs[idx];
}

/** Evaluate a list of run records (the parsed JSONL lines). */
function gateRun(records, opts = {}) {
  const maxP95 = opts.maxP95Ms || 8000;
  const turnResults = [];
  for (const rec of records) {
    for (const turn of rec.turns || []) turnResults.push(gateTurn(rec.id, turn));
  }
  const failing = turnResults.filter((t) => t.issues.length);
  const lawTurns = turnResults.filter((t) => t.givesLaw);
  const latencies = turnResults.map((t) => t.elapsedMs);
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);

  const counts = {};
  for (const t of failing) for (const i of t.issues) {
    const key = i.split(" ")[0];
    counts[key] = (counts[key] || 0) + 1;
  }

  const gates = {
    G1_transport: !failing.some((t) => t.issues.some((i) => i.startsWith("G1"))),
    G2_sourced_law: !failing.some((t) => t.issues.some((i) => i.startsWith("G2"))),
    G3_supported_claims: !failing.some((t) => t.issues.some((i) => i.startsWith("G3"))),
    G4_honest_refusal: !failing.some((t) => t.issues.some((i) => i.startsWith("G4"))),
    G5_latency_p95_under_budget: p95 !== null && p95 <= maxP95,
  };

  return {
    scenarios: records.length,
    turns: turnResults.length,
    lawTurns: lawTurns.length,
    failingTurns: failing.length,
    issueCounts: counts,
    latency: { p50Ms: p50, p95Ms: p95, budgetP95Ms: maxP95 },
    gates,
    pass: Object.values(gates).every(Boolean),
    failures: failing.slice(0, 50).map((t) => ({ id: t.id, issues: t.issues })),
  };
}

function readJsonl(file) {
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

module.exports = { gateTurn, gateRun, percentile, NOT_IN_LIBRARY };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) {
    const { spawnSync } = require("child_process");
    const r = spawnSync(process.execPath, ["--test", __dirname + "/gates.selftest.js"], { stdio: "inherit" });
    process.exit(r.status === 0 ? 0 : 1);
  }
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("usage: node scripts/eval/gates.js <run.jsonl> [--max-p95-ms N] [--json]");
    process.exit(2);
  }
  const mIdx = args.indexOf("--max-p95-ms");
  const maxP95Ms = mIdx >= 0 ? Number(args[mIdx + 1]) : undefined;
  const report = gateRun(readJsonl(file), { maxP95Ms });
  if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`scenarios ${report.scenarios}, turns ${report.turns}, law turns ${report.lawTurns}, failing turns ${report.failingTurns}`);
    console.log("gates:", JSON.stringify(report.gates));
    console.log("latency p50/p95 ms:", report.latency.p50Ms, report.latency.p95Ms);
    console.log("issue counts:", JSON.stringify(report.issueCounts));
    console.log(report.pass ? "PASS" : "FAIL");
  }
  process.exit(report.pass ? 0 : 1);
}
