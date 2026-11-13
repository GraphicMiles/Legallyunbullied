/**
 * In-memory BM25 index over every provision in the local legal corpus.
 *
 * Why: the production path picks one practice-area bucket from a classifier
 * and then ranks inside it. When the classifier's key has no bucket (or the
 * answer lands in "general"), the bucket is empty and the answer goes out with
 * zero sources. This index searches all provisions at once, so the bucket
 * choice no longer decides what can be found.
 *
 * Read-only. Built from legal_sources/ via localLegalCorpus.js, so it makes no
 * Firestore reads. Built once per process, lazily, and reused.
 */
const { getLocalCategory } = require("./localLegalCorpus");
const { PRACTICE_AREA_KEYS } = require("./practiceAreas");

const K1 = 1.2;
const B = 0.75;

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "do", "does", "for", "from", "has", "have",
  "how", "i", "if", "in", "into", "is", "it", "its", "me", "my", "of", "on", "or", "our", "should",
  "that", "the", "their", "them", "there", "they", "this", "to", "was", "we", "what", "when", "where",
  "which", "who", "will", "with", "you", "your", "not", "no", "so", "be", "than", "then", "about",
  "get", "got", "need", "want", "know", "tell", "please", "lagos", "nigeria", "nigerian",
]);

function tokenize(text) {
  return String(text || "")
    // OCR'd acts break words across lines ("em-\nployer"). Rejoin them first.
    .replace(/([a-z])-\s*\r?\n\s*([a-z])/gi, "$1$2")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ""))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

// Lay words -> the wording statutes actually use. Written from general legal
// vocabulary, not tuned to any one scenario. Each entry adds terms to the
// query; the original words stay. Keep this list short and reviewable.
const LAY_TO_LEGAL = {
  hacked: ["unlawful access", "computer system"],
  hacking: ["unlawful access", "computer system"],
  divorce: ["dissolution of marriage", "matrimonial causes"],
  separation: ["dissolution of marriage"],
  salary: ["wages", "remuneration"],
  paycheque: ["wages"],
  fired: ["termination", "dismissal"],
  sacked: ["termination", "dismissal"],
  rent: ["tenancy", "rent"],
  evict: ["possession", "recovery of premises"],
  eviction: ["possession", "recovery of premises"],
  landlord: ["landlord", "lessor"],
  scammed: ["fraud", "obtaining by false pretence"],
  scam: ["fraud"],
  bribe: ["gratification", "corruption"],
  arrested: ["arrest", "custody"],
  land: ["land", "right of occupancy"],
  stolen: ["stealing", "theft"],
  stole: ["stealing", "theft"],
  // Employment
  pregnant: ["pregnancy", "maternity"],
  pregnancy: ["maternity", "dismissal"],
  resigned: ["resignation", "termination"],
  resign: ["resignation", "termination"],
  severance: ["severance", "gratuity", "termination"],
  gratuity: ["gratuity", "pension"],
  owed: ["wages", "remuneration", "arrears"],
  wages: ["wages", "remuneration"],
  // Money and banking
  bank: ["bank", "banking", "electronic funds transfer"],
  transfer: ["electronic funds transfer", "transfer"],
  charged: ["charges", "bank charges"],
  refund: ["refund", "consumer"],
  refuses: ["refusal", "consumer"],
  broken: ["defective", "sale of goods"],
  goods: ["goods", "sale of goods"],
  // Contracts and building
  contractor: ["contract", "construction"],
  builder: ["contract", "construction"],
  disappeared: ["fraud", "false pretence"],
  deposit: ["deposit", "advance"],
  // Motor vehicles
  driver: ["motor vehicle", "road traffic"],
  accident: ["accident", "motor vehicle", "compensation"],
  car: ["motor vehicle"],
  // Land and property
  neighbour: ["neighbour", "land", "trespass"],
  fence: ["boundary", "land"],
  // Threats and personal safety
  threatened: ["threat", "intimidation"],
  threaten: ["threat", "intimidation"],
  kill: ["murder", "threat"],
  // Children and education
  school: ["education", "school"],
  child: ["child", "children"],
  // Privacy and online harm
  pictures: ["cybercrime", "privacy", "data"],
  photos: ["cybercrime", "privacy", "data"],
  posting: ["cybercrime", "publication"],
  online: ["cybercrime", "electronic"],
};

