/**
 * Regression: verifier must not false-positive on anaphoric references to the
 * act already cited ("the Act", "this Act", "the said Act") while still
 * flagging genuine foreign citations.
 *
 * Run: node test-anaphoric-citations.js
 */
const assert = require("assert");
const { verifyAndResolveCitations } = require("./server/evidence.js");

const CAMA = [{ id: "x", provisionId: "x", act: "Companies and Allied Matters Act", section: "35", text: "s35" }];

// Token-collapse regression: models sometimes emit `**Act Label, s.N**
// [[token]]` despite being told not to. After token substitution the same
// label renders twice. The collapse must be exact-match-only so two
// different provisions cited back-to-back are preserved.
const dupDraft = {
  lawMd: "The **Companies and Allied Matters Act, s.35** [[x]] says documents are delivered.",
  actionsMd: "step", provisionIds: ["x"],
  claims: [{ claimId: "c1", text: "grounded", provisionIds: ["x"] }],
  sources: [], escalate: false, escalateReason: "", followUps: ["q?"],
};
verifyAndResolveCitations(dupDraft, CAMA);
assert.ok(!dupDraft.lawMd.includes("s.35** **Companies and Allied Matters Act, s.35**"), "adjacent duplicate labels must collapse");
assert.ok(dupDraft.lawMd.includes("**Companies and Allied Matters Act, s.35**"), "label must remain once");
console.log("  ok  adjacent duplicate labels collapse to one");

const twoDistinct = {
  lawMd: "See [[x]] alongside [[y]].",
  actionsMd: "step", provisionIds: ["x", "y"],
  claims: [{ claimId: "c1", text: "grounded", provisionIds: ["x", "y"] }],
  sources: [], escalate: false, escalateReason: "", followUps: ["q?"],
};
verifyAndResolveCitations(twoDistinct, [
  ...CAMA,
  { id: "y", provisionId: "y", act: "Administration of Criminal Justice Act 2015", section: "112", text: "s112" },
]);
assert.ok(twoDistinct.lawMd.includes("s.35** alongside **Administration of Criminal Justice Act 2015, s.112**"), "distinct adjacent citations must be preserved verbatim: " + twoDistinct.lawMd);
console.log("  ok  two different adjacent citations are preserved");

function verify(lawMd) {
  return verifyAndResolveCitations({
    lawMd, actionsMd: "step", provisionIds: ["x"],
    claims: [{ claimId: "c1", text: "grounded", provisionIds: ["x"] }],
    sources: [], escalate: false, escalateReason: "", followUps: ["q?"],
  }, CAMA);
}

const cases = [
  { label: "anaphoric 'the Act' at sentence end", lawMd: "The memorandum and articles must comply with the provisions of the Act [[x]].", wantValid: true },
  { label: "named foreign act still flagged", lawMd: "Under the Insurance Brokers Act [[x]] filings differ.", wantValid: false },
  { label: "unretrieved numbered section still flagged", lawMd: "Cited [[x]]. Section 36 also governs registration.", wantValid: false },
  { label: "retrieved act referenced by name", lawMd: "The Companies and Allied Matters Act [[x]] governs this.", wantValid: true },
  { label: "anaphoric 'the said Act'", lawMd: "Do X under the said Act [[x]].", wantValid: true },
  { label: "bare 'Act' mid-sentence after the", lawMd: "You must comply with the Act. [[x]]", wantValid: true },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const got = verify(c.lawMd).valid;
  const ok = got === c.wantValid;
  console.log((ok ? "  ok  " : "  FAIL ") + c.label + " → valid=" + got);
  ok ? pass++ : fail++;
}
console.log(`\nanaphoric-citations: ${pass} pass, ${fail} fail`);
if (fail) process.exit(1);
