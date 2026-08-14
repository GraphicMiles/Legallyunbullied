/**
 * Generic text cleaner for statute text extracted from either:
 *  - PLAC HTML print.php pages (after stripping tags), or
 *  - PDF text extraction (pdf-parse)
 *
 * Applies the same class of fixes done by hand for the first 5 flagship
 * Acts, but generically:
 *   1. Strip everything before the first real numbered section (drops
 *      "ARRANGEMENT OF SECTIONS" tables of contents, Gazette headers, etc).
 *   2. Stop at the first "SCHEDULE" / "FIRST SCHEDULE" / "ORDER <roman>" /
 *      "APPENDIX" / "FORM NO." marker that appears AFTER at least one real
 *      section has been captured — these reuse plain numbers that collide
 *      with real section numbers.
 *
 * This is a best-effort heuristic applied at bulk scale (500+ documents) —
 * NOT the same level of individual hand-review given to the first 5 Acts.
 * Anomalies (too few/many sections, non-monotonic numbering) are reported
 * by the caller so they can be spot-checked, not silently trusted.
 */

const SECTION_HEADER_RE = /^(\d{1,4})\.[\s—-]/;
const STOP_MARKERS_RE =
  /^(FIRST |SECOND |THIRD |FOURTH |FIFTH |SIXTH |SEVENTH |EIGHTH |NINTH |TENTH )?SCHEDULE\b|^SCHEDULES\b|^ORDER\s+[IVXLCDM]+\b|^APPENDIX\b|^FORM\s+(NO\.?\s*)?[IVXLCDM0-9]|^SUBSIDIARY LEGISLATION\b|^LIST OF SUBSIDIARY LEGISLATION\b|^REGULATIONS?\s+MADE UNDER\b|^RULES\s+MADE UNDER\b|^\[SUBSIDIARY\]/i;

function stripHtmlToText(html) {
  let text = html;

  // PLAC's per-Act HTML template always puts the Arrangement-of-Sections
  // ToC as the FIRST <ol> in the document (right after a "SECTION" marker)
  // — unconditionally drop it before applying any other <ol> heuristics,
  // since a handful of ToCs have one stray <strong> tag in them (e.g. a
  // bolded Part heading) that would otherwise fool a content-based check
  // into preserving the whole ToC as if it were real numbered sections.
  const firstOlMatch = text.match(/<ol[^>]*>[\s\S]*?<\/ol>/i);
  if (firstOlMatch) {
    text = text.slice(0, firstOlMatch.index) + "\n" + text.slice(firstOlMatch.index + firstOlMatch[0].length);
  }

  // For every remaining <ol> block: some sections are written inline as
  // "<strong>N. Title</strong>" in a flowing <p>, but others are written as
  // "<ol><li value='N'><strong>Title</strong></li></ol>" instead — the
  // number lives on the <li>, not inside the <strong> text. Appended
  // Schedules/Rules also use <ol><li>, but their <li> items are plain text
  // (no <strong>). So: any remaining <ol> block whose <li> items contain
  // <strong> is really an inline numbered section list and gets converted
  // to "N. Title" lines in place; any block with no <strong> anywhere
  // inside is Schedule/Rules noise and gets dropped entirely.
  text = text.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (whole, inner) => {
    if (!/<strong>/i.test(inner)) return "\n";
    const liRe = /<li(?:\s+value="?(\d+)"?)?[^>]*>([\s\S]*?)<\/li>/gi;
    let out = "\n";
    let counter = 0;
    let m;
    while ((m = liRe.exec(inner))) {
      const explicitNum = m[1] ? parseInt(m[1], 10) : null;
      counter = explicitNum !== null ? explicitNum : counter + 1;
      const itemHtml = m[2];
      const itemText = itemHtml.replace(/<[^>]+>/g, "").trim();
      if (itemText) out += `\n${counter}. ${itemText}\n`;
    }
    return out;
  });

  // Force a line break before every bolded "N. Title" section marker so the
  // line-based chunker below can find it at the start of a line.
  text = text.replace(/<strong>\s*(\d{1,4}\.[^<]*)<\/strong>/gi, "\n$1\n");
  text = text.replace(/<(br|p|div|h[1-6])[^>]*>/gi, "\n");
  text = text.replace(/<\/(p|div|h[1-6])>/gi, "\n");
  text = text.replace(/<[^>]+>/g, "");
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, "’")
    .replace(/&lsquo;/g, "‘")
    .replace(/&rdquo;/g, "”")
    .replace(/&ldquo;/g, "“");
  return text;
}



/**
 * Split a full header-match list into "runs" of increasing section numbers.
 * A document typically produces 2+ runs: run 0 = the Arrangement-of-Sections
 * ToC (numbers 1..N), run 1 = the real body (numbers 1..N again), and
 * sometimes a run 2+ = an appended Schedule/Rules/Subsidiary Legislation
 * that re-numbers from scratch. A "restart" (drop back to 1 or 2 after
 * having climbed well past it) marks a new run.
 */
function splitIntoRuns(headers) {
  if (!headers.length) return [];
  const runs = [];
  let runStart = 0;
  let maxSoFarInRun = headers[0].num;
  for (let i = 1; i < headers.length; i++) {
    const num = headers[i].num;
    if (num <= 2 && num < maxSoFarInRun - 2 && i - runStart >= 3) {
      runs.push(headers.slice(runStart, i));
      runStart = i;
      maxSoFarInRun = num;
    } else {
      maxSoFarInRun = Math.max(maxSoFarInRun, num);
    }
  }
  runs.push(headers.slice(runStart));
  return runs;
}

