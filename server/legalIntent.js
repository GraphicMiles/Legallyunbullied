/**
 * Deterministic legal-intent backstop for the casual/legal short-circuit.
 *
 * The classifier is a single LLM field that, across provider fallbacks, can
 * occasionally misfile a described incident as "casual chat" (e.g. a short,
 * emotional "someone slapped me"). This module is a deterministic pre-gate:
 * it detects incident/legal phrasing in the raw question and (a) steers the
 * classifier to produce a full legal classification, and (b) provides a
 * fallback classification if the classifier still says "casual".
 *
 * Precision-biased by design: hard patterns are multi-word and anchored to
 * the first person ("slapped me", "stole my"), with per-rule idiom guards so
 * casual phrasing ("hit me up", "it beats me", "shot me a message") does not
 * force the legal path. Broader "soft" signals (landlord, employer, contract,
 * police, ...) only force the legal path when two or more appear together.
 */

// ── Hard incident rules: unambiguous "this happened to me" phrasing ────────
// Each: { re: RegExp, guard?: RegExp, area: string, kw: string[] }
// `guard` cancels that specific match (an idiom that happens to contain the
// same words). Per-rule guards keep precision high without weakening others.
const HARD_RULES = [
  // ── Violence / assault ──
  { re: /\bslap(ped|s|ping)?\s+(me|my|in\s+the|on\s+the)\b/i, guard: /\bslap\s+on\s+the\s+wrist\b/i, area: "criminal_offences", kw: ["assault"] },
  { re: /\bpunch(ed|es|ing)?\s+(me|my|in\s+the|on\s+the)\b/i, area: "criminal_offences", kw: ["assault"] },
  { re: /\bkick(ed|s|ing)?\s+(me|my)\b/i, area: "criminal_offences", kw: ["assault"] },
  { re: /\bkicked\s+in\s+the\s+(face|head|stomach|groin|teeth)\b/i, area: "criminal_offences", kw: ["assault"] },
  { re: /\bhit\s+in\s+the\s+(face|head|eye|nose|mouth|stomach|chest|back|leg|arm)\b/i, area: "criminal_offences", kw: ["assault"] },
  { re: /\battack(ed|ing|s)?\s+me\b/i, area: "criminal_offences", kw: ["assault"] },
  { re: /\bassault(ed|ing|s)?\b/i, area: "criminal_offences", kw: ["assault"] },
  { re: /\bstab(bed|s|bing)?\s+me\b/i, area: "criminal_offences", kw: ["assault", "weapon"] },
  { re: /\bshot\s+me\b/i, guard: /\bshot\s+me\s+a\s+(message|look|glance|text|mail|email|dm)\b/i, area: "criminal_offences", kw: ["firearm", "assault"] },
  { re: /\bchok(ed|ing|es)?\s+me\b/i, area: "criminal_offences", kw: ["assault"] },
  { re: /\bbeaten\s+(me|by|up|with|severely)\b/i, area: "criminal_offences", kw: ["assault"] },
  { re: /\b(?:was|got|been)\s+beaten\b/i, area: "criminal_offences", kw: ["assault"] },
  { re: /\bbeat(ing)?\s+me\s+up\b/i, area: "criminal_offences", kw: ["assault"] },
  { re: /\bbeat(s|ing)?\s+me\b/i, guard: /\b(?:it|that|what|this)\s+beats?\s+me\b/i, area: "criminal_offences", kw: ["assault"] },
  { re: /\bwound(ed|ing)?\s+me\b/i, area: "criminal_offences", kw: ["assault"] },
  { re: /\bmolest(ed|ing|s)?\b/i, area: "criminal_offences", kw: ["sexual assault"] },
  { re: /\brape[ds]?\b/i, area: "criminal_offences", kw: ["sexual assault"] },
  { re: /\bharass(ed|ing|ment|es)?\b/i, area: "criminal_offences", kw: ["harassment"] },
  { re: /\bthreaten(ed|ing|s)?\s+(me|my|to|with)\b/i, area: "criminal_offences", kw: ["threat"] },

  // ── Theft / property ──
  { re: /\bstole\s+(my|our|the)\b/i, area: "criminal_offences", kw: ["theft", "stealing"] },
  { re: /\bsteal(ing)?\s+(my|our)\b/i, area: "criminal_offences", kw: ["theft", "stealing"] },
  { re: /\bstolen\b/i, area: "criminal_offences", kw: ["theft", "stealing"] },
  { re: /\brobbed\s+(me|us|my)\b/i, area: "criminal_offences", kw: ["robbery"] },
  { re: /\bbroke?\s+into\s+(my|our)\b/i, area: "criminal_offences", kw: ["burglary", "breaking and entering"] },
  { re: /\bbroken\s+into\s+(my|our)\b/i, area: "criminal_offences", kw: ["burglary", "breaking and entering"] },
  { re: /\bburglar(y|ies|ized)?\b/i, area: "criminal_offences", kw: ["burglary"] },
  { re: /\bdefraud(ed|ing)?\b/i, area: "criminal_offences", kw: ["fraud"] },
  { re: /\bscam(med|s|ming)?\s+(me|by)\b/i, area: "criminal_offences", kw: ["fraud", "scam"] },
  { re: /\b(?:was|got|been|being)\s+scam(med)?\b/i, area: "criminal_offences", kw: ["fraud", "scam"] },
  { re: /\bswindled\s+me\b/i, area: "criminal_offences", kw: ["fraud"] },
  { re: /\bkidnap(ped|ping|s)?\b/i, area: "criminal_offences", kw: ["kidnapping"] },

  // ── State action / custody ──
  { re: /\barrest(ed|ing|s)?\s+me\b/i, area: "criminal_rights", kw: ["arrest", "detention"] },
  { re: /\b(?:be|being|get|getting|got|was|were)\s+arrested\b/i, area: "criminal_rights", kw: ["arrest"] },
  { re: /\barrest(ed|s)?\s+for\b/i, area: "criminal_rights", kw: ["arrest"] },
  { re: /\bpolice\s+(arrested|beat|slapped|shot|detained)\b/i, area: "criminal_rights", kw: ["police", "arrest"] },
  { re: /\bdetained\s+(me|by|him|her|them)\b/i, area: "criminal_rights", kw: ["detention"] },
  { re: /\bpolice\s+brutality\b/i, area: "criminal_rights", kw: ["police", "brutality"] },

  // ── Tenancy ──
  { re: /\bevict(ed|ing|ion|s)?\b/i, area: "tenancy", kw: ["eviction", "notice"] },
  { re: /\blocked\s+(me|us)\s+out\s+of\s+(my|our)\s+(house|home|flat|apartment|room|shop|office)\b/i, area: "tenancy", kw: ["eviction", "lockout"] },
  { re: /\bchanged\s+the\s+locks\b/i, area: "tenancy", kw: ["eviction", "lockout"] },

  // ── Employment ──
  { re: /\bfired\s+me\b/i, guard: /\bfired\s+me\s+up\b/i, area: "employment", kw: ["termination", "unfair dismissal"] },
  { re: /\b(?:was|got|been|being|get)\s+fired\b/i, guard: /\bfired\s+up\b/i, area: "employment", kw: ["termination", "unfair dismissal"] },
  { re: /\bsack(ed|ing)?\s+me\b/i, area: "employment", kw: ["termination", "unfair dismissal"] },
  { re: /\b(?:was|got|been|being)\s+sacked\b/i, area: "employment", kw: ["termination", "unfair dismissal"] },
  { re: /\bterminat(ed|ing)?\s+me\b/i, area: "employment", kw: ["termination"] },
  { re: /\b(?:was|got|been|being)\s+terminated\b/i, area: "employment", kw: ["termination"] },
  { re: /\blaid\s+me\s+off\b/i, area: "employment", kw: ["redundancy", "termination"] },
  { re: /\b(?:was|got|been|being)\s+laid\s+off\b/i, area: "employment", kw: ["redundancy", "termination"] },
  { re: /\bunpaid\b/i, area: "employment", kw: ["unpaid wages"] },
  { re: /\b(?:hasn'?t|haven'?t|didn'?t|won'?t|not|refused\s+to|stopped)\s+(?:pay|paid|paying)\s+me\b/i, area: "employment", kw: ["unpaid wages"] },

  // ── Family ──
  { re: /\bdivorce\b/i, area: "family_law", kw: ["divorce"] },
  { re: /\bchild\s+(custody|support)\b/i, area: "family_law", kw: ["custody", "child support"] },

  // ── Money / contract ──
  { re: /\bowe[sd]?\s+me\s+(money|n[0-9]+)\b/i, area: "contract", kw: ["debt", "money owed"] },
  { re: /\bbreach\s+of\s+contract\b/i, area: "contract", kw: ["breach of contract"] },

  // ── Discrimination ──
  { re: /\bdiscriminat(ed|ing|ion)?\s+against\b/i, area: "constitutional_rights", kw: ["discrimination"] },
];

