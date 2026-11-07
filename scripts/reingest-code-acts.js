#!/usr/bin/env node
/**
 * One-time re-ingest of the three code acts that ship in the repo corpus but
 * were missing/stale in Firestore:
 *
 *   criminal-code-act                              — old enabling-Act-only docs (~4KB) are replaced
 *   penal-code-northern-states-federal-provisions-act — same situation
 *   penal-code-act-fct                             — brand new entry (never uploaded)
 *
 * Writes are deterministic: doc IDs derive from act+section+position, and every
 * write is a set(), so re-running --apply is safe and idempotent. Old
 * enabling-only documents are identified explicitly, validated to be the stale
 * ~4KB copies, and deleted BEFORE any new write is attempted.
 *
 * Usage:
 *   node scripts/reingest-code-acts.js            (dry-run: prints the plan, writes nothing)
 *   node scripts/reingest-code-acts.js --apply    (deletes stale enabling-only docs, writes new ones)
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { getFirestore } = require("../server/firebaseAdmin");
const { invalidateCache } = require("../server/legalCorpus");
const { splitSections } = require("../server/localLegalCorpus");

const SLUGS = [
  "criminal-code-act",
  "penal-code-northern-states-federal-provisions-act",
  "penal-code-act-fct",
];
const ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "legal_sources/manifest/staged.json");
const BATCH_SIZE = 400;
const MAX_STALE_DOC_BYTES = 20000; // stale enabling-only copies are ~4KB — anything bigger is NOT stale
const apply = process.argv.includes("--apply");

function loadStagedEntries() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  return SLUGS.map((slug) => {
    const item = manifest.find((it) => it.slug === slug);
    if (!item) throw new Error(`staged.json is missing slug "${slug}"`);
    return { slug, ...item };
  });
}

function buildDocs(entries) {
  const docs = [];
  for (const item of entries) {
    const text = fs.readFileSync(item.cleanedPath, "utf8");
    const best = new Map(); // (act, section) -> longest section text; mirrors the local corpus dedupe
    for (const section of splitSections(text)) {
      const prev = best.get(section.section);
      if (!prev || section.text.length > prev.text.length) best.set(section.section, section);
    }
    let index = 0;
    for (const section of best.values()) {
      const id = `${item.act}-s${section.section}-${index++}`.replace(/[^a-zA-Z0-9-]+/g, "_").slice(0, 500);
      docs.push({
        id,
        act: item.act,
        section: section.section,
        text: section.text,
        practice_area: item.practice_area || "criminal_offences",
        jurisdiction: "Federal",
        source_url: item.sourceUrl,
        bulk_source: "repo_corpus_reingest_2026-11-07",
      });
    }
  }
  return docs;
}

async function fetchExisting(db, act) {
  const snap = await db.collection("legal_provisions").where("act", "==", act).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function classifyStale(docs, act) {
  const stale = [];
  for (const doc of docs) {
    const len = (doc.text || "").length;
    const isCompendium = doc.bulk_source === "placng_2004_compendium";
    if (len < MAX_STALE_DOC_BYTES && isCompendium) stale.push(doc);
    else {
      // Anything unexpected means our assumptions about this act's history failed — stop before deleting or writing.
      throw new Error(
        `Unexpected existing document for "${act}" (id=${doc.id}, section=${doc.section}, bytes=${len}, bulk_source=${doc.bulk_source || "n/a"}). ` +
          "Not deleting or overwriting blindly — inspect and adjust the script."
      );
    }
  }
  return stale;
}

async function batchedCommit(db, ops) {
  for (let i = 0; i < ops.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const slice = ops.slice(i, i + BATCH_SIZE);
    for (const op of slice) op(batch);
    await batch.commit();
    console.log(`  committed ${Math.min(i + BATCH_SIZE, ops.length)}/${ops.length}`);
  }
}

(async () => {
  const entries = loadStagedEntries();
  const docs = buildDocs(entries);
  console.log("Planned new documents:");
  const byAct = new Map();
  for (const doc of docs) byAct.set(doc.act, (byAct.get(doc.act) || 0) + 1);
  for (const [act, n] of byAct) console.log(`  ${act}: ${n}`);
  console.log(`  TOTAL: ${docs.length} provisions (~${docs.length} writes)`);

  const beforeSnap = await (async () => {
    const db = getFirestore();
    if (!db) throw new Error("Firestore not configured (FIREBASE_SERVICE_ACCOUNT_JSON missing)");
    return db;
  })();

  console.log("\nExisting documents to replace (stale enabling-only copies):");
  const staleByAct = new Map();
  for (const item of entries) {
    const existing = await fetchExisting(beforeSnap, item.act);
    const stale = classifyStale(existing, item.act); // throws on anything unexpected
    staleByAct.set(item.act, stale);
    console.log(`  ${item.act}: ${existing.length} found -> ${stale.length} stale (will delete), ${existing.length - stale.length} unexpected`);
    for (const d of stale.slice(0, 3)) {
      console.log(`    - ${d.id} | s.${d.section} | ${(d.text || "").length}B | ${JSON.stringify((d.text || "").slice(0, 60))}`);
    }
  }

  const totalStale = [...staleByAct.values()].reduce((n, l) => n + l.length, 0);
  console.log(`\nTotal: delete ${totalStale} stale docs, write ${docs.length} new docs.`);

  if (!apply) {
    console.log("\nDry run — nothing was written. Re-run with --apply to execute.");
    process.exit(0);
  }

  const now = new Date().toISOString();

  console.log("\nDeleting stale enabling-only documents...");
  const deleteOps = [...staleByAct.values()].flat().map((doc) => (batch) => batch.delete(beforeSnap.collection("legal_provisions").doc(doc.id)));
  if (deleteOps.length) await batchedCommit(beforeSnap, deleteOps);

  console.log("\nWriting new documents (set is idempotent)...");
  const writeOps = docs.map((doc) => (batch) =>
    batch.set(beforeSnap.collection("legal_provisions").doc(doc.id), {
      act: doc.act,
      section: doc.section,
      practice_area: doc.practice_area,
      jurisdiction: doc.jurisdiction,
      text: doc.text,
      source_url: doc.source_url,
      ingested_at: now,
      in_force: true,
      bulk_source: doc.bulk_source,
    })
  );
  await batchedCommit(beforeSnap, writeOps);

  const cnt = await beforeSnap.collection("legal_provisions").count().get();
  console.log(`\nDone. legal_provisions now holds ~${cnt.data().count} documents.`);
  invalidateCache();
  console.log("Corpus cache invalidated.");
  process.exit(0);
})().catch((err) => {
  console.error("\nSTOPPED:", err.message);
  process.exit(1);
});
