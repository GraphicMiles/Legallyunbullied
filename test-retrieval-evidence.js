/**
 * Unit tests for the retrieval-evidence fixes.
 *
 * Verifies:
 *   1. findProvisionsBroad merges the primary category with keyword-filtered
 *      "general" provisions when the primary category is sparse, dedupes by
 *      id, and reports which categories were searched.
 *   2. findProvisionsBroad does NOT broaden when the primary category already
 *      has enough sources.
 *   3. Scoring flags hedging/self-correction language in generated text.
 *   4. Scoring fails a "confident" answer with too few sources and passes an
 *      honest insufficient-evidence + escalate response.
 *
 * Run: node test-retrieval-evidence.js
 */

const assert = require("assert");
const path = require("path");

// ── Mock Firestore for legalCorpus ────────────────────────────────────────
function makeMockFirestore(areaDocs) {
  // Flat doc list with practice_area in each doc (mirrors legal_provisions).
  const docs = [];
  for (const [area, list] of Object.entries(areaDocs)) {
    for (const d of list) docs.push({ ...d, practice_area: area });
  }

  let filters = [];
  const coll = {
    where: (field, op, val) => { filters.push({ field, op, val }); return coll; },
    limit: () => coll,
    orderBy: () => coll,
    count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
    doc: (id) => ({ id, get: async () => ({ exists: false, data: () => ({}) }) }),
    get: async () => {
      let out = docs;
      for (const f of filters) {
        if (f.op === "==") out = out.filter((d) => d[f.field] === f.val);
      }
      filters = [];
      return { docs: out.map((d) => ({ id: d.id, data: () => d })) };
    },
  };

  return {
    collection: (name) => {
      filters = [];
      return coll;
    },
    batch: () => ({ set() {}, delete() {}, commit: async () => {} }),
    settings: () => {},
  };
}

// ── Wire mock into legalCorpus ────────────────────────────────────────────
const adminPath = require.resolve("./server/firebaseAdmin");
const mockDb = makeMockFirestore({
  criminal_offences: [
    { id: "robfire-s11", act: "Robbery and Firearms (Special Provisions) Act", section: "11", text: "assault means striking...", jurisdiction: "Federal" },
  ],
  general: [
    { id: "cc-s252", act: "Criminal Code Act", section: "252", text: "assault is unlawfully striking...", jurisdiction: "Federal" },
    { id: "cc-s253", act: "Criminal Code Act", section: "253", text: "punishment for assault...", jurisdiction: "Federal" },
    { id: "cc-s400", act: "Criminal Code Act", section: "400", text: "stealing definition...", jurisdiction: "Federal" },
  ],
});

require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: { getFirestore: () => mockDb },
};

const { findProvisionsBroad, findProvisions } = require("./server/legalCorpus");
const { scoreScenario } = require("./server/eval/scoring.js");

let failures = 0;
function check(name, fn) {
  return fn().then(() => console.log(`  PASS  ${name}`)).catch((err) => {
    failures += 1;
    console.log(`  FAIL  ${name}\n        ${err.message}`);
  });
}

