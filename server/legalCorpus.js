/**
 * Firestore-backed retrieval of ingested legal provisions with in-memory caching.
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
 * Caching: In-memory cache with 1-hour TTL reduces Firestore reads by 80-90%.
 * Legal provisions rarely change, so aggressive caching is safe.
 *
 * Revisit with real vector search if/when a single practice area's corpus
 * grows well beyond what a keyword filter can reasonably narrow down.
 */

const { getFirestore } = require("./firebaseAdmin");

const COLLECTION = "legal_provisions";
const RAW_FETCH_CAP = 4000; // "general" alone now holds 3500+ sections after the bulk PLAC ingestion
const MAX_FOR_MODEL = 14;
const KEYWORD_FILTER_THRESHOLD = MAX_FOR_MODEL; // only bother filtering once we're over the cap anyway
const FIRESTORE_TIMEOUT_MS = 10000; // 10 second timeout for Firestore calls

// Cache configuration
const CACHE_TTL_MS = 3600000; // 1 hour TTL
const MAX_CACHE_SIZE = 100; // Max 100 cached queries
const cache = new Map();
const cacheStats = { hits: 0, misses: 0, size: 0 };

/**
 * Wraps a promise with a timeout
 */
function withTimeout(promise, ms, operation = "operation") {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${operation} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

/**
 * Generates a cache key from query parameters
 */
function getCacheKey({ practiceArea, jurisdiction, keywords = [] }) {
  const sortedKeywords = [...keywords].sort().join(",");
  return `${practiceArea}|${jurisdiction || "any"}|${sortedKeywords}`;
}

/**
 * Cleans up expired cache entries
 */
function cleanupCache() {
  const now = Date.now();
  let removed = 0;
  
  for (const [key, entry] of cache.entries()) {
    if (now - entry.timestamp > CACHE_TTL_MS) {
      cache.delete(key);
      removed++;
    }
  }
  
  if (removed > 0) {
    cacheStats.size = cache.size;
    console.log(`[cache] Cleaned up ${removed} expired entries, ${cache.size} remaining`);
  }
}

/**
 * Invalidates all cache entries (use after data ingestion)
 */
function invalidateCache() {
  const size = cache.size;
  cache.clear();
  cacheStats.size = 0;
  console.log(`[cache] Invalidated ${size} entries`);
}

/**
 * Gets cache statistics
 */
function getCacheStats() {
  const total = cacheStats.hits + cacheStats.misses;
  const hitRate = total > 0 ? (cacheStats.hits / total * 100).toFixed(1) : 0;
  
  return {
    hits: cacheStats.hits,
    misses: cacheStats.misses,
    size: cache.size,
    hitRate: `${hitRate}%`,
    maxSize: MAX_CACHE_SIZE,
    ttlMs: CACHE_TTL_MS,
  };
}

/**
 * @param {{ practiceArea: string, jurisdiction?: string, keywords?: string[] }} params
 * @returns {Promise<Array<{id:string, act:string, section:string, text:string, jurisdiction:string, source_url:string|null}>>}
 */
async function findProvisions({ practiceArea, jurisdiction, keywords = [] }) {
  const db = getFirestore();
  if (!db || !practiceArea) return [];

  // Generate cache key and check cache
  const cacheKey = getCacheKey({ practiceArea, jurisdiction, keywords });
  const cached = cache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    cacheStats.hits++;
    console.log(`[cache] HIT: ${cacheKey} (${cached.data.length} provisions)`);
    return cached.data;
  }
  
  // Cache miss - query Firestore
  cacheStats.misses++;
  console.log(`[cache] MISS: ${cacheKey} - querying Firestore`);

  let snapshot;
  try {
    snapshot = await withTimeout(
      db
        .collection(COLLECTION)
        .where("practice_area", "==", practiceArea)
        .limit(RAW_FETCH_CAP)
        .get(),
      FIRESTORE_TIMEOUT_MS,
      "Firestore query"
    );
  } catch (err) {
    console.error("[legalCorpus] Firestore query failed:", err.message);
    throw new Error(`Failed to retrieve legal provisions: ${err.message}`);
  }

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

  const result = docs.slice(0, MAX_FOR_MODEL);
  
  // Store in cache (with size limit)
  if (cache.size >= MAX_CACHE_SIZE) {
    // Remove oldest entry
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
    console.log(`[cache] Evicted oldest entry: ${oldestKey}`);
  }
  
  cache.set(cacheKey, {
    data: result,
    timestamp: Date.now(),
  });
  cacheStats.size = cache.size;
  
  console.log(`[cache] Stored: ${cacheKey} (${result.length} provisions)`);
  
  // Periodic cleanup (every 10 misses)
  if (cacheStats.misses % 10 === 0) {
    cleanupCache();
  }

  return result;
}

/**
 * Broadened retrieval for the relevance/sufficiency gate.
 *
 * findProvisions() only queries the single classified practice area. When that
 * area yields too few candidates (e.g. a general assault question classified
 * as "criminal_offences", whose corpus is mostly special-provisions Acts),
 * the correct law (e.g. the Criminal Code) may sit in the large "general"
 * bucket. This function queries the primary area first and, if it returns
 * fewer than `minSources` provisions, additionally pulls keyword-filtered
 * provisions from the "general" category and merges them (deduped by id,
 * primary-first), so the relevance gate has a broad enough candidate pool to
 * rank — instead of being forced to draft from a single weak match.
 *
 * @returns {Promise<{ provisions: Array, categories: string[] }>}
 */
async function findProvisionsBroad({ practiceArea, jurisdiction, keywords = [], minSources = 3 } = {}) {
  const categories = [practiceArea];

  let primary = [];
  try {
    primary = await findProvisions({ practiceArea, jurisdiction, keywords });
  } catch (err) {
    console.warn("[legalCorpus] broad: primary query failed:", err.message);
    primary = [];
  }

  if (primary.length >= minSources) {
    return { provisions: primary, categories };
  }

  // Broaden into the general bucket. "general" is huge (3500+ sections), so
  // the keyword filter will apply inside findProvisions — exactly what we want
  // here: keyword-relevant general law (e.g. Criminal Code sections containing
  // "assault") rather than the entire bucket.
  let general = [];
  try {
    general = await findProvisions({ practiceArea: "general", jurisdiction, keywords });
  } catch (err) {
    console.warn("[legalCorpus] broad: general query failed:", err.message);
    general = [];
  }

  const seen = new Set(primary.map((p) => p.id));
  const merged = primary.concat(general.filter((p) => !seen.has(p.id)));
  if (general.length && !categories.includes("general")) categories.push("general");

  return { provisions: merged.slice(0, MAX_FOR_MODEL), categories };
}

module.exports = {
  findProvisions,
  findProvisionsBroad,
  COLLECTION,
  invalidateCache,
  getCacheStats,
  cleanupCache,
};
