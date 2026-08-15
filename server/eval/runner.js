/**
 * Eval runner for Legally Unbullied.
 *
 * Runs scenarios through the pipeline and scores them.
 *
 * Rate-limit strategy:
 *   - Sequential execution (never parallel)
 *   - Configurable delay between scenarios (default 3000ms)
 *   - Exponential backoff on 429 responses
 *   - Provisions cache shared across scenarios (same practice_area + jurisdiction = one Firestore read)
 *
 * Firestore-quota strategy:
 *   - The underlying legalCorpus.findProvisions already has 1h in-memory cache
 *   - Eval scenarios for the same practice area reuse cached results
 *   - For fully offline testing, use --offline flag to skip API calls entirely
 *
 * Usage:
 *   const results = await runEval({ delayMs: 3000, limit: 10, offline: false });
 */

const path = require("path");
const fs = require("fs");

// These imports use the live server modules.
// If any fail (e.g., missing env vars), we degrade gracefully.
let classifyWithFallback, draftWithFallback, findProvisions, extractJsonFromResponse;

try {
  const chatRoute = require("../chatRoute");
  // chatRoute is an Express router, but it also exports helpers via require
} catch (e) {
  // Expected — chatRoute is a router, not a module of helpers
}

// We'll call the live /api/chat endpoint for reliability (avoids import complexity)
// but add caching and rate limiting on top.
const http = require("http");
const https = require("https");

const SCENARIOS_PATH = path.join(__dirname, "scenarios.json");
const RESULTS_PATH = path.join(__dirname, "results.json");

function loadScenarios() {
  const raw = fs.readFileSync(SCENARIOS_PATH, "utf-8");
  return JSON.parse(raw);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calls the live /api/chat endpoint.
 * Handles rate limits with exponential backoff.
 */
async function callChatApi(question, { baseUrl, maxRetries = 3 } = {}) {
  const url = new URL("/api/chat", baseUrl);
  const body = JSON.stringify({ question });

  let lastErr;
  let delay = 1000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await new Promise((resolve, reject) => {
        const postData = body;
        const options = {
          hostname: url.hostname,
          port: url.port || 443,
          path: url.pathname,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(postData),
          },
          timeout: 180000,
        };

        const req = (url.protocol === "https:" ? https : http).request(options, (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              const parsed = JSON.parse(data);
              resolve({ status: res.statusCode, body: parsed });
            } catch (e) {
              reject(new Error(`Invalid JSON response: ${data.slice(0, 200)}`));
            }
          });
        });

        req.on("error", reject);
        req.on("timeout", () => {
          req.destroy();
          reject(new Error("Request timed out"));
        });

        req.write(postData);
        req.end();
      });

      // 429 rate limit — back off
      if (response.status === 429) {
        console.log(`  [rate-limit] Backing off ${delay}ms`);
        await sleep(delay);
        delay *= 2;
        continue;
      }

      // 502/503 drafting failed — might be transient, retry once
      if ((response.status === 502 || response.status === 503) && attempt < 2) {
        console.log(`  [transient] Status ${response.status}, retrying...`);
        await sleep(delay);
        delay *= 2;
        continue;
      }

      return response;
    } catch (err) {
      lastErr = err;
      console.log(`  [error] Attempt ${attempt + 1}: ${err.message}`);
      if (attempt < maxRetries) {
        await sleep(delay);
        delay *= 2;
      }
    }
  }

  throw lastErr || new Error("All retries exhausted");
}

