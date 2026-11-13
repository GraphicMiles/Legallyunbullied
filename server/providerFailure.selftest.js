/** Run: node --test server/providerFailure.selftest.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const pf = require("./providerFailure.js");

test("a malformed reply does not cool the provider down", () => {
  pf.providerCooldowns.clear();
  const kind = pf.markProviderFailure("groq-critique:x", new Error("Critique returned an invalid schema: claim_support is missing claim IDs"));
  assert.equal(kind, "malformed_output");
  assert.equal(pf.isProviderOnCooldown("groq-critique:x"), false);
});

test("an outage still cools the provider down", () => {
  pf.providerCooldowns.clear();
  const kind = pf.markProviderFailure("groq:y", new Error("socket hang up"));
  assert.equal(kind, "provider_unavailable");
  assert.equal(pf.isProviderOnCooldown("groq:y"), true);
});

test("the old wording no longer counts as an outage", () => {
  assert.equal(pf.classifyProviderError(new Error("Critique returned an invalid claim_support schema")), "provider_unavailable");
  assert.equal(pf.classifyProviderError(new Error("Failed to parse JSON from model")), "malformed_output");
});

test("rate limit gets a short cooldown, auth a long one", () => {
  pf.providerCooldowns.clear();
  pf.markProviderFailure("a", Object.assign(new Error("rate limit"), { status: 429 }));
  pf.markProviderFailure("b", Object.assign(new Error("bad key"), { status: 401 }));
  const a = pf.providerCooldowns.get("a") - Date.now();
  const b = pf.providerCooldowns.get("b") - Date.now();
  assert.ok(a > 50_000 && a <= 60_000, `a=${a}`);
  assert.ok(b > 29 * 60_000, `b=${b}`);
});
