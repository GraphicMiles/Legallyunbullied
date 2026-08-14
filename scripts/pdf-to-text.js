/**
 * Extract plain text from a PDF, as a separate step from ingestion so you
 * can eyeball/clean the extracted text before it's chunked into Firestore.
 *
 * Usage:
 *   node scripts/pdf-to-text.js --file path/to/document.pdf --out path/to/text.txt
 */

const fs = require("fs");
const path = require("path");
const { PDFParse } = require("pdf-parse");

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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    console.error("Usage: node scripts/pdf-to-text.js --file <path.pdf> [--out <path.txt>]");
    process.exit(1);
  }

  const filePath = path.resolve(args.file);
  const outPath = args.out
    ? path.resolve(args.out)
    : filePath.replace(/\.pdf$/i, ".txt");

  const buffer = fs.readFileSync(filePath);
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  await parser.destroy();

  fs.writeFileSync(outPath, result.text, "utf8");
  console.log(`Extracted ${result.total_pages || result.pages?.length || "?"} pages, ${result.text.length} characters -> ${outPath}`);
  console.log("Review/clean the text file before running scripts/ingest.js against it.");
}

main().catch((err) => {
  console.error("PDF extraction failed:", err.message);
  process.exit(1);
});
