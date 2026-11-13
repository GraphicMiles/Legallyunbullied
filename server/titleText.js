/**
 * Turn a model's raw title reply into exactly one short, single-line title.
 *
 * Models sometimes answer with several options, a label ("Title: ..."), a
 * numbered list or quotes. The sidebar and topbar must show one title, so we
 * keep the first meaningful line, strip the decoration, and truncate at a word
 * boundary when it is still too long.
 */
const MAX_TITLE_CHARS = 48;

function truncateAtWord(text, max = MAX_TITLE_CHARS) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return base.replace(/[\s,;:.-]+$/, "") + "…";
}

function cleanTitle(raw) {
  if (typeof raw !== "string") return null;
  // First non-empty line only: a reply with several lines is several options.
  const firstLine = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return null;

  let t = firstLine
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "")          // "1. ", "- ", "• "
    .replace(/^(?:title|summary|topic)\s*:\s*/i, "")  // "Title: ..."
    .trim();
  // Several options on one line ("Landlord lockout / Rent dispute") -> the first.
  t = t.split(/\s+[\/|]\s+/)[0];
  // Quotes, backticks and markdown emphasis around the whole title.
  t = t.replace(/^[\s"'`*_“”‘’]+|[\s"'`*_“”‘’]+$/g, "");
  // No trailing sentence punctuation on a title.
  t = t.replace(/[.!?:;,]+$/, "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return truncateAtWord(t);
}

module.exports = { cleanTitle, truncateAtWord, MAX_TITLE_CHARS };
