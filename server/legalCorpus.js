/**
 * Firestore-backed retrieval of ingested legal provisions.
 *
 * Deliberately not vector search: the corpus is cleanly categorized
 * (practice area + jurisdiction), so retrieval is a Firestore filter, not
 * semantic search. But some ingested Acts are large (ACJA 2015 alone is
 * ~490 sections) — sending every section for a category to the LLM on
 * every question would blow the context/cost budget and, worse, could
 * silently truncate to an arbitrary slice that misses the sections that
 * actually answer the question. So there are two tiers:
 *
 *   1. Fetch every provision for the practice area (cheap — Firestore
 *      reads, not LLM tokens) up to RAW_FETCH_CAP.
 *   2. If a set of keywords was supplied (from the classification step)
 *      and the raw set is large, narrow to provisions whose text actually
 *      contains one of those keywords, capped at MAX_FOR_MODEL. Falls
 *      back to the unfiltered set if keyword-matching finds nothing, so a
 *      bad keyword guess never means zero grounding.
 *
 * Revisit with real vector search if/when a single practice area's corpus
 * grows well beyond what a keyword filter can reasonably narrow down.
 */

const { getFirestore } = require("./firebaseAdmin");

const COLLECTION = "legal_provisions";
const RAW_FETCH_CAP = 4000; // "general" alone now holds 3500+ sections after the bulk PLAC ingestion
const MAX_FOR_MODEL = 14;
const KEYWORD_FILTER_THRESHOLD = MAX_FOR_MODEL; // only bother filtering once we're over the cap anyway

/**
 * @param {{ practiceArea: string, jurisdiction?: string, keywords?: string[] }} params
 * @returns {Promise<Array<{id:string, act:string, section:string, text:string, jurisdiction:string, source_url:string|null}>>}
 */
async function findProvisions({ practiceArea, jurisdiction, keywords = [] }) {
  const db = getFirestore();
  if (!db || !practiceArea) return [];

  const snapshot = await db
    .collection(COLLECTION)
    .where("practice_area", "==", practiceArea)
    .limit(RAW_FETCH_CAP)
    .get();

  let docs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

  if (jurisdiction) {
    // Keep provisions that either match the stated jurisdiction, have no
    // jurisdiction set, or are Federal/national — a state-specific question
    // still needs Constitutional/Federal Act context alongside state law.
    docs = docs.filter(
      (d) => !d.jurisdiction || d.jurisdiction === jurisdiction || /federal/i.test(d.jurisdiction)
    );
  }

  docs.sort((a, b) => (parseInt(a.section, 10) || 0) - (parseInt(b.section, 10) || 0));

  const cleanKeywords = (keywords || []).map((k) => String(k).trim().toLowerCase()).filter(Boolean);

  if (docs.length > KEYWORD_FILTER_THRESHOLD && cleanKeywords.length) {
    const matched = docs.filter((d) => {
      const haystack = d.text.toLowerCase();
      return cleanKeywords.some((k) => haystack.includes(k));
    });
    if (matched.length) {
      docs = matched;
    }
    // If no keyword matched anything, fall through to the unfiltered
    // (but still capped below) list rather than returning nothing.
  }

  return docs.slice(0, MAX_FOR_MODEL);
}

module.exports = { findProvisions, COLLECTION };
