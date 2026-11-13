/** Run: node --test server/legalIndex.selftest.js  (needs node_modules-free; uses only local files) */
const test = require("node:test");
const assert = require("node:assert/strict");
const idx = require("./legalIndex.js");

test("tokenizer rejoins OCR hyphenated line breaks", () => {
  assert.deepEqual(idx.tokenize("an em-\nployer shall"), ["employer", "shall"]);
});

test("index covers the whole local corpus (no practice-area buckets)", () => {
  const s = idx.stats();
  assert.ok(s.provisions > 15000, `provisions=${s.provisions}`);
});

test("tenancy notice question finds Lagos Tenancy Law s.13 first", () => {
  const top = idx.search("My landlord wants me out, the tenancy is monthly. How much notice?", { k: 3 });
  assert.equal(top[0].act, "Lagos State Tenancy Law 2011");
  assert.equal(top[0].section, "13");
});

test("termination-by-notice question finds Labour Act s.11", () => {
  const top = idx.search("termination of contract by notice worker", { k: 3 });
  assert.equal(top[0].act, "Labour Act");
  assert.equal(top[0].section, "11");
});

test("unlawful access question finds Cybercrimes Act", () => {
  const top = idx.search("unlawful access to computer system", { k: 3 });
  assert.ok(top.some((t) => t.act.startsWith("Cybercrimes")));
});

test("results carry source status so unreviewed bulk text is never shown as reviewed", () => {
  const top = idx.search("employer owes me wages for 3 months", { k: 5 });
  for (const t of top) {
    assert.equal(typeof t.reviewed, "boolean");
    if (t.sourceStatus === "bulk_unverified") assert.equal(t.reviewed, false);
  }
});

test("empty and stopword-only queries return nothing", () => {
  assert.deepEqual(idx.search("", { k: 3 }), []);
  assert.deepEqual(idx.search("what is the", { k: 3 }), []);
});

test("coverage is between 0 and 1", () => {
  const q = "landlord tenancy notice";
  const top = idx.search(q, { k: 1 })[0];
  const c = idx.idfCoverage(q, top);
  assert.ok(c >= 0 && c <= 1, String(c));
});

test("lay-word expansion adds legal terms and keeps the original words", () => {
  const q = idx.expandQuery("someone hacked my bank");
  assert.ok(q.includes("someone hacked my bank"));
  assert.ok(q.includes("unlawful access"));
});

test("expansion can be switched off", () => {
  const off = idx.search("someone hacked my bank", { k: 5, expand: false });
  const on = idx.search("someone hacked my bank", { k: 5 });
  assert.ok(on.some((t) => t.act.startsWith("Cybercrimes")));
  assert.ok(Array.isArray(off));
});
