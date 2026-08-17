/**
 * Firestore-backed legal provision retrieval.
 *
 * Retrieval is deliberately deterministic before an LLM sees any evidence:
 * category/jurisdiction filtering -> lexical ranking -> authority diversity ->
 * a bounded shortlist. The downstream relevance judge validates that shortlist;
 * it is not expected to repair an arbitrary first-N Firestore result.
 */

const { getFirestore } = require("./firebaseAdmin");

const COLLECTION = "legal_provisions";
const RAW_FETCH_CAP = 4000;
const MAX_FOR_MODEL = 14;
const FIRESTORE_TIMEOUT_MS = Math.max(2000, parseInt(process.env.FIRESTORE_TIMEOUT_MS, 10) || 5000);
const CACHE_TTL_MS = 3600000;
const MAX_CACHE_SIZE = 100;
const cache = new Map();
// Raw category cache is deliberately independent of keywords/jurisdiction.
// Previously every new keyword set re-read up to 4,000 Firestore documents,
// exhausting the daily quota during ordinary multi-turn conversations.
const rawCategoryCache = new Map();
const rawCategoryInflight = new Map();
let firestoreUnavailableUntil = 0;
const cacheStats = { hits: 0, misses: 0, size: 0, rawCategoryReads: 0 };

// Conservative adjacency only. Broad retrieval is still sequential in V2.0;
// correctness and inspectability come before parallel execution.
const ADJACENT_AREAS = {
  criminal_offences: ["criminal_rights", "constitutional_rights"],
  criminal_rights: ["criminal_offences", "constitutional_rights"],
  constitutional_rights: ["criminal_rights"],
  tenancy: ["land_property"],
  land_property: ["tenancy"],
  employment: ["employment_labour_safety", "contract"],
  employment_labour_safety: ["employment"],
  consumer_rights: ["contract"],
  contract: ["consumer_rights", "company_business"],
  family_law: ["constitutional_rights"],
};

