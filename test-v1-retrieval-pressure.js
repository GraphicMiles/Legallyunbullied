/** Deterministic retrieval pressure tests for the final V1 reliability gate. */
const assert = require("assert");

const rows = [
  { id: "lagos-13", practice_area: "tenancy", act: "Lagos State Tenancy Law 2011", section: "13", text: "Section 13 requires the applicable notice to quit before recovery of possession.", jurisdiction: "Lagos State", in_force: true },
  { id: "federal-rp-8", practice_area: "tenancy", act: "Recovery of Premises Act", section: "8", text: "A tenant must receive notice before possession is recovered.", jurisdiction: "Federal", in_force: true },
  { id: "other-state", practice_area: "tenancy", act: "Kano Tenancy Law", section: "4", text: "State-specific tenancy procedure.", jurisdiction: "Kano State", in_force: true },
  { id: "land-1", practice_area: "land_property", act: "Land Use Act", section: "1", text: "Land is vested in the Governor for the use and common benefit of Nigerians.", jurisdiction: "Federal", in_force: true },
  { id: "labour-11", practice_area: "employment", act: "Labour Act", section: "11", text: "Termination requires notice according to the contract and Act.", jurisdiction: "Federal", in_force: true },
  { id: "criminal-252", practice_area: "general", act: "Criminal Code Act", section: "252", text: "A person who unlawfully strikes another commits assault.", jurisdiction: "Federal", in_force: true },
  { id: "repealed", practice_area: "general", act: "Old Criminal Act", section: "9", text: "Assault provision.", jurisdiction: "Federal", in_force: false },
  { id: "uncertain", practice_area: "general", act: "Unverified Act", section: "2", text: "Assault provision.", jurisdiction: "Federal", source_status: "unverified" },
];

let failure = null;
function makeDb() {
  return {
    collection: () => {
      let area = null;
      const query = {
        where: (_field, _op, value) => { area = value; return query; },
        limit: () => query,
        get: async () => {
          if (failure) throw new Error(failure);
          return { docs: rows.filter((r) => r.practice_area === area).map((r) => ({ id: r.id, data: () => r })) };
        },
      };
      return query;
    },
  };
}

const adminPath = require.resolve("./server/firebaseAdmin");
require.cache[adminPath] = { id: adminPath, filename: adminPath, loaded: true, exports: { getFirestore: () => makeDb() } };
const { findProvisions, findProvisionsBroad, invalidateCache, rankProvisions } = require("./server/legalCorpus");

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); }
  catch (err) { failed++; console.log(`  FAIL  ${name}\n        ${err.message}`); }
}

(async () => {
  console.log("\n=== V1 retrieval pressure tests ===\n");

  await check("exact section phrase ranks the controlling section first", async () => {
    invalidateCache();
    const found = await findProvisions({ practiceArea: "tenancy", jurisdiction: "Lagos State", keywords: ["section 13", "notice to quit"] });
    assert.strictEqual(found[0].id, "lagos-13");
  });

  await check("vague tenancy terms still return ranked tenancy authorities", async () => {
    invalidateCache();
    const found = await findProvisions({ practiceArea: "tenancy", jurisdiction: "Lagos State", keywords: ["tenant", "leave"] });
    assert.ok(found.some((p) => p.id === "lagos-13"));
  });

  await check("Federal law supplements state law but another state is excluded", async () => {
    invalidateCache();
    const found = await findProvisions({ practiceArea: "tenancy", jurisdiction: "Lagos State", keywords: ["notice"] });
    assert.ok(found.some((p) => p.id === "lagos-13"));
    assert.ok(found.some((p) => p.id === "federal-rp-8"));
    assert.ok(!found.some((p) => p.id === "other-state"));
  });

  await check("wrong primary classification can broaden to controlling general criminal law", async () => {
    invalidateCache();
    const broad = await findProvisionsBroad({ practiceArea: "criminal_offences", jurisdiction: "Federal", keywords: ["assault", "unlawfully strikes"], force: true });
    assert.ok(broad.categories.includes("general"));
    assert.ok(broad.provisions.some((p) => p.id === "criminal-252"));
  });

  await check("multi-intent tenancy/property search includes adjacent land authority", async () => {
    invalidateCache();
    const broad = await findProvisionsBroad({ practiceArea: "tenancy", jurisdiction: "Lagos State", keywords: ["tenant", "land", "possession"], force: true });
    assert.ok(broad.categories.includes("land_property"));
    assert.ok(broad.provisions.some((p) => p.id === "land-1"));
  });

  await check("repealed provisions are removed and uncertain sources are downgraded", async () => {
    invalidateCache();
    const found = await findProvisions({ practiceArea: "general", jurisdiction: "Federal", keywords: ["assault"] });
    assert.ok(!found.some((p) => p.id === "repealed"));
    const ranked = rankProvisions(rows.filter((r) => ["criminal-252", "uncertain"].includes(r.id)), { keywords: ["assault"] });
    assert.strictEqual(ranked[0].id, "criminal-252");
  });

  await check("non-quota provider/store failure is surfaced, not converted to evidence", async () => {
    invalidateCache(); failure = "permission denied";
    await assert.rejects(() => findProvisions({ practiceArea: "employment", jurisdiction: "Federal", keywords: ["wages"] }), /permission denied/);
    failure = null; invalidateCache();
  });

  console.log(failed ? `\n${failed} RETRIEVAL PRESSURE TEST(S) FAILED` : "\nALL RETRIEVAL PRESSURE TESTS PASSED");
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
