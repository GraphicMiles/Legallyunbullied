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