function withTimeout(promise, ms, operation = "operation") {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${operation} timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalProvisionId(provision) {
  return String(provision?.provisionId || provision?.id || "").trim();
}

function cleanKeywords(keywords) {
  return Array.from(new Set((keywords || [])
    .map((k) => normalize(k))
    .filter((k) => k.length >= 2)))
    .slice(0, 12);
}

/** Deterministic lexical rank used both for primary and broadened retrieval. */
function rankProvisions(provisions, { keywords = [], jurisdiction } = {}) {
  const terms = cleanKeywords(keywords);
  const wantedJurisdiction = normalize(jurisdiction);

  return (provisions || []).map((p, originalIndex) => {
    const title = normalize(`${p.act || ""} ${p.title || ""} ${p.heading || ""}`);
    const text = normalize(p.text);
    const provisionJurisdiction = normalize(p.jurisdiction);
    let score = 0;
    let matchedTerms = 0;

    for (const term of terms) {
      let matched = false;
      if (title.includes(term)) { score += 12; matched = true; }
      if (text.includes(term)) {
        score += term.includes(" ") ? 9 : 5;
        matched = true;
      }
      if (matched) matchedTerms += 1;
    }

    // Reward coverage across the classifier's concepts, not one accidental hit.
    if (terms.length) score += (matchedTerms / terms.length) * 20;
    if (wantedJurisdiction && provisionJurisdiction === wantedJurisdiction) score += 8;
    else if (/federal/.test(provisionJurisdiction)) score += 3;
    if (p.source_url || p.sourceUrl) score += 1;
    if (p.section) score += 0.5;

    return {
      ...p,
      provisionId: canonicalProvisionId(p),
      _retrievalScore: Math.round(score * 100) / 100,
      _originalIndex: originalIndex,
    };
  }).sort((a, b) =>
    b._retrievalScore - a._retrievalScore ||
    a._originalIndex - b._originalIndex ||
    canonicalProvisionId(a).localeCompare(canonicalProvisionId(b))
  );
}

function selectDiverse(ranked, limit = MAX_FOR_MODEL) {
  const selected = [];
  const perAct = new Map();
  const MAX_PER_ACT = 6;

  for (const p of ranked) {
    const act = normalize(p.act) || canonicalProvisionId(p);
    const count = perAct.get(act) || 0;
    if (count >= MAX_PER_ACT) continue;
    selected.push(p);
    perAct.set(act, count + 1);
    if (selected.length >= limit) break;
  }

  // If one Act is the only authority, fill remaining slots rather than lose
  // directly relevant sections solely because of the diversity preference.
  if (selected.length < limit) {
    const seen = new Set(selected.map(canonicalProvisionId));
    for (const p of ranked) {
      if (seen.has(canonicalProvisionId(p))) continue;
      selected.push(p);
      if (selected.length >= limit) break;
    }
  }
  return selected;
}

function getCacheKey({ practiceArea, jurisdiction, keywords = [] }) {
  return `${practiceArea}|${jurisdiction || "any"}|${cleanKeywords(keywords).sort().join(",")}`;
}

function cleanupCache() {
  const now = Date.now();
  let removed = 0;
  for (const [key, entry] of cache.entries()) {
    if (now - entry.timestamp > CACHE_TTL_MS) {
      cache.delete(key);
      removed++;
    }
  }
  cacheStats.size = cache.size;
  if (removed) console.log(`[cache] Cleaned up ${removed} expired entries, ${cache.size} remaining`);
}

function invalidateCache() {
  const size = cache.size;
  cache.clear();
  rawCategoryCache.clear();
  rawCategoryInflight.clear();
  firestoreUnavailableUntil = 0;
  cacheStats.size = 0;
  console.log(`[cache] Invalidated ${size} entries`);
}

function getCacheStats() {
  const total = cacheStats.hits + cacheStats.misses;
  return {
    hits: cacheStats.hits,
    misses: cacheStats.misses,
    size: cache.size,
    hitRate: `${total ? (cacheStats.hits / total * 100).toFixed(1) : 0}%`,
    maxSize: MAX_CACHE_SIZE,
    ttlMs: CACHE_TTL_MS,
    rawCategories: rawCategoryCache.size,
    rawCategoryReads: cacheStats.rawCategoryReads,
    firestoreCircuitOpen: Date.now() < firestoreUnavailableUntil,
  };
}

async function getRawCategoryDocs(db, practiceArea) {
  const cached = rawCategoryCache.get(practiceArea);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) return cached.data;
  if (process.env.LOCAL_LEGAL_CORPUS === "true" || Date.now() < firestoreUnavailableUntil) {
    const { getLocalCategory } = require("./localLegalCorpus");
    const docs = getLocalCategory(practiceArea);
    rawCategoryCache.set(practiceArea, { data: docs, timestamp: Date.now(), fallback: true });
    return docs;
  }
  if (rawCategoryInflight.has(practiceArea)) return rawCategoryInflight.get(practiceArea);

  const request = (async () => {
    try {
      const snapshot = await withTimeout(
        db.collection(COLLECTION).where("practice_area", "==", practiceArea).limit(RAW_FETCH_CAP).get(),
        FIRESTORE_TIMEOUT_MS,
        "Firestore query"
      );
      const docs = snapshot.docs.map((d) => {
        const data = d.data();
        return { id: d.id, ...data, provisionId: data.provisionId || d.id };
      });
      rawCategoryCache.set(practiceArea, { data: docs, timestamp: Date.now() });
      cacheStats.rawCategoryReads += docs.length;
      return docs;
    } catch (err) {
      const transientStoreFailure = /quota|timed out|unavailable|resource.exhausted/i.test(String(err?.message || ""));
      if (transientStoreFailure && process.env.LEGAL_CORPUS_LOCAL_FALLBACK !== "false") {
        firestoreUnavailableUntil = Date.now() + 5 * 60 * 1000;
        const { getLocalCategory } = require("./localLegalCorpus");
        const docs = getLocalCategory(practiceArea);
        if (docs.length) {
          console.warn(`[legalCorpus] Firestore unavailable for ${practiceArea}; using ${docs.length} local verified provisions`);
          rawCategoryCache.set(practiceArea, { data: docs, timestamp: Date.now(), fallback: true });
          return docs;
        }
      }
      throw err;
    }
  })().finally(() => rawCategoryInflight.delete(practiceArea));

  rawCategoryInflight.set(practiceArea, request);
  return request;
}