/**
 * Trim leading ToC/header noise and trailing Schedules/Forms/Rules, then
 * return the trimmed text plus stats about what was found, so bulk runs can
 * flag suspicious documents without a human reading every one.
 *
 * Strategy: find every line that looks like a numbered section header and
 * split them into "runs" of increasing numbers (see splitIntoRuns) — a
 * restart back down to 1/2 after climbing much higher marks a new run.
 * Depending on the source markup, run 0 is EITHER the real body (when an
 * HTML-specific step already stripped the Arrangement-of-Sections ToC
 * before this runs) OR the ToC itself (typical for PDF-extracted text,
 * which has no tag structure to selectively strip). Distinguish the two by
 * content density: a ToC's "sections" are just a title with almost no body
 * text before the next entry; real sections have substantial prose. If
 * run 0 looks ToC-thin and a run 1 exists, skip to run 1 as the real body.
 * Whatever run is chosen as the body, stop right before the NEXT run after
 * it (an appended Schedule/Rules/Subsidiary Legislation section that
 * restarts numbering and would otherwise collide with real section
 * numbers) — plus any explicit STOP_MARKERS_RE text within the body run.
 */
function autoClean(rawText) {
  // Layer 1: Nigerian statutes conventionally place a bracketed
  // "[Commencement]" clause right after the ToC and before real numbered
  // sections start. Cutting up to the first occurrence removes most ToC
  // noise outright in the common case, before the run-detection heuristic
  // below even has to consider it. Tolerates a stray closing paren instead
  // of bracket (seen in a few source scrapes). No-op if absent.
  const commencementMatch = rawText.match(/[\[\(]\s*commencement\s*\.?\s*[\]\)]/i);
  const preTrimmed = commencementMatch ? rawText.slice(commencementMatch.index + commencementMatch[0].length) : rawText;

  const rawLines = preTrimmed.split(/\r?\n/).map((l) => l.trim());

  const headers = [];
  for (let i = 0; i < rawLines.length; i++) {
    const m = rawLines[i].match(SECTION_HEADER_RE);
    if (m && rawLines[i].length > 3) headers.push({ idx: i, num: parseInt(m[1], 10) });
  }

  const runs = splitIntoRuns(headers);

  function avgContentLength(run, nextRunStartIdx) {
    if (!run.length) return 0;
    let total = 0;
    for (let i = 0; i < run.length; i++) {
      const start = run[i].idx;
      const end = i + 1 < run.length ? run[i + 1].idx : nextRunStartIdx;
      total += rawLines.slice(start + 1, end).join(" ").length;
    }
    return total / run.length;
  }

  const TOC_DENSITY_THRESHOLD = 90; // avg chars of body text per ToC-style entry is typically well under this
  let bodyRunIndex = 0;
  if (runs.length >= 2 && runs[0].length >= 3) {
    const density0 = avgContentLength(runs[0], runs[1][0].idx);
    if (density0 < TOC_DENSITY_THRESHOLD) bodyRunIndex = 1;
  }
  const bodyRun = runs[bodyRunIndex];
  const trimmedHeader = bodyRunIndex > 0 || (headers.length > 0 && headers[0].idx > 0);

  let lines;
  if (bodyRun && bodyRun.length) {
    const nextRun = runs[bodyRunIndex + 1];
    const endIdx = nextRun ? nextRun[0].idx : rawLines.length;
    lines = rawLines.slice(bodyRun[0].idx, endIdx);
  } else {
    lines = rawLines;
  }

  // Within the chosen body, also honor explicit textual stop markers
  // (SCHEDULE/ORDER/APPENDIX/etc) even if they weren't accompanied by a
  // numeric restart (e.g. a Schedule that continues high numbers).
  let stopIdx = -1;
  let sectionsSeenBeforeStop = 0;
  for (let i = 1; i < lines.length; i++) {
    if (SECTION_HEADER_RE.test(lines[i])) sectionsSeenBeforeStop++;
    // Require the line to actually BE a short standalone heading (e.g.
    // "SECOND SCHEDULE") rather than matching a normal sentence that merely
    // mentions "...specified in the second schedule to this Act" — real
    // headings are short; sentence fragments continue with lowercase
    // connective words and run much longer.
    if (sectionsSeenBeforeStop >= 1 && lines[i].length <= 40 && STOP_MARKERS_RE.test(lines[i])) {
      stopIdx = i;
      break;
    }
  }
  const finalLines = stopIdx >= 0 ? lines.slice(0, stopIdx) : lines;
  const cleaned = finalLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  // Stats for anomaly detection.
  const sectionNumbers = [];
  for (const line of finalLines) {
    const m = line.match(SECTION_HEADER_RE);
    if (m) sectionNumbers.push(parseInt(m[1], 10));
  }
  let monotonic = true;
  for (let i = 1; i < sectionNumbers.length; i++) {
    if (sectionNumbers[i] < sectionNumbers[i - 1]) monotonic = false;
  }

  return {
    cleaned,
    stats: {
      trimmedHeader,
      trimmedTail: stopIdx >= 0 || runs.length > bodyRunIndex + 1,
      sectionCount: sectionNumbers.length,
      monotonic,
      firstSection: sectionNumbers[0] ?? null,
      lastSection: sectionNumbers[sectionNumbers.length - 1] ?? null,
      runCount: runs.length,
    },
  };
}



module.exports = { stripHtmlToText, autoClean, SECTION_HEADER_RE, STOP_MARKERS_RE };