async function runEval(options = {}) {
  const {
    delayMs = 3000,
    limit = null,
    baseUrl = "https://legally-unbullied.onrender.com",
    offline = false,
    scenariosFile = SCENARIOS_PATH,
  } = options;

  const scenariosRaw = JSON.parse(fs.readFileSync(scenariosFile, "utf-8"));
  const { meta, scenarios } = scenariosRaw;

  let toRun = scenarios;
  if (limit && limit < scenarios.length) {
    toRun = scenarios.slice(0, limit);
    console.log(`\n[eval] Running ${limit}/${scenarios.length} scenarios (limit)`);
  } else {
    console.log(`\n[eval] Running all ${scenarios.length} scenarios`);
  }

  const results = [];
  let rateLimitedCount = 0;
  let errorsCount = 0;

  for (let i = 0; i < toRun.length; i++) {
    const scenario = toRun[i];
    console.log(`\n[${i + 1}/${toRun.length}] ${scenario.id} (${scenario.category})`);
    console.log(`  Q: ${scenario.question.slice(0, 80)}${scenario.question.length > 80 ? "..." : ""}`);

    let response;
    let error = null;

    if (offline) {
      // Offline mode: skip API call, mark as skipped
      response = { skipped: true };
      console.log(`  [offline] Skipped`);
    } else {
      try {
        const apiResult = await callChatApi(scenario.question, { baseUrl });
        response = apiResult.body;

        if (apiResult.status === 429) {
          rateLimitedCount++;
          console.log(`  [warn] Rate limited`);
        }
      } catch (err) {
        error = err.message;
        errorsCount++;
        console.log(`  [error] ${err.message}`);
        response = { error: err.message };
      }
    }

    // Score the response
    const { scoreScenario } = require("./scoring");
    const scored = offline
      ? {
          scenario_id: scenario.id,
          category: scenario.category,
          total_score: 0,
          pass: false,
          skipped: true,
          dimensions: {},
          raw_response: response,
          error: null,
          response,
        }
      : scoreScenario(scenario, response);
    scored.error = error;
    scored.response = response;
    results.push(scored);

    const status = scored.pass ? "✅" : scored.skipped ? "⏭️" : "❌";
    console.log(`  ${status} Score: ${scored.total_score.toFixed(2)}${scored.skipped ? " (offline)" : ""}`);
    if (!scored.pass) {
      const failing = Object.entries(scored.dimensions)
        .filter(([, v]) => v < 0.7)
        .map(([k, v]) => `${k}: ${v.toFixed(2)}`);
      console.log(`  Failing: ${failing.join(", ")}`);
    }

    // Delay between scenarios (except after last, skip in offline mode)
    if (i < toRun.length - 1 && delayMs > 0 && !offline) {
      await sleep(delayMs);
    }
  }

  // Aggregate
  const { aggregateResults } = require("./scoring");
  const report = aggregateResults(results);
  report.meta = meta;
  report.run_at = new Date().toISOString();
  report.rate_limited = rateLimitedCount;
  report.errors = errorsCount;

  // Save results
  fs.writeFileSync(RESULTS_PATH, JSON.stringify({ report, results }, null, 2));
  console.log(`\n[eval] Results saved to ${RESULTS_PATH}`);

  return { report, results };
}

module.exports = { runEval, callChatApi };

// CLI entry
if (require.main === module) {
  const args = process.argv.slice(2);
  const opts = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) {
      opts.limit = parseInt(args[++i], 10);
    } else if (args[i] === "--delay" && args[i + 1]) {
      opts.delayMs = parseInt(args[++i], 10);
    } else if (args[i] === "--base-url" && args[i + 1]) {
      opts.baseUrl = args[++i];
    } else if (args[i] === "--offline") {
      opts.offline = true;
    }
  }

  runEval(opts)
    .then(({ report }) => {
      console.log("\n========== SUMMARY ==========");
      console.log(`Total:       ${report.total}`);
      console.log(`Passed:      ${report.passed}`);
      console.log(`Failed:      ${report.failed}`);
      console.log(`Avg score:   ${report.avg_score.toFixed(3)}`);
      console.log(`Pass rate:   ${(report.pass_rate * 100).toFixed(1)}%`);
      console.log(`Rate-limited: ${report.rate_limited}`);
      console.log(`Errors:      ${report.errors}`);

      if (report.failing_scenarios.length > 0) {
        console.log("\nFailing scenarios:");
        for (const f of report.failing_scenarios) {
          console.log(`  - ${f.id}: ${f.score.toFixed(2)}`);
        }
      }

      console.log("\nBy category:");
      for (const [cat, stats] of Object.entries(report.by_category)) {
        console.log(`  ${cat}: ${stats.passed}/${stats.total} (${(stats.avg * 100).toFixed(0)}%)`);
      }

      console.log("\nBy dimension:");
      for (const [dim, stats] of Object.entries(report.by_dimension)) {
        console.log(`  ${dim}: ${(stats.avg * 100).toFixed(0)}%`);
      }

      const threshold = report.meta?.pass_threshold || 0.70;
      if (report.avg_score < threshold) {
        console.log(`\n⚠️  REGRESSION: avg score ${report.avg_score.toFixed(3)} below threshold ${threshold}`);
        process.exit(1);
      } else {
        console.log(`\n✅ PASS: avg score ${report.avg_score.toFixed(3)} >= threshold ${threshold}`);
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error("[eval] Fatal error:", err);
      process.exit(2);
    });
}