async function findProvisions({ practiceArea, jurisdiction, keywords = [] }) {
  const db = getFirestore();
  if ((!db && process.env.LOCAL_LEGAL_CORPUS !== "true") || !practiceArea) return [];

  const cacheKey = getCacheKey({ practiceArea, jurisdiction, keywords });
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    cacheStats.hits++;
    console.log(`[cache] HIT: ${cacheKey} (${cached.data.length} provisions)`);
    return cached.data;
  }

  cacheStats.misses++;
  console.log(`[cache] MISS: ${cacheKey} - querying Firestore`);

  let docs;
  try {
    // Copy before per-request filtering/ranking; the raw cache stays immutable.
    docs = [...await getRawCategoryDocs(db, practiceArea)];
  } catch (err) {
    console.error("[legalCorpus] Firestore query failed:", err.message);
    throw new Error(`Failed to retrieve legal provisions: ${err.message}`);
  }
  if (jurisdiction) {
    docs = docs.filter((d) =>
      !d.jurisdiction ||
      normalize(d.jurisdiction) === normalize(jurisdiction) ||
      /federal/i.test(d.jurisdiction)
    );
  }

  const terms = cleanKeywords(keywords);
  if (terms.length) {
    const matched = docs.filter((d) => {
      const haystack = normalize(`${d.act || ""} ${d.title || ""} ${d.heading || ""} ${d.text || ""}`);
      return terms.some((term) => haystack.includes(term));
    });
    // Preserve the old safe fallback: a poor classifier keyword cannot turn a
    // populated legal category into an empty result.
    if (matched.length) docs = matched;
  }

  const result = selectDiverse(rankProvisions(docs, { keywords, jurisdiction }));
  if (cache.size >= MAX_CACHE_SIZE) cache.delete(cache.keys().next().value);
  cache.set(cacheKey, { data: result, timestamp: Date.now() });
  cacheStats.size = cache.size;
  if (cacheStats.misses % 10 === 0) cleanupCache();
  console.log(`[cache] Stored: ${cacheKey} (${result.length} provisions)`);
  return result;
}

/**
 * Broaden retrieval after evidence validation fails.
 *
 * `force: true` means the caller already knows the initial candidates are not
 * sufficient. In that case raw primary candidate count MUST NOT short-circuit
 * broadening (the previous bug did exactly that).
 */
async function findProvisionsBroad({
  practiceArea,
  jurisdiction,
  keywords = [],
  minSources = 2,
  force = false,
  includeAdjacent = true,
} = {}) {
  const categories = [];
  const all = [];

  async function addCategory(area) {
    if (!area || categories.includes(area)) return;
    categories.push(area);
    try {
      all.push(...await findProvisions({ practiceArea: area, jurisdiction, keywords }));
    } catch (err) {
      console.warn(`[legalCorpus] broad: ${area} query failed:`, err.message);
    }
  }

  await addCategory(practiceArea);
  if (!force && all.length >= minSources) {
    return { provisions: all, categories };
  }

  if (includeAdjacent) {
    for (const area of ADJACENT_AREAS[practiceArea] || []) await addCategory(area);
  }
  if (practiceArea !== "general") await addCategory("general");

  const byId = new Map();
  for (const p of all) {
    const id = canonicalProvisionId(p);
    if (id && !byId.has(id)) byId.set(id, p);
  }

  const ranked = rankProvisions([...byId.values()], { keywords, jurisdiction });
  return { provisions: selectDiverse(ranked), categories };
}

module.exports = {
  findProvisions,
  findProvisionsBroad,
  rankProvisions,
  canonicalProvisionId,
  COLLECTION,
  invalidateCache,
  getCacheStats,
  cleanupCache,
};
