/**
 * Ingest every already-fetched-and-cleaned Act from
 * legal_sources/manifest/staged.json into Firestore's legal_provisions
 * collection, using the same per-section chunker as scripts/ingest.js.
 *
 * This is the bulk counterpart to scripts/ingest.js's one-Act-at-a-time
 * flow — used for the ~550-Act PLAC "2004 Laws of Nigeria" federal
 * compendium (see scripts/bulk-fetch-clean.js for the fetch+clean step).
 *
 * Usage: node scripts/bulk-ingest-firestore.js [--dry-run] [--start N] [--limit N]
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { getFirestore } = require("../server/firebaseAdmin");
const { PRACTICE_AREA_KEYS } = require("../server/practiceAreas");

const STAGED_PATH = path.join(__dirname, "../legal_sources/manifest/staged.json");
const PROGRESS_PATH = path.join(__dirname, "../legal_sources/manifest/ingest_progress.json");
const BATCH_SIZE = 400;
const SECTION_HEADER = /^(\d{1,4})\.[\s—-]/;

function chunkBySections(text) {
  const lines = text.split(/\r?\n/);
  const chunks = [];
  let current = null;
  for (const line of lines) {
    const match = line.match(SECTION_HEADER);
    if (match) {
      if (current) chunks.push(current);
      current = { section: match[1], lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) chunks.push(current);
  return chunks
    .map((c) => ({ section: c.section, text: c.lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() }))
    .filter((c) => c.text.length > 20);
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms (likely a Firestore quota/rate-limit issue — the Admin SDK can hang silently on 429s instead of throwing quickly)`)), ms)),
  ]);
}

async function main() {

  const args = {};
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === "--start") args.start = parseInt(process.argv[++i], 10);
    if (process.argv[i] === "--limit") args.limit = parseInt(process.argv[++i], 10);
    if (process.argv[i] === "--dry-run") args.dryRun = true;
  }

  const staged = JSON.parse(fs.readFileSync(STAGED_PATH, "utf8"));
  const start = args.start || 0;
  const end = args.limit ? Math.min(staged.length, start + args.limit) : staged.length;
  const slice = staged.slice(start, end);

  let progress = { doneNames: [] };
  if (fs.existsSync(PROGRESS_PATH)) progress = JSON.parse(fs.readFileSync(PROGRESS_PATH, "utf8"));
  const doneSet = new Set(progress.doneNames);

  const db = args.dryRun ? null : getFirestore();
  if (!args.dryRun && !db) {
    console.error("Firestore isn't configured — set FIREBASE_SERVICE_ACCOUNT_JSON.");
    process.exit(1);
  }
  const collection = db ? db.collection("legal_provisions") : null;
  const now = new Date().toISOString();

  let totalSections = 0;
  let actsIngested = 0;
  let actsSkipped = 0;

  for (const entry of slice) {
    if (doneSet.has(entry.name)) continue;
    if (!PRACTICE_AREA_KEYS.includes(entry.practice_area)) {
      console.warn(`Skipping "${entry.name}" — invalid practice_area "${entry.practice_area}"`);
      actsSkipped++;
      continue;
    }
    if (!fs.existsSync(entry.cleanedPath)) {
      console.warn(`Skipping "${entry.name}" — cleaned file missing.`);
      actsSkipped++;
      continue;
    }
    const text = fs.readFileSync(entry.cleanedPath, "utf8");
    const chunks = chunkBySections(text);
    if (!chunks.length) {
      console.warn(`Skipping "${entry.name}" — 0 sections parsed (likely a scanned/image PDF; needs OCR).`);
      actsSkipped++;
      doneSet.add(entry.name); // don't keep retrying every run
      continue;
    }

    if (!args.dryRun) {
      for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const batch = db.batch();
        const batchSlice = chunks.slice(i, i + BATCH_SIZE);
        batchSlice.forEach((chunk, sliceIndex) => {
          const globalIndex = i + sliceIndex;
          const id = `${entry.act}-s${chunk.section}-${globalIndex}`.replace(/[^a-zA-Z0-9-]+/g, "_").slice(0, 500);
          batch.set(collection.doc(id), {
            act: entry.act,
            section: chunk.section,
            practice_area: entry.practice_area,
            jurisdiction: "Federal",
            text: chunk.text,
            source_url: entry.sourceUrl,
            ingested_at: now,
            in_force: true,
            bulk_source: "placng_2004_compendium",
          });
        });
        try {
          await withTimeout(batch.commit(), 20000, `Firestore commit for "${entry.name}"`);
        } catch (err) {
          console.error(`\nSTOPPING: ${err.message}`);
          console.error(
            "This is very likely the Firestore Spark (free) plan's daily write quota (20,000 writes/day) — " +
              "confirmed via a raw REST call returning 429 RESOURCE_EXHAUSTED during this exact failure mode. " +
              "Either wait for the daily quota reset (~midnight Pacific Time) or upgrade the Firebase project to " +
              "the Blaze (pay-as-you-go) plan, which lifts this cap (free tier usage still applies underneath it)."
          );
          progress.doneNames = Array.from(doneSet);
          fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2));
          console.log(`\nProgress saved. Acts ingested this run: ${actsIngested}, sections written: ${totalSections}.`);
          process.exit(2);
        }
      }
    }


    totalSections += chunks.length;
    actsIngested++;
    doneSet.add(entry.name);

    if (actsIngested % 20 === 0) {
      if (!args.dryRun) {
        progress.doneNames = Array.from(doneSet);
        fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2));
      }
      console.log(`Progress: ${actsIngested} acts ingested (${totalSections} sections so far)...`);
    }
  }

  progress.doneNames = Array.from(doneSet);
  if (!args.dryRun) fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2));


  console.log(
    `\nDone this run. Acts ingested: ${actsIngested}, skipped: ${actsSkipped}, sections written: ${totalSections}.` +
      (args.dryRun ? " (--dry-run, nothing written)" : "")
  );
}

main().catch((err) => {
  console.error("Bulk ingest failed:", err.message);
  process.exit(1);
});
