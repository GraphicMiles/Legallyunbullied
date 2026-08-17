/**
 * Unit tests for the deterministic legal-intent backstop (Issue 1).
 *
 * Verifies:
 *   1. Described incidents (assault, theft, threats, arrest, eviction,
 *      employment, family, debt) are always detected as legal — so a legal
 *      question can never fall through to the casual-chat short-circuit.
 *   2. Casual tone/phrasing and idioms are NOT misdetected:
 *      "hit me up", "it beats me", "shot me a message", "slap on the wrist",
 *      greetings, thanks, small talk.
 *   3. buildFallbackClassification produces a valid legal classification
 *      with a correct practice area and safe defaults.
 *
 * Run: node test-legal-intent.js
 */

const assert = require("assert");
const { detectLegalIntent, buildFallbackClassification } = require("./server/legalIntent.js");

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); }
  catch (err) { failures += 1; console.log(`  FAIL  ${name}\n        ${err.message}`); }
}

const LEGAL_CASES = [
  "someone slapped me",
  "I was slapped in the face",
  "I was punched in the face",
  "he punched my nose",
  "my neighbor threatened me",
  "he threatened to kill me",
  "someone stole my phone",
  "my phone was stolen",
  "they robbed me on the way home",
  "someone broke into my house",
  "I was beaten by my husband",
  "my husband beats me",
  "they beat me up at the market",
  "I got hit in the head with a bottle",
  "someone attacked me",
  "I was molested as a child",
  "she was raped",
  "I'm being harassed at work",
  "police arrested me without reason",
  "can I be arrested for a traffic offence",
  "my landlord evicted me",
  "my landlord locked me out of my flat",
  "my landlord changed the locks",
  "my landlord increased my rent",
  "my employer sacked me",
  "I was fired without warning",
  "they haven't paid me for 3 months",
  "my salary is unpaid",
  "my wife wants a divorce",
  "he owes me money",
  "it's a breach of contract",
  "I was discriminated against at work",
  "someone defrauded me",
  "I got scammed by a vendor",
];

const CASUAL_CASES = [
  "hi there",
  "hello",
  "good morning",
  "how are you",
  "what's up",
  "thank you so much",
  "what is the weather like in Lagos",
  "tell me a joke",
  "who are you",
  "are you a lawyer",
  "hit me up later",
  "it beats me why he did that",
  "he shot me a message yesterday",
  "she gave me a slap on the wrist for being late",
  "I want to rent a car for the weekend",
  "my phone is charged now",
  "I was fired up after the meeting",
  "arrested development is a great show",
  "the eggs were beaten before baking",
];

function main() {
  console.log("\n=== Legal-intent backstop tests ===\n");

  check("all incident phrasings are detected as legal", () => {
    for (const q of LEGAL_CASES) {
      const r = detectLegalIntent(q);
      assert.strictEqual(r.legal, true, `"${q}" must be legal (got ${r.legal})`);
    }
  });

  check("casual tone and idioms are not misdetected", () => {
    for (const q of CASUAL_CASES) {
      const r = detectLegalIntent(q);
      assert.strictEqual(r.legal, false, `"${q}" must NOT be legal (got ${r.legal})`);
    }
  });

  check("assault phrasings map to criminal_offences", () => {
    for (const q of ["someone slapped me", "I was punched in the face", "I was beaten by my husband"]) {
      const r = detectLegalIntent(q);
      assert.strictEqual(r.area, "criminal_offences", `"${q}" area=${r.area}`);
    }
  });

  check("tenancy/employment/family phrasings map to the right area", () => {
    assert.strictEqual(detectLegalIntent("my landlord evicted me").area, "tenancy");
    assert.strictEqual(detectLegalIntent("my employer sacked me").area, "employment");
    assert.strictEqual(detectLegalIntent("my wife wants a divorce").area, "family_law");
  });

  check("buildFallbackClassification is valid and legal", () => {
    const c = buildFallbackClassification("someone slapped me");
    assert.strictEqual(c.is_legal_question, true);
    assert.strictEqual(c.practice_area, "criminal_offences");
    assert.strictEqual(c.jurisdiction_status, "clear", "criminal law is federal — no jurisdiction round-trip needed");
    assert.ok(c.keywords.length > 0, "fallback must carry keywords for search");
    assert.strictEqual(c.route, "simple");
  });

  check("urgent and vulnerable-user incidents get deterministic category and urgency", () => {
    const threat = buildFallbackClassification("Someone is sending me death threats and says they are coming to my workplace");
    assert.strictEqual(threat.practice_area, "criminal_offences");
    assert.ok(["High", "Critical"].includes(threat.urgency));
    const child = buildFallbackClassification("My uncle wants to marry off my 14-year-old cousin");
    assert.strictEqual(child.practice_area, "family_law");
    assert.ok(["High", "Critical"].includes(child.urgency));
    const injury = buildFallbackClassification("I was injured by a machine at the factory");
    assert.strictEqual(injury.practice_area, "employment_labour_safety");
    assert.strictEqual(injury.needs_sourcing, true);
  });

  check("buildFallbackClassification marks state-varying areas as unclear", () => {
    const c = buildFallbackClassification("my landlord evicted me");
    assert.strictEqual(c.practice_area, "tenancy");
    assert.strictEqual(c.jurisdiction_status, "unclear", "tenancy varies by state — should ask");
  });

  console.log(failures === 0 ? "\nALL LEGAL-INTENT TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
