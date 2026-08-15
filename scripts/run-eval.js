#!/usr/bin/env node

/**
 * CLI entry point for eval runner.
 *
 * Usage:
 *   node scripts/run-eval.js                          # run all scenarios
 *   node scripts/run-eval.js --limit 5                # run first 5 only
 *   node scripts/run-eval.js --delay 5000             # 5s between scenarios
 *   node scripts/run-eval.js --base-url http://localhost:3000
 *   node scripts/run-eval.js --offline                # skip API calls
 */

const path = require("path");

// Resolve runner from server/eval
const runnerPath = path.join(__dirname, "..", "server", "eval", "runner.js");

// Make sure we can require it
const { runEval } = require(runnerPath);

const args = process.argv.slice(2);
const opts = {};

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case "--limit":
      opts.limit = parseInt(args[++i], 10);
      break;
    case "--delay":
      opts.delayMs = parseInt(args[++i], 10);
      break;
    case "--base-url":
      opts.baseUrl = args[++i];
      break;
    case "--offline":
      opts.offline = true;
      break;
    case "--scenarios":
      opts.scenariosFile = args[++i];
      break;
    case "--help":
      console.log(`
Usage: node scripts/run-eval.js [options]

Options:
  --limit N        Run only the first N scenarios
  --delay MS       Delay (ms) between scenarios (default: 3000)
  --base-url URL   Base URL for the API (default: https://legally-unbullied.onrender.com)
  --offline        Skip API calls and mark scenarios as skipped
  --scenarios PATH Path to scenarios JSON file
  --help           Show this help
`);
      process.exit(0);
      break;
    default:
      console.error(`Unknown option: ${args[i]}`);
      process.exit(1);
  }
}

console.log("Legally Unbullied — Eval Runner");
console.log("================================\n");

runEval(opts)
  .then(({ report }) => {
    console.log("\n========== SUMMARY ==========");
    console.log(`Total:        ${report.total}`);
    console.log(`Passed:       ${report.passed}`);
    console.log(`Failed:       ${report.failed}`);
    console.log(`Skipped:      ${report.skipped || 0}`);
    console.log(`Avg score:    ${report.avg_score.toFixed(3)}`);
    console.log(`Pass rate:    ${(report.pass_rate * 100).toFixed(1)}%`);
    console.log(`Rate-limited: ${report.rate_limited}`);
    console.log(`Errors:       ${report.errors}`);
    console.log(`Run at:       ${report.run_at}`);

    if (report.failing_scenarios && report.failing_scenarios.length > 0) {
      console.log("\nFailing scenarios:");
      for (const f of report.failing_scenarios) {
        console.log(`  - ${f.id}: ${f.score.toFixed(2)}`);
        if (f.dimensions) {
          const failing = Object.entries(f.dimensions)
            .filter(([, v]) => v < 0.7)
            .map(([k, v]) => `    ${k}: ${v.toFixed(2)}`);
          failing.forEach(console.log);
        }
      }
    }

    console.log("\nBy category:");
    for (const [cat, stats] of Object.entries(report.by_category)) {
      const bar = "█".repeat(Math.round(stats.avg * 20)).padEnd(20, "░");
      console.log(`  ${cat.padEnd(25)} ${stats.passed}/${stats.total} (${(stats.avg * 100).toFixed(0)}%) ${bar}`);
    }

    console.log("\nBy dimension:");
    for (const [dim, stats] of Object.entries(report.by_dimension)) {
      const bar = "█".repeat(Math.round(stats.avg * 20)).padEnd(20, "░");
      console.log(`  ${dim.padEnd(30)} ${(stats.avg * 100).toFixed(0)}% ${bar}`);
    }

    const threshold = report.meta?.pass_threshold || 0.70;
    const regressionGate = report.meta?.regression_gate || 0.65;

    console.log(`\nThreshold:      ${threshold}`);
    console.log(`Regression gate: ${regressionGate}`);

    if (report.avg_score < regressionGate) {
      console.log(`\n🚨 REGRESSION: avg score ${report.avg_score.toFixed(3)} below regression gate ${regressionGate}`);
      console.log("This phase should be rejected.");
      process.exit(1);
    } else if (report.avg_score < threshold) {
      console.log(`\n️  BELOW THRESHOLD: avg score ${report.avg_score.toFixed(3)} below target ${threshold}`);
      console.log("But above regression gate — acceptable with known issues.");
      process.exit(0);
    } else {
      console.log(`\n✅ PASS: avg score ${report.avg_score.toFixed(3)} >= threshold ${threshold}`);
      process.exit(0);
    }
  })
  .catch((err) => {
    console.error("[eval] Fatal error:", err.message);
    if (err.stack) console.error(err.stack);
    process.exit(2);
  });
