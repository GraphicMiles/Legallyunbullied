/**
 * Firestore-backed retrieval of ingested legal provisions.
 *
 * Deliberately not vector search: the corpus is small and cleanly
 * categorized (practice area + jurisdiction), and a modern LLM's context
 * window comfortably fits every provision for a given category. Coarse
 * filtering here, real relevance judgement happens in the drafting prompt.
 * Revisit if/when the corpus grows into hundreds of acts across many states
 * (at which point `limit` below will also need to stop being "one Act's
 * worth of sections" and start being an actual relevance-ranked cutoff).
 */

const { getFirestore } = require("./firebaseAdmin");

const COLLECTION = "legal_provisions";

/**
 * @param {{ practiceArea: string, jurisdiction?: string, limit?: number }} params
 * @returns {Promise<Array<{id:string, act:string, section:string, text:string, jurisdiction:string, source_url:string|null}>>}
 */
async function findProvisions({ practiceArea, jurisdiction, limit = 150 }) {
  const db = getFirestore();
  if (!db || !practiceArea) return [];

  const snapshot = await db
    .collection(COLLECTION)
    .where("practice_area", "==", practiceArea)
    .limit(limit)
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

  return docs;
}

module.exports = { findProvisions, COLLECTION };
