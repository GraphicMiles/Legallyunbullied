/** Run: node --test server/evidence.selftest.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const { verifyAndResolveCitations } = require("./evidence.js");

const provisions = [
  { id: "lag-13", act: "Lagos State Tenancy Law 2011", section: "13", text: "A monthly tenancy requires one month notice.", jurisdiction: "Lagos State", reviewed: true },
];
const draft = (lawMd) => ({
  lawMd,
  actionsMd: "- Keep records.",
  claims: [{ claimId: "c1", text: "one month", provisionIds: ["lag-13"] }],
  provisionIds: ["lag-13"],
  sources: [],
});

test("a known citation token becomes a bold official label", () => {
  const out = draft("Notice is one month [[lag-13]].");
  verifyAndResolveCitations(out, provisions);
  assert.match(out.lawMd, /\*\*Lagos State Tenancy Law 2011, s\.13\*\*/);
});

test("an unknown citation token is removed, with no placeholder text", () => {
  const out = draft("Notice is six months [[made-up-99]]. The rule is clear.");
  const v = verifyAndResolveCitations(out, provisions);
  assert.equal(out.lawMd.includes("[[") || out.lawMd.includes("unsupported"), false);
  assert.equal(out.lawMd.includes("[unsupported citation removed]"), false);
  assert.equal(out.lawMd, "Notice is six months. The rule is clear.");
  assert.ok(v.unknownIds.includes("made-up-99"), "unknown ID is still recorded");
});

test("removing a token does not leave a space before punctuation", () => {
  const out = draft("Pay within 7 days [[made-up-1]].");
  verifyAndResolveCitations(out, provisions);
  assert.equal(out.lawMd, "Pay within 7 days.");
});

test("a repeated label next to a known token is still collapsed", () => {
  const out = draft("**Lagos State Tenancy Law 2011, s.13** [[lag-13]] applies.");
  verifyAndResolveCitations(out, provisions);
  assert.equal((out.lawMd.match(/Tenancy Law 2011, s\.13/g) || []).length, 1);
});