// Own keys only: a plain object also answers for "constructor" and
// "__proto__", which would make the spread below throw on a normal question.
function layTerms(token) {
  return Object.prototype.hasOwnProperty.call(LAY_TO_LEGAL, token) ? LAY_TO_LEGAL[token] : null;
}

function expandQuery(query) {
  const base = tokenize(query);
  const extra = [];
  for (const t of base) {
    const terms = layTerms(t);
    if (terms) extra.push(...terms);
  }
  return extra.length ? `${query} ${extra.join(" ")}` : query;
}

let cache = null;

function buildIndex() {
  const rowsById = new Map();
  for (const key of PRACTICE_AREA_KEYS) {
    for (const row of getLocalCategory(key)) {
      if (!rowsById.has(row.id)) rowsById.set(row.id, row);
    }
  }
  const docs = [];
  const df = new Map();
  let totalLen = 0;
  for (const row of rowsById.values()) {
    // The act name and section number are indexed too, so a query that names
    // an act or a section still finds it even if the body text does not repeat it.
    const tokens = tokenize(`${row.act} section ${row.section} ${row.text}`);
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    docs.push({ row, tf, len: tokens.length });
    totalLen += tokens.length;
  }
  const avgLen = docs.length ? totalLen / docs.length : 0;
  return { docs, df, avgLen, n: docs.length, rowsById };
}

function getIndex() {
  if (!cache) cache = buildIndex();
  return cache;
}

/**
 * Search the corpus. Returns the top k rows with a score and the matched terms.
 * opts.jurisdiction, if given, keeps only rows from that jurisdiction.
 */
function search(query, opts = {}) {
  const k = opts.k || 8;
  const idx = getIndex();
  const qTerms = opts.expand === false ? [...new Set(tokenize(query))] : [...new Set(tokenize(expandQuery(query)))];
  if (!qTerms.length || !idx.n) return [];

  const scores = new Map();
  const hits = new Map();
  for (const term of qTerms) {
    const dfT = idx.df.get(term);
    if (!dfT) continue;
    const idf = Math.log(1 + (idx.n - dfT + 0.5) / (dfT + 0.5));
    for (let i = 0; i < idx.docs.length; i++) {
      const d = idx.docs[i];
      const f = d.tf.get(term);
      if (!f) continue;
      const norm = K1 * (1 - B + B * (d.len / (idx.avgLen || 1)));
      const s = idf * ((f * (K1 + 1)) / (f + norm));
      scores.set(i, (scores.get(i) || 0) + s);
      if (!hits.has(i)) hits.set(i, []);
      hits.get(i).push(term);
    }
  }

  const ranked = [...scores.entries()]
    .map(([i, score]) => ({ doc: idx.docs[i], score, matched: hits.get(i) }))
    .filter((r) => !opts.jurisdiction || r.doc.row.jurisdiction === opts.jurisdiction)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  // Full corpus rows, so hits look exactly like findProvisions() output and can
  // feed the same relevance gate. score/matched are extra fields for tests.
  return ranked.map((r) => ({
    ...r.doc.row,
    score: Number(r.score.toFixed(4)),
    matched: r.matched,
  }));
}

function stats() {
  const idx = getIndex();
  return { provisions: idx.n, vocabulary: idx.df.size, avgDocLength: Math.round(idx.avgLen) };
}

// True when the synonym map has an entry for at least one word in the query.
function mapMatched(query) {
  return tokenize(query).some((t) => Boolean(layTerms(t)));
}

module.exports = { search, stats, tokenize, buildIndex, getIndex, expandQuery, mapMatched, LAY_TO_LEGAL };

/** Share of the query's IDF weight that the hit actually matches (0..1). Used as the relevance floor. */
function idfCoverage(query, hit) {
  const idx = getIndex();
  const terms = [...new Set(tokenize(query))].filter((t) => idx.df.get(t));
  if (!terms.length) return 0;
  const w = (t) => Math.log(1 + (idx.n - idx.df.get(t) + 0.5) / (idx.df.get(t) + 0.5));
  const total = terms.reduce((s, t) => s + w(t), 0);
  const got = (hit.matched || []).reduce((s, t) => s + w(t), 0);
  return total ? got / total : 0;
}
module.exports.idfCoverage = idfCoverage;