async function main() {
  console.log("\n=== Retrieval-evidence tests ===\n");

  await check("findProvisionsBroad broadens into 'general' when primary is sparse", async () => {
    const { provisions, categories } = await findProvisionsBroad({
      practiceArea: "criminal_offences",
      jurisdiction: "Federal",
      keywords: ["assault"],
      minSources: 3,
    });
    assert.strictEqual(categories.includes("general"), true, "general category should be searched");
    // primary (1) + keyword-filtered general (assault matches cc-s252, cc-s253)
    assert.ok(provisions.length >= 2, `expected >= 2 provisions, got ${provisions.length}`);
    const acts = new Set(provisions.map((p) => p.act));
    assert.ok(acts.has("Criminal Code Act"), "broadened search must include the Criminal Code");
    // dedupe: no duplicate ids
    const ids = provisions.map((p) => p.id);
    assert.strictEqual(new Set(ids).size, ids.length, "no duplicate provision ids");
  });

  await check("findProvisionsBroad does not broaden when primary is sufficient", async () => {
    const primary = await findProvisions({ practiceArea: "general", jurisdiction: "Federal", keywords: ["assault"] });
    const { provisions, categories } = await findProvisionsBroad({
      practiceArea: "general",
      jurisdiction: "Federal",
      keywords: ["assault"],
      minSources: 1,
    });
    assert.strictEqual(categories.length, 1, "should not add general when primary already suffices");
    assert.deepStrictEqual(provisions, primary, "provisions should equal the primary result");
  });

  await check("scoring flags hedging language in generated text", async () => {
    const r = scoreScenario(
      { id: "t1", category: "retrieval_accuracy", expected: {} },
      {
        result: {
          lawMd: "The Robbery and Firearms Act s.11 defines assault. However, this Act primarily deals with robbery and firearms. For a more direct application, we would look at general criminal law.",
          actionsMd: "- Step 1: x",
        },
      }
    );
    assert.strictEqual(r.dimensions.hedging_language, 0, "hedging should fail the scenario");
  });

  await check("scoring passes clean text (no hedging)", async () => {
    const r = scoreScenario(
      { id: "t2", category: "retrieval_accuracy", expected: {} },
      {
        result: {
          lawMd: "Under section 252 of the Criminal Code Act, assault is a crime...",
          actionsMd: "- Step 1: report to police",
        },
      }
    );
    assert.strictEqual(r.dimensions.hedging_language, 1, "no hedging should pass");
  });

  await check("scoring fails a confident answer with too few sources", async () => {
    const r = scoreScenario(
      { id: "t3", category: "retrieval_accuracy", expected: {} },
      {
        result: { escalate: false, lawMd: "x", actionsMd: "y", sources: [{ label: "Robbery and Firearms Act, s.11" }] },
        evidence: { sufficient: true, sourceCount: 1, minSources: 2 },
      }
    );
    assert.strictEqual(r.dimensions.evidence_sufficiency, 0, "confident + 1 source should fail");
  });

  await check("scoring passes honest insufficient-evidence + escalate", async () => {
    const r = scoreScenario(
      { id: "t4", category: "retrieval_accuracy", expected: {} },
      {
        result: { escalate: true, lawMd: "I found limited directly relevant statutes...", actionsMd: "- Step 1: x" },
        evidence: { sufficient: false, sourceCount: 0, minSources: 2 },
      }
    );
    assert.strictEqual(r.dimensions.evidence_sufficiency, 1, "honest insufficient + escalate should pass");
  });

  await check("scoring fails insufficient evidence presented without escalation", async () => {
    const r = scoreScenario(
      { id: "t5", category: "retrieval_accuracy", expected: {} },
      {
        result: { escalate: false, lawMd: "x", actionsMd: "y" },
        evidence: { sufficient: false, sourceCount: 0, minSources: 2 },
      }
    );
    assert.strictEqual(r.dimensions.evidence_sufficiency, 0, "insufficient + no escalation should fail");
  });

  await check("retrieval scenario fails must_not_cite for the old bug citation", async () => {
    const r = scoreScenario(
      { id: "t6", category: "retrieval_accuracy", expected: { must_not_cite: ["Robbery and Firearms"] } },
      {
        result: {
          lawMd: "Under the Robbery and Firearms (Special Provisions) Act, s.11...",
          actionsMd: "- Step 1: x",
          sources: [{ label: "Robbery and Firearms (Special Provisions) Act, s.11" }],
        },
      }
    );
    assert.strictEqual(r.dimensions.must_not_cite, 0, "citing Robbery and Firearms for assault should fail");
  });

  console.log(failures === 0 ? "\nALL RETRIEVAL-EVIDENCE TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
