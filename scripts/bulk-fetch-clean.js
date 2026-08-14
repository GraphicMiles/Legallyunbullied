/**
 * Bulk-fetch + auto-clean every Act in the PLAC "2004 Laws of Nigeria" index
 * (legal_sources/manifest/placng_index.json, produced by a one-off scrape)
 * and its practice_area tag (legal_sources/manifest/placng_classified.json,
 * produced by scripts/classify-acts.js).
 *
 * Does NOT write to Firestore — writes a staging manifest
 * (legal_sources/manifest/staged.json) plus one cleaned .txt cache file per
 * Act under legal_sources/federal_acts_bulk/ so this is resumable and
 * inspectable before the real ingest step (scripts/bulk-ingest-firestore.js).
 *
 * Usage: node scripts/bulk-fetch-clean.js [--start N] [--limit N]
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const https = require("https");
const { PDFParse } = require("pdf-parse");
const { stripHtmlToText, autoClean } = require("./lib/textClean");

const INDEX_PATH = path.join(__dirname, "../legal_sources/manifest/placng_index.json");
const CLASSIFIED_PATH = path.join(__dirname, "../legal_sources/manifest/placng_classified.json");
const STAGED_PATH = path.join(__dirname, "../legal_sources/manifest/staged.json");
const CACHE_DIR = path.join(__dirname, "../legal_sources/federal_acts_bulk");
const RAW_CACHE_DIR = path.join(CACHE_DIR, "_raw");

fs.mkdirSync(CACHE_DIR, { recursive: true });
fs.mkdirSync(RAW_CACHE_DIR, { recursive: true });

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function httpGet(url, isBinary) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "Mozilla/5.0 (LegallyUnbullied ingestion bot)" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(httpGet(new URL(res.headers.location, url).toString(), isBinary));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(isBinary ? Buffer.concat(chunks) : Buffer.concat(chunks).toString("utf8")));
      })
      .on("error", reject)
      .setTimeout(30000, function () {
        this.destroy(new Error("timeout"));
      });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchOne(entry) {
  const slug = slugify(entry.name);
  const isPdf = entry.href.endsWith(".pdf");
  let sourceUrl;
  if (isPdf) {
    sourceUrl = `https://placng.org/lawsofnigeria/${entry.href}`;
  } else {
    const m = entry.href.match(/sn=(\d+)/);
    const sn = m ? m[1] : null;
    sourceUrl = `https://placng.org/lawsofnigeria/print.php?sn=${sn}`;
  }

  let rawText;
  if (isPdf) {
    const pdfCachePath = path.join(RAW_CACHE_DIR, `${slug}.pdf`);
    let buffer;
    if (fs.existsSync(pdfCachePath)) {
      buffer = fs.readFileSync(pdfCachePath);
    } else {
      buffer = await httpGet(sourceUrl, true);
      fs.writeFileSync(pdfCachePath, buffer);
    }
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    await parser.destroy();
    rawText = result.text;
  } else {
    const htmlCachePath = path.join(RAW_CACHE_DIR, `${slug}.html`);
    let html;
    if (fs.existsSync(htmlCachePath)) {
      html = fs.readFileSync(htmlCachePath, "utf8");
    } else {
      html = await httpGet(sourceUrl, false);
      fs.writeFileSync(htmlCachePath, html);
    }
    rawText = stripHtmlToText(html);
  }

  const { cleaned, stats } = autoClean(rawText);
  const cleanedPath = path.join(CACHE_DIR, `${slug}.txt`);
  fs.writeFileSync(cleanedPath, cleaned, "utf8");

  return { slug, sourceUrl, sourceType: isPdf ? "pdf" : "html", cleanedPath, stats, rawLength: rawText.length };
}

function titleCase(name) {
  return name
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bOf\b/g, "of")
    .replace(/\bAnd\b/g, "and")
    .replace(/\bThe\b/g, "the")
    .replace(/\bEtc\b\.?/gi, "Etc.");
}

async function main() {
  const args = { reclean: false };
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === "--start") args.start = parseInt(process.argv[++i], 10);
    if (process.argv[i] === "--limit") args.limit = parseInt(process.argv[++i], 10);
    if (process.argv[i] === "--reclean") args.reclean = true;
  }

  const classified = JSON.parse(fs.readFileSync(CLASSIFIED_PATH, "utf8"));
  const index = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
  const byIdx = new Map(classified.map((c) => [c.i, c.practice_area]));

  let staged = [];
  if (fs.existsSync(STAGED_PATH)) {
    staged = JSON.parse(fs.readFileSync(STAGED_PATH, "utf8"));
  }

  if (args.reclean) {
    // Re-run autoClean against already-downloaded raw cache files, no network.
    let updated = 0;
    for (const s of staged) {
      const rawPath = path.join(RAW_CACHE_DIR, `${s.slug}.${s.sourceType}`);
      if (!fs.existsSync(rawPath)) continue;
      let rawText;
      if (s.sourceType === "pdf") {
        const buffer = fs.readFileSync(rawPath);
        const parser = new PDFParse({ data: buffer });
        const result = await parser.getText();
        await parser.destroy();
        rawText = result.text;
      } else {
        rawText = stripHtmlToText(fs.readFileSync(rawPath, "utf8"));
      }
      const { cleaned, stats } = autoClean(rawText);
      fs.writeFileSync(s.cleanedPath, cleaned, "utf8");
      s.stats = stats;
      updated++;
    }
    fs.writeFileSync(STAGED_PATH, JSON.stringify(staged, null, 2));
    console.log(`Re-cleaned ${updated} cached documents (no network calls).`);
    return;
  }

  const doneNames = new Set(staged.map((s) => s.name));

  const start = args.start || 0;
  const end = args.limit ? Math.min(index.length, start + args.limit) : index.length;

  let ok = 0;
  let failed = 0;
  const failures = [];

  for (let i = start; i < end; i++) {
    const entry = index[i];
    if (doneNames.has(entry.name)) continue;
    try {
      const result = await fetchOne(entry);
      staged.push({
        i,
        name: entry.name,
        act: titleCase(entry.name),
        practice_area: byIdx.get(i) || "general",
        ...result,
      });
      ok++;
      if (ok % 25 === 0) {
        fs.writeFileSync(STAGED_PATH, JSON.stringify(staged, null, 2));
        console.log(`Progress: ${ok} ok, ${failed} failed, at index ${i}/${end}`);
      }
    } catch (err) {
      failed++;
      failures.push({ i, name: entry.name, error: err.message });
      console.error(`FAILED [${i}] ${entry.name}: ${err.message}`);
    }
    await sleep(120); // be polite to placng.org
  }

  fs.writeFileSync(STAGED_PATH, JSON.stringify(staged, null, 2));
  console.log(`\nDone this run. ok=${ok} failed=${failed} totalStaged=${staged.length}`);
  if (failures.length) {
    const failPath = path.join(__dirname, "../legal_sources/manifest/fetch_failures.json");
    let allFailures = [];
    if (fs.existsSync(failPath)) allFailures = JSON.parse(fs.readFileSync(failPath, "utf8"));
    allFailures = allFailures.concat(failures);
    fs.writeFileSync(failPath, JSON.stringify(allFailures, null, 2));
    console.log(`Failures logged to ${failPath}`);
  }
}


main().catch((err) => {
  console.error(err);
  process.exit(1);
});