// ── Soft signals: single legal-adjacent words — force legal only when ≥2 ──
const SOFT_SIGNALS = [
  "landlord", "tenant", "tenancy", "rent", "lease",
  "employer", "employee", "salary", "wages", "contract", "agreement",
  "police", "lawyer", "solicitor", "court", "sue", "sued", "suing",
  "compensation", "damages", "legal", "rights", "law",
  "divorce", "custody", "evict", "arrest", "detain", "bail", "prison", "jail",
  "breach", "dispute", "refund", "deposit", "inheritance", "will", "probate",
  "discrimination", "harass", "threat", "abuse", "abused", "violent", "violence",
  "stolen", "stole", "robbery", "fraud", "scam", "bribe", "corruption",
  "injury", "injured", "accident", "negligence",
];

// Soft-signal → practice-area hints (used for the fallback classification).
const SOFT_AREA_HINTS = {
  landlord: "tenancy", tenant: "tenancy", tenancy: "tenancy", rent: "tenancy", lease: "tenancy", evict: "tenancy",
  employer: "employment", employee: "employment", salary: "employment", wages: "employment",
  contract: "contract", agreement: "contract", breach: "contract", refund: "contract", deposit: "contract",
  police: "criminal_rights", arrest: "criminal_rights", detain: "criminal_rights", bail: "criminal_rights",
  prison: "criminal_offences", jail: "criminal_offences", stolen: "criminal_offences", stole: "criminal_offences",
  robbery: "criminal_offences", fraud: "criminal_offences", scam: "criminal_offences", bribe: "criminal_offences",
  corruption: "criminal_offences", violence: "criminal_offences", violent: "criminal_offences", abuse: "criminal_offences", abused: "criminal_offences",
  divorce: "family_law", custody: "family_law", inheritance: "family_law", probate: "family_law",
  discrimination: "constitutional_rights", rights: "constitutional_rights",
  lawyer: "general", solicitor: "general", court: "general", legal: "general", law: "general",
  sue: "general", sued: "general", suing: "general", compensation: "general", damages: "general",
  injury: "general", injured: "general", accident: "general", negligence: "general",
  dispute: "general", threat: "criminal_offences", harass: "criminal_offences",
};

