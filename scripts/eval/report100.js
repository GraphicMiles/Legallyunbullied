/**
 * report100.js — scores the recorded JSONL results and writes:
 *   - server/eval/results100.json  (full per-scenario scores)
 *   - server/eval/report100.md     (human-readable report)
 *
 * Usage: node scripts/eval/report100.js [--in results100.jsonl]
 */

const fs = require("fs");
const path = require("path");
const { scoreScenario, aggregateResults } = require("./scoring100");

const REPO_ROOT = path.join(__dirname, "..", "..");

const DIM_LABELS = {
  legal_accuracy: "Legal accuracy",
  citation_accuracy: "Citation accuracy",
  source_grounding: "Source grounding",
  safety: "Safety",
  followup_reasoning: "Follow-up reasoning",
  practical_usefulness: "Practical usefulness",
  communication: "Communication",
  uncertainty_handling: "Uncertainty handling",
  reliability: "Reliability",
};

function main() {
  const args = process.argv.slice(2);
  let inPath = path.join(REPO_ROOT, "server", "eval", "results100.jsonl");
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--in" && args[i + 1]) inPath = args[++i];
  }

  const records = [];
  for (const line of fs.readFileSync(inPath, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); } catch (e) { /* skip partial */ }
  }
  console.log(`[report] Loaded ${records.length} scenario records from ${inPath}`);

  const scored = records.map((rec) => scoreScenario(rec, rec.turns));
  const agg = aggregateResults(scored);

  const outJson = path.join(REPO_ROOT, "server", "eval", "results100.json");
  fs.writeFileSync(outJson, JSON.stringify({
    meta: {
      name: "Legally Unbullied — 100 Real-World Conversation Evaluation",
      generated_at: new Date().toISOString(),
      scenario_count: scored.length,
    },
    aggregate: agg,
    results: scored,
  }, null, 2));
  console.log(`[report] Wrote ${outJson}`);

  const md = buildMarkdown(agg, scored);
  const outMd = path.join(REPO_ROOT, "server", "eval", "report100.md");
  fs.writeFileSync(outMd, md);
  console.log(`[report] Wrote ${outMd}`);
}

function pct(dimScore) {
  return Math.round((dimScore / 5) * 100);
}

function buildMarkdown(agg, scored) {
  const L = [];
  L.push("# Legally Unbullied — 100 Real-World Conversation Evaluation");
  L.push("");
  L.push(`Generated: ${new Date().toISOString()}`);
  L.push("");
  L.push(`**TOTAL SCENARIOS: ${agg.total}**`);
  L.push("");
  L.push("| Dimension | Score (0–5) | % |");
  L.push("|---|---|---|");
  for (const [dim, avg] of Object.entries(agg.by_dimension)) {
    L.push(`| ${DIM_LABELS[dim] || dim} | ${avg.toFixed(2)} | ${pct(avg)}% |`);
  }
  L.push("");
  L.push(`**Critical failures:** ${agg.critical_failures} (across ${agg.critical_scenarios} scenarios)`);
  L.push("");
  L.push(`**Avg score:** ${agg.avg_score}/5 · **Passed (no critical failure & avg ≥ 3.0):** ${agg.passed}/${agg.total}`);
  L.push("");

  // Failure categorisation
  L.push("## Failure categorisation");
  L.push("");
  const buckets = agg.failure_buckets;
  L.push("| Bucket | Count | Scenario IDs |");
  L.push("|---|---|---|");
  for (const [name, ids] of Object.entries(buckets)) {
    if (!ids.length) continue;
    L.push(`| ${name} | ${ids.length} | ${ids.join(", ")} |`);
  }
  L.push("");

  // Critical failures detail
  const crit = scored.filter((s) => s.critical_failures.length);
  if (crit.length) {
    L.push("## Critical failures (detail)");
    L.push("");
    for (const s of crit) {
      L.push(`### ${s.scenario_id} — ${s.title}`);
      for (const f of s.critical_failures) {
        L.push(`- **[${f.type}]** ${f.detail}`);
      }
      L.push("");
    }
  }

  // By category
  L.push("## By category");
  L.push("");
  L.push("| Category | Scenarios | Avg score | Critical failures |");
  L.push("|---|---|---|---|");
  for (const [cat, stats] of Object.entries(agg.by_category)) {
    L.push(`| ${cat} | ${stats.total} | ${stats.avg.toFixed(2)} | ${stats.critical} |`);
  }
  L.push("");

  // Full table
  L.push("## Per-scenario scores");
  L.push("");
  L.push("| # | Scenario | A | B | C | D | E | F | G | H | I | Avg | Critical |");
  L.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  const order = ["legal_accuracy", "citation_accuracy", "source_grounding", "safety",
    "followup_reasoning", "practical_usefulness", "communication", "uncertainty_handling", "reliability"];
  scored.forEach((s, i) => {
    const d = s.dimensions;
    const cf = s.critical_failures.length ? s.critical_failures.map((f) => f.type).join(",") : "—";
    L.push(`| ${i + 1} | ${s.scenario_id} | ${order.map((k) => d[k].toFixed(1)).join(" | ")} | ${s.avg_score.toFixed(2)} | ${cf} |`);
  });
  L.push("");
  L.push("_A=Legal accuracy · B=Citation accuracy · C=Source grounding · D=Safety · E=Follow-up reasoning · F=Practical usefulness · G=Communication · H=Uncertainty handling · I=Reliability_");
  L.push("");

  return L.join("\n");
}

main();
