#!/usr/bin/env node
const { spawnSync } = require("node:child_process");

// Fast deterministic server/regression suite. Browser suites remain separate
// because they require Playwright OS packages; live evals require credentials.
const tests = [
  "test-conversation-identity.js",
  "test-server-pagination.js",
  "test-legal-intent.js",
  "test-retrieval-evidence.js",
  "test-v1-retrieval-pressure.js",
  "test-v1-followup-pressure.js",
  "test-procedural-hedging.js",
  "test-recoverable-request.js",
  "test-job-queue.js",
  "test-safety-ack-restart.js",
  "test-v2-guardrails.js",
];

let failed = 0;
for (const file of tests) {
  console.log(`\n===== ${file} =====`);
  const result = spawnSync(process.execPath, [file], { stdio: "inherit", cwd: process.cwd() });
  if (result.status !== 0) failed += 1;
}

if (failed) {
  console.error(`\n${failed} test file(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${tests.length} deterministic test files passed.`);