const STATE_VARYING_AREAS = new Set(["tenancy", "family_law", "land_property"]);
const HIGH_URGENCY_AREAS = new Set(["criminal_offences", "criminal_rights", "constitutional_rights"]);

/**
 * @param {string} text — the user's raw question.
 * @returns {{ legal: boolean, area?: string, keywords?: string[] }}
 */
function detectLegalIntent(text) {
  const raw = String(text || "");
  if (!raw.trim()) return { legal: false };

  const t = " " + raw.toLowerCase().replace(/[^a-z0-9'\s]/g, " ").replace(/\s+/g, " ").trim() + " ";

  let area = null;
  const keywords = new Set();

  for (const rule of HARD_RULES) {
    if (rule.re.test(t)) {
      if (rule.guard && rule.guard.test(t)) continue; // idiom — not this signal
      if (!area) area = rule.area; // first matched area wins (ordered by specificity)
      rule.kw.forEach((k) => keywords.add(k));
    }
  }

  if (keywords.size > 0) {
    return { legal: true, area: area || "general", keywords: [...keywords] };
  }

  // Soft signals — need at least two distinct legal-adjacent terms.
  const found = [];
  for (const s of SOFT_SIGNALS) {
    if (new RegExp("\\b" + s + "\\b", "i").test(t)) found.push(s);
    if (found.length >= 2) break;
  }

  if (found.length >= 2) {
    // Prefer the first hint with a specific area.
    for (const s of found) {
      const hint = SOFT_AREA_HINTS[s];
      if (hint && hint !== "general") {
        return { legal: true, area: hint, keywords: found };
      }
    }
    return { legal: true, area: "general", keywords: found };
  }

  return { legal: false };
}

/**
 * Build a valid legal classification when the classifier still says "casual"
 * despite the deterministic gate. Rare safety net; quality is guarded
 * downstream by the relevance gate + broadening.
 */
function buildFallbackClassification(text, detection) {
  const det = detection || detectLegalIntent(text) || { area: "general", keywords: [] };
  const area = det.area || "general";
  const keywords = det.keywords && det.keywords.length ? det.keywords : [text.split(/\s+/).slice(0, 6).join(" ")];

  return {
    is_legal_question: true,
    practice_area: area,
    jurisdiction: "Federal",
    // State law varies for tenancy/family/land — ask. Criminal law is federal.
    jurisdiction_status: STATE_VARYING_AREAS.has(area) ? "unclear" : "clear",
    urgency: HIGH_URGENCY_AREAS.has(area) ? "High" : "Medium",
    summary: String(text || "").slice(0, 200),
    keywords,
    key_issues: [],
    complexity: "Medium",
    route: "simple",
    reasoning_approach: "Apply the relevant statute to the described incident.",
    stakeholders: [],
    potential_remedies: [],
  };
}

module.exports = { detectLegalIntent, buildFallbackClassification };
