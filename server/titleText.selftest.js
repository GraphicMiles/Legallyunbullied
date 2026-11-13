/** Run: node --test server/titleText.selftest.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const { cleanTitle, MAX_TITLE_CHARS } = require("./titleText.js");

test("a plain title passes through unchanged", () => {
  assert.equal(cleanTitle("Landlord lockout dispute"), "Landlord lockout dispute");
});

test("only the first line of a multi-option reply is used", () => {
  assert.equal(
    cleanTitle("Landlord lockout dispute\nAlternative: Tenant eviction rights\nOther: Rent"),
    "Landlord lockout dispute"
  );
});

test("numbering, labels, quotes and trailing punctuation are removed", () => {
  assert.equal(cleanTitle("1. Landlord lockout dispute."), "Landlord lockout dispute");
  assert.equal(cleanTitle("- Title: Unpaid salary claim!"), "Unpaid salary claim");
  assert.equal(cleanTitle('"Police detention rights"'), "Police detention rights");
  assert.equal(cleanTitle("**Company registration process**"), "Company registration process");
});

test("several options on one line keep the first", () => {
  assert.equal(cleanTitle("Landlord lockout / Rent dispute"), "Landlord lockout");
  assert.equal(cleanTitle("Unpaid salary | Wage claim"), "Unpaid salary");
});

test("a long title is truncated at a word boundary with an ellipsis", () => {
  const long =
    "Whether my landlord can lawfully change the locks on my flat while I was away on a long trip";
  const out = cleanTitle(long);
  assert.ok(out.endsWith("…"));
  assert.ok(out.length <= MAX_TITLE_CHARS + 1);
  assert.ok(long.startsWith(out.slice(0, -1)));
  assert.ok(!/\s…$/.test(out));
});

test("empty, non-string and symbol-only replies give no title", () => {
  assert.equal(cleanTitle(""), null);
  assert.equal(cleanTitle("   \n  \n"), null);
  assert.equal(cleanTitle(null), null);
  assert.equal(cleanTitle("***"), null);
});
