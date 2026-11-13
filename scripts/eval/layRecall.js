#!/usr/bin/env node
/**
 * Recall of plain-language questions against the in-memory legal index.
 *
 *   node scripts/eval/layRecall.js [--set scripts/eval/lay-dev.json] [--k 8] [--show-misses]
 *
 * A case hits when any of the top-k provisions belongs to an act whose name
 * contains one of the case's `expect` fragments. This is a name check, not a
 * judgement that the provision answers the question: treat a miss as "look at
 * it", and a hit as "the right statute was retrieved", not as an answer.
 *
 * Runs locally with no model calls and no Firestore reads.
 */
const fs = require("fs");
const path = require("path");
const legalIndex = require("../../server/legalIndex.js");

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const setPath = path.resolve(opt("--set", path.join(__dirname, "lay-dev.json")));
const k = parseInt(opt("--k", null) || "0", 10) || 8;
const showMisses = args.includes("--show-misses");

const set = JSON.parse(fs.readFileSync(setPath, "utf8"));
const hit = [];
const miss = [];
for (const c of set.cases) {
  const top = legalIndex.search(c.q, { k }).slice(0, k);
  const acts = top.map((p) => String(p.act || "").toLowerCase());
  const found = c.expect.some((frag) => acts.some((a) => a.includes(frag.toLowerCase())));
  (found ? hit : miss).push({ id: c.id, q: c.q, expect: c.expect, topActs: [...new Set(top.map((p) => p.act))].slice(0, 4) });
}
const summary = { set: path.basename(setPath), k, cases: set.cases.length, hit: hit.length, miss: miss.length };
console.log(JSON.stringify(summary));
if (showMisses || miss.length) {
  for (const m of miss) {
    console.log(`MISS ${m.id}: ${m.q}`);
    console.log(`   expected any of: ${m.expect.join(" | ")}`);
    console.log(`   got: ${m.topActs.join(" | ")}`);
  }
}
