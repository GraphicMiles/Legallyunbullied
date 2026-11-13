/** Run: node --test server/legalPrecedence.selftest.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const { rankForPrecedence, levelOf, stateOf } = require("./legalPrecedence.js");

const row = (id, act, jurisdiction, practice_area = "tenancy", extra = {}) => ({ id, act, jurisdiction, practice_area, ...extra });
const lagosUser = { jurisdiction: "Lagos State", jurisdiction_status: "clear", practice_area: "tenancy" };

test("constitution comes before everything", () => {
  const out = rankForPrecedence([row("a", "Lagos State Tenancy Law 2011", "Lagos State"), row("c", "Constitution of the Federal Republic of Nigeria 1999", "Federal", "constitutional_rights")], lagosUser);
  assert.equal(out.provisions[0].id, "c");
});

test("another state's law is dropped when the user's state is known", () => {
  const out = rankForPrecedence([row("k", "Kano Tenancy Law", "Kano State"), row("l", "Lagos State Tenancy Law 2011", "Lagos State")], lagosUser);
  assert.deepEqual(out.provisions.map((p) => p.id), ["l"]);
  assert.equal(out.summary.droppedReasons[0], "other state's law");
});

test("another state's law is kept when the user's state is unclear", () => {
  const out = rankForPrecedence([row("k", "Kano Tenancy Law", "Kano State")], { ...lagosUser, jurisdiction_status: "unclear" });
  assert.equal(out.provisions.length, 1);
});

test("repealed provisions are dropped", () => {
  const out = rankForPrecedence([row("r", "Old Act", "Federal", "tenancy", { in_force_status: "repealed" }), row("n", "New Act", "Federal")], lagosUser);
  assert.deepEqual(out.provisions.map((p) => p.id), ["n"]);
});

test("within the same level, the user's practice area comes first", () => {
  const out = rankForPrecedence([row("g", "Some Act", "Federal", "other"), row("s", "Tenancy Act", "Federal", "tenancy")], lagosUser);
  assert.equal(out.provisions[0].id, "s");
});

test("regulations come after Acts", () => {
  const out = rankForPrecedence([row("reg", "CBN Consumer Protection Regulations 2019", "Federal", "tenancy"), row("act", "Some Act", "Federal", "tenancy")], lagosUser);
  assert.equal(out.provisions[0].id, "act");
});

test("ties keep their original relevance order", () => {
  const out = rankForPrecedence([row("x", "A Act", "Federal"), row("y", "B Act", "Federal")], lagosUser);
  assert.deepEqual(out.provisions.map((p) => p.id), ["x", "y"]);
});

test("empty and missing input", () => {
  assert.deepEqual(rankForPrecedence([], lagosUser).provisions, []);
  assert.deepEqual(rankForPrecedence(null, lagosUser).provisions, []);
});

test("helpers", () => {
  assert.equal(stateOf("Lagos State"), "lagos");
  assert.equal(stateOf("Federal"), null);
  assert.equal(levelOf({ act: "Constitution of Nigeria", jurisdiction: "Federal" }, "lagos"), 0);
});
