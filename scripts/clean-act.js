/**
 * Cleans raw PDF-extracted legal text into ingestion-ready format.
 * Outputs cleaned text and section metadata for manifest.
 */

const fs = require('fs');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input') args.input = argv[++i];
    if (argv[i] === '--output') args.output = argv[++i];
    if (argv[i] === '--manifest') args.manifest = argv[++i];
  }
  return args;
}

function cleanLegalText(text) {
  const lines = text.split(/\r?\n/);
  const cleaned = [];
  let prevLine = '';
  let consecutiveBlanks = 0;
  
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const trimmed = line.trim();
    
    // Remove page markers: -- N of M --
    if (/^--\s*\d+\s+of\s+\d+\s*--$/.test(trimmed)) continue;
    
    // Remove issue/citation tags
    if (/^\[(?:Issue|19\d{2}|20\d{2})\s/.test(trimmed)) continue;
    if (/^\[\d{4}\s*No\.\s*\d+/.test(trimmed)) continue;
    if (/^\[\d{4}\s*No\.\s*\d+[^\]]*\]$/.test(trimmed)) continue;
    
    // Remove chapter markers: CAP.L1, CAP.C1, CAP.T14, CAP.LF1, etc.
    if (/^CAP\.[A-Za-z]{1,3}\d*$/.test(trimmed)) continue;
    
    // Remove standalone act name headers (like "Labour Act" alone on a line)
    // Only if previous line was a chapter marker or blank
    if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+Act$/.test(trimmed) && 
        (/^CAP\./.test(prevLine) || !prevLine.trim())) continue;
    
    // Skip empty lines with limit
    if (!trimmed) {
      consecutiveBlanks++;
      if (consecutiveBlanks <= 1) cleaned.push('');
      prevLine = line;
      continue;
    }
    consecutiveBlanks = 0;
    
    // Clean tabs and collapse spaces
    line = line.replace(/\t+/g, ' ').replace(/\s{2,}/g, ' ');
    
    // Remove inline page markers and issue tags
    line = line.replace(/\s*--\s*\d+\s+of\s+\d+\s*--\s*/g, ' ');
    line = line.replace(/\[Issue\s+\d+\]/g, '');
    line = line.replace(/\[\d{4}\s*No\.\s*\d+[^\]]*\]/g, '');
    
    // Fix OCR underscore artifacts (_remuneration → remuneration)
    line = line.replace(/_/g, '');
    
    // Re-trim
    line = line.trim();
    if (!line) continue;
    
    // Skip lines that are ONLY a section number with no content
    if (/^\d{1,4}[\.\)]\s*$/.test(line)) continue;
    
    // Skip lines that are ONLY a subsection marker
    if (/^\([a-z0-9]+\)\s*$/.test(line)) continue;
    
    // Skip "PART I—OBJECT AND APPLICATION" if it's clearly a divider with no content
    // But we'll keep PART headers for now as they provide structure
    
    cleaned.push(line);
    prevLine = line;
  }
  
  // Join and collapse
  let result = cleaned.join('\n');
  result = result.replace(/\n{3,}/g, '\n\n');
  result = result.trim();
  
  return result;
}

function extractSections(text) {
  // Find section boundaries: "1. Title\ncontent..." or "13.—(1) text..."
  const sectionRegex = /^(\d{1,4})[\.\)]\s+(.+)$/gm;
  const sections = [];
  let match;
  
  while ((match = sectionRegex.exec(text)) !== null) {
    const num = match[1];
    const title = match[2].trim();
    // Find content until next section
    const startIdx = match.index + match[0].length;
    const nextSectionMatch = text.slice(startIdx).match(/^(\d{1,4})[\.\)]\s+/m);
    const endIdx = nextSectionMatch ? startIdx + nextSectionMatch.index : text.length;
    const body = text.slice(startIdx, endIdx).trim();
    
    if (body.length > 10) { // skip near-empty sections
      sections.push({ section: num, title, body });
    }
  }
  
  return sections;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    console.error('Usage: node clean-act.js --input <file> [--output <file>] [--manifest <json>]');
    process.exit(1);
  }
  
  const raw = fs.readFileSync(args.input, 'utf8');
  const cleaned = cleanLegalText(raw);
  const sections = extractSections(cleaned);
  
  if (args.output) {
    fs.writeFileSync(args.output, cleaned, 'utf8');
  }
  
  if (args.manifest) {
    const manifest = JSON.parse(fs.readFileSync(args.manifest, 'utf8'));
    // Find entry matching this input file
    for (const entry of manifest) {
      if (entry.cleanedPath === args.input || 
          entry.cleanedPath.replace('/home/user/legally-unbullied/', '/home/user/Legallyunbullied/') === args.input) {
        entry.stats.sectionCount = sections.length;
        entry.stats.firstSection = sections.length > 0 ? sections[0].section : null;
        entry.stats.lastSection = sections.length > 0 ? sections[sections.length - 1].section : null;
        entry.stats.monotonic = sections.length > 1;
        entry.stats.runCount = (entry.stats.runCount || 0) + 1;
        break;
      }
    }
    fs.writeFileSync(args.manifest, JSON.stringify(manifest, null, 2));
  }
  
  console.log(JSON.stringify({
    file: args.input,
    rawChars: raw.length,
    cleanedChars: cleaned.length,
    reduction: Math.round((1 - cleaned.length / Math.max(1, raw.length)) * 100),
    sections: sections.length,
    skipped: sections.length === 0 && raw.length > 100 ? 'no-parseable-sections' : null
  }));
}

main();
