/**
 * Corpus coverage regression — the "weak agent answer" bug.
 *
 * Root cause this locks against: staged.json claimed CAMA (566 sections)
 * but `legal_sources/federal_acts_bulk/cleaned/companies-and-allied-matters-act.txt`
 * was never generated, so addFile() silently skipped the whole act. A question
 * like "how do I register a company" retrieved only irrelevant acts
 * (Insurance Brokers! Steel Council!), the evidence gate correctly ruled it
 * insufficient, and the user got a vague checklist with no law behind it.
 *
 * Two seams are asserted:
 *  1. Every staged manifest entry has its cleaned file on disk.
 *  2. Registration-keyword retrieval in company_business puts CAMA in the
 *     top ranked results.
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = __dirname;
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "legal_sources/manifest/staged.json"), "utf8"));
const { getLocalCategory } = require("./server/localLegalCorpus");
const { rankProvisions } = require("./server/legalCorpus");

let failures = 0;
function check(label, cond) {
  if (cond) console.log(`  ok  ${label}`);
  else { failures++; console.error(`  FAIL  ${label}`); }
}

console.log("corpus-coverage checks:");
const missing = manifest
  .map((it) => it.slug)
  .filter((slug) => !fs.existsSync(path.join(ROOT, "legal_sources/federal_acts_bulk/cleaned", `${slug}.txt`)));
check(`all ${manifest.length} staged acts have cleaned text files on disk (missing: ${missing.length}${missing.length ? " — " + missing.slice(0, 5).join(", ") : ""})`, missing.length === 0);

const rows = getLocalCategory("company_business");
const cama = rows.filter((r) => /allied matters/i.test(r.act || ""));
check(`CAMA present in company_business (${cama.length} provisions)`, cama.length >= 400);

const ranked = rankProvisions(rows, { keywords: ["register", "company", "incorporate", "registration"], jurisdiction: "Federal" });
const top20acts = ranked.slice(0, 20).map((r) => r.act);
const camaRank = ranked.findIndex((r) => /allied matters/i.test(r.act || ""));
check(`CAMA in the model shortlist for 'register a company' lexicon (found at #${camaRank + 1})`, ranked.slice(0, 8).some((r) => /allied matters/i.test(r.act || "")));
const top3 = ranked.slice(0, 3).map((r) => r.act);
check(`top-3 not monopolized by a single non-CAMA act`, !(top3.every((a) => !/allied matters/i.test(a)) && new Set(top3).size === 1));

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\ncorpus-coverage PASS");
