/**
 * Self-test for gates.js. Run: node scripts/eval/gates.selftest.js
 * Uses node:test, so no extra dependency.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { gateTurn, gateRun, percentile } = require("./gates.js");

const law = (lawMd, claims, sources = 1) => ({
  response: { result: { lawMd, actionsMd: "", sources: Array.from({ length: sources }, (_, i) => ({ id: `s${i}` })), claims } },
  retrieved: { sourceCount: sources },
  httpStatus: 200,
  elapsedMs: 3000,
});

const supportedClaim = { claimId: "c1", text: "one month notice", provisionIds: ["p1"], evidenceLink: "retrieved", verifiedSpan: true };
const unsupportedClaim = { claimId: "c2", text: "x", provisionIds: [], evidenceLink: "unsupported" };

test("G2: law content with zero sources fails", () => {
  const t = gateTurn("s", law("Under s.13 one month notice applies.", [supportedClaim], 0));
  assert.ok(t.issues.some((i) => i.startsWith("G2")));
});

test("G3: a retrieved claim without a verified span is not enough", () => {
  const t = gateTurn("s", law("One month notice applies.", [{ ...supportedClaim, verifiedSpan: undefined }]));
  assert.ok(t.issues.some((i) => i.startsWith("G3")));
});

test("G3: one unsupported claim fails the turn", () => {
  const t = gateTurn("s", law("Text.", [supportedClaim, unsupportedClaim]));
  assert.ok(t.issues.some((i) => i.startsWith("G3")));
});

test("clean sourced, span-verified answer passes every turn gate", () => {
  const t = gateTurn("s", law("One month notice applies.", [supportedClaim]));
  assert.deepEqual(t.issues, []);
  assert.equal(t.givesLaw, true);
});

test("G4: no sources and no refusal wording fails", () => {
  const t = gateTurn("s", law("You are entitled to compensation.", [], 0));
  assert.ok(t.issues.some((i) => i.startsWith("G4")) || t.issues.some((i) => i.startsWith("G2")));
});

test("G4: an honest not-in-library answer with zero sources passes", () => {
  const t = gateTurn("s", law("Our library does not yet cover this area. Please consult a lawyer.", [], 0));
  assert.deepEqual(t.issues, []);
  assert.equal(t.givesLaw, false);
});

test("G1: 5xx and transport errors fail", () => {
  const t = gateTurn("s", { response: {}, httpStatus: 503, elapsedMs: 10 });
  assert.ok(t.issues.some((i) => i.startsWith("G1")));
});

test("casual and needs-input turns are not law turns", () => {
  const casual = gateTurn("s", { response: { isCasual: true, result: { lawMd: "Hello" } }, httpStatus: 200, elapsedMs: 5 });
  assert.equal(casual.givesLaw, false);
  assert.deepEqual(casual.issues, []);
});

test("percentile handles empty and ordered input", () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([1, 2, 3, 4, 5], 50), 3);
  assert.equal(percentile([1, 2, 3, 4, 5], 95), 5);
});

test("gateRun: the old baseline pattern (sourceless law answers) fails the run", () => {
  const records = [
    { id: "a", turns: [law("Tenant gets one month.", [], 0)] },
    { id: "b", turns: [law("Under s.24 court possession applies.", [supportedClaim], 1)] },
  ];
  const report = gateRun(records, { maxP95Ms: 8000 });
  assert.equal(report.pass, false);
  assert.equal(report.gates.G2_sourced_law, false);
  assert.equal(report.gates.G1_transport, true);
});

test("gateRun: all clean turns with p95 under budget pass", () => {
  const records = [{ id: "a", turns: [law("One month.", [supportedClaim]), law("Two weeks.", [supportedClaim])] }];
  const report = gateRun(records, { maxP95Ms: 8000 });
  assert.equal(report.pass, true);
  assert.equal(report.gates.G5_latency_p95_under_budget, true);
});

test("gateRun: p95 over budget fails G5 only", () => {
  const slow = { ...law("One month.", [supportedClaim]), elapsedMs: 20000 };
  const report = gateRun([{ id: "a", turns: [slow] }], { maxP95Ms: 8000 });
  assert.equal(report.gates.G5_latency_p95_under_budget, false);
  assert.equal(report.gates.G2_sourced_law, true);
});

test("refusal detector: real refusals match, ordinary legal wording does not", () => {
  const { NOT_IN_LIBRARY } = require("./gates.js");
  for (const ok of ["Our library does not yet cover this area.", "This is not in our library yet.", "No ingested legal sources match this yet.", "This is not sourced yet."]) {
    assert.equal(NOT_IN_LIBRARY.test(ok), true, ok);
  }
  for (const legal of ["The tenant is not in default of rent.", "The landlord is not in breach if notice is given.", "This Act does not cover premises owned by the State.", "Under s.24 the court can order possession."]) {
    assert.equal(NOT_IN_LIBRARY.test(legal), false, legal);
  }
});

test("scorer hard gate: sourceless law fails, honest refusal passes, casual is exempt", () => {
  const { hardGateIssues } = require("./scoring100.js");
  const sig = (result, sourceCount, extra = {}) => ({ mainTurn: { response: { result, evidence: { sourceCount }, ...extra } } });
  assert.equal(hardGateIssues(sig({ lawMd: "One month notice applies.", actionsMd: "" }, 0)).length, 1);
  assert.equal(hardGateIssues(sig({ lawMd: "Our library does not yet cover this area.", actionsMd: "" }, 0)).length, 0);
  assert.equal(hardGateIssues(sig({ lawMd: "One month notice applies.", actionsMd: "" }, 2)).length, 0);
  assert.equal(hardGateIssues(sig({ lawMd: "Hello!", actionsMd: "" }, 0, { isCasual: true })).length, 0);
});
