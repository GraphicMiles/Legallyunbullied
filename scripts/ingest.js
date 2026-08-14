/**
 * Ingest a plain-text legal document into Firestore's `legal_provisions`
 * collection, split into per-section chunks so answers can cite an exact
 * section number instead of paraphrasing a whole Act.
 *
 * Usage:
 *   node scripts/ingest.js \
 *     --file path/to/text.txt \
 *     --act "Lagos Tenancy Law 2011" \
 *     --practice-area tenancy \
 *     --jurisdiction "Lagos State" \
 *     [--source-url "https://..."] \
 *     [--stop-at "SCHEDULE"] \
 *     [--dry-run]
 *
 * --stop-at trims the text at the first occurrence of a marker string
 * before chunking — use it to drop trailing Schedules/Forms/appendices,
 * which often reuse plain numbers (e.g. a numbered list item "35." inside
 * a Schedule) that would otherwise collide in citations with an unrelated
 * real section of the same number.
 *
 * For PDFs, run scripts/pdf-to-text.js first, review the extracted text,
 * then run this against the resulting .txt file.
 *
 * practice-area must be one of: tenancy, employment, criminal_rights,
 * contract, general (kept in sync with server/chatRoute.js's classifier).
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { getFirestore } = require("../server/firebaseAdmin");

const { PRACTICE_AREA_KEYS } = require("../server/practiceAreas");
const VALID_PRACTICE_AREAS = PRACTICE_AREA_KEYS;
const BATCH_SIZE = 400; // Firestore's write-batch limit is 500; stay comfortably under it.

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      args[key] = value;
    }
  }
  return args;
}

// Matches the start of a numbered section in typical Nigerian statute
// formatting, e.g. "13. Right to personal liberty." or "13.—(1) Every person...".
// Tune this per-document if a source uses different numbering conventions.
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
    .filter((c) => c.text.length > 20); // drop noise/near-empty matches (page numbers, etc.)
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const missing = ["file", "act", "practice-area", "jurisdiction"].filter((k) => !args[k]);
  if (missing.length) {
    console.error(`Missing required args: ${missing.join(", ")}\n`);
    console.error(
      'Usage: node scripts/ingest.js --file <path.txt> --act "<Act name>" --practice-area <key> --jurisdiction "<Jurisdiction>" [--source-url <url>] [--stop-at "<text marker>"] [--dry-run]'
    );
    process.exit(1);
  }

  if (!VALID_PRACTICE_AREAS.includes(args["practice-area"])) {
    console.error(`--practice-area must be one of: ${VALID_PRACTICE_AREAS.join(", ")}`);
    process.exit(1);
  }

  let text = fs.readFileSync(path.resolve(args.file), "utf8");

  if (args["stop-at"]) {
    const cutIndex = text.indexOf(args["stop-at"]);
    if (cutIndex !== -1) {
      const dropped = text.length - cutIndex;
      text = text.slice(0, cutIndex);
      console.log(`--stop-at matched "${args["stop-at"]}" — trimmed ${dropped} trailing characters (e.g. Schedules/Forms) before chunking.`);
    } else {
      console.warn(`--stop-at "${args["stop-at"]}" was not found in the text — nothing trimmed.`);
    }
  }
  const chunks = chunkBySections(text);

  if (!chunks.length) {
    console.error(
      "No sections detected. Check the extracted text's formatting, or adjust the SECTION_HEADER regex in this script for this document's numbering style."
    );
    process.exit(1);
  }

  console.log(`Parsed ${chunks.length} sections from "${args.act}".`);
  console.log("First section preview:\n---\n" + chunks[0].text.slice(0, 200) + "\n---");

  if (args["dry-run"]) {
    console.log("\n--dry-run set: not writing to Firestore. Re-run without it to commit.");
    return;
  }

  const db = getFirestore();
  if (!db) {
    console.error("Firestore isn't configured — set FIREBASE_SERVICE_ACCOUNT_JSON.");
    process.exit(1);
  }

  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `${label} timed out after ${ms}ms (likely a Firestore quota/rate-limit issue — the Admin SDK can hang silently on 429s instead of throwing quickly; try again later or check the Blaze plan upgrade)`
              )
            ),
          ms
        )
      ),
    ]);
  }

  const collection = db.collection("legal_provisions");
  const now = new Date().toISOString();

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const slice = chunks.slice(i, i + BATCH_SIZE);

    slice.forEach((chunk, sliceIndex) => {
      // Include a running index in the doc ID, not just the section number.
      // Schedules/appendices in real statutes often reuse plain numbers
      // (e.g. a numbered list item "35." inside a Schedule, unrelated to
      // substantive "section 35") — a section-number-only ID would silently
      // overwrite an earlier, unrelated chunk with the same number.
      const globalIndex = i + sliceIndex;
      const id = `${args.act}-s${chunk.section}-${globalIndex}`.replace(/[^a-zA-Z0-9-]+/g, "_");
      batch.set(collection.doc(id), {
        act: args.act,
        section: chunk.section,
        practice_area: args["practice-area"],
        jurisdiction: args.jurisdiction,
        text: chunk.text,
        source_url: args["source-url"] || null,
        ingested_at: now,
        in_force: true,
      });
    });

    await withTimeout(batch.commit(), 20000, `Firestore commit (batch starting at ${i})`);
    console.log(`Committed ${Math.min(i + BATCH_SIZE, chunks.length)}/${chunks.length}...`);
  }


  console.log(`\nDone. Ingested ${chunks.length} sections from "${args.act}" into Firestore's legal_provisions collection.`);
}

main().catch((err) => {
  console.error("Ingestion failed:", err.message);
  process.exit(1);
});
