/**
 * Canonical POST /api/chat legal-information pipeline.
 *
 * 1. Quick gate: is this a legal question, or casual chat?
 *    - Casual greetings, small talk, meta-questions → reply naturally and exit.
 * 2. Groq classifies the question (practice area, jurisdiction, urgency).
 * 3. Firestore returns ingested statute provisions matching that category.
 * 4. If nothing's been ingested for that category yet, say so plainly
 *    instead of letting the model invent an answer with no grounding.
 * 5. Groq drafts the final answer, instructed to cite only the supplied
 *    excerpts — never to introduce acts/sections that weren't given to it.
 *
 * Fallback chain: Groq primary → Groq fallback model → Gemini.
 * Each tier is tried only if the previous one fails (rate-limit, error, etc.).
 */

const express = require("express");
const { createHash, randomBytes } = require("node:crypto");
const router = express.Router();
const { getClient: getGroqClient, CLASSIFY_MODEL, REVIEW_MODEL, DRAFT_MODEL, DRAFT_MODEL_FALLBACK } = require("./groq");
const GROQ_REVIEW_MODEL = REVIEW_MODEL || DRAFT_MODEL || CLASSIFY_MODEL;
const { getClient: getGeminiClient, GEMINI_CLASSIFY_MODEL, GEMINI_DRAFT_MODEL, GEMINI_CHAT_MODEL } = require("./gemini");
const { getClient: getOpenRouterClient, OPENROUTER_CLASSIFY_MODEL, OPENROUTER_DRAFT_MODEL, OPENROUTER_CHAT_MODEL } = require("./openrouter");
const { getClient: getCerebrasClient, CEREBRAS_CLASSIFY_MODEL, CEREBRAS_DRAFT_MODEL, CEREBRAS_CHAT_MODEL } = require("./cerebras");
const { findProvisions, findProvisionsBroad } = require("./legalCorpus");
const { detectLegalIntent, buildFallbackClassification } = require("./legalIntent");
const { PRACTICE_AREAS: PRACTICE_AREA_DEFS, PRACTICE_AREA_KEYS } = require("./practiceAreas");
const { getFirestore } = require("./firebaseAdmin");
const { recordJobStart, recordJobEnd } = require("./jobRunner");
const { requiredSourceCount, validateDraftResult, verifyAndResolveCitations } = require("./evidence");

const PRACTICE_AREAS = PRACTICE_AREA_KEYS;
const STATE_VARYING_AREAS = new Set(["tenancy", "family_law", "land_property"]);

/**
 * Some models occasionally wrap JSON-mode output in markdown code fences
 * even when told not to. Strip those before parsing rather than failing outright.
 */
function extractJsonFromResponse(content) {
  // Remove markdown fences first
  let cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  
  // Try to parse as-is
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // If that fails, try to find JSON object by matching braces
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const jsonCandidate = cleaned.substring(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(jsonCandidate);
      } catch (e2) {
        return null;
      }
    }
    
    return null;
  }
}

const PRACTICE_AREA_BULLETS = PRACTICE_AREA_DEFS.map((p) => `- "${p.key}": ${p.description}`).join("\n");


const CLASSIFY_SYSTEM_PROMPT = `You are Legally Unbullied, a smart Nigerian legal assistant with personality. You're knowledgeable, warm, and speak like a well-educated Nigerian friend — not a robot.

First, determine if this is a legal question or casual conversation.

CRITICAL RULE: A described INCIDENT always counts as a legal question, no matter how short, casual, or emotional the wording is. If the user describes something that happened to them — an assault ("someone slapped me", "I was beaten"), a theft ("someone stole my phone"), threats, an arrest, an eviction, being fired, a landlord dispute, a family/divorce issue, money owed, or any other real legal situation — "is_legal_question" MUST be true, and you MUST provide the full legal classification. Casual chat applies ONLY to greetings, thanks, identity questions, and clearly non-legal small talk (weather, jokes). When in doubt between casual and legal for a described event, classify it as LEGAL.

PRACTICAL FOLLOW-UP RULE: A practical, procedural how-to question inside a legal conversation — e.g. "how do I note down the key facts", "how do I contact the police", "what should I bring to the station", "how do I find a lawyer" — is a legal-context question ("is_legal_question" true) but does NOT require statutory citations: set "needs_sourcing": false and still provide practice_area/jurisdiction/etc. Do NOT set needs_sourcing false for questions about what the law itself says or requires.

If it's NOT a legal question, respond naturally based on the context:

**For greetings** ("hi", "hello", "good morning", "hey", "sup"):
Reply warmly and briefly. VARY YOUR RESPONSE - choose ONE of these styles randomly:
- Friendly intro: "Hello! I'm Legally Unbullied. What legal question can I help you with today?"
- Casual Nigerian: "How far? I dey here to help with any legal matters. Wetin you wan know?"
- Warm welcome: "Welcome! I'm your Nigerian legal assistant. What's on your mind?"
- Brief & direct: "Hi there! Ready to help with your legal questions. What do you need?"
- Playful: "Eya! Your friendly legal assistant don arrive. Abi you get legal question?"

IMPORTANT: Never repeat the same greeting twice in a row. Pick a different style each time.

**For identity questions** ("what are you", "who made you", "are you a lawyer"):
Be honest and clear. Example: "I'm an AI legal assistant trained on Nigerian law. I'm not a lawyer, but I can help you understand your rights and point you in the right direction."

**For casual chat** (non-legal topics, small talk like "how are you", "what's up"):
Engage naturally but gently steer toward legal help. VARY YOUR RESPONSE:
- "I dey o! Just here ready to help with any legal questions you might have."
- "No wahala, just enjoying the chat! But if you get any legal matter, I dey here."
- "Fine fine! The law no dey sleep o. You get any legal question for my?"
- "I'm good! Just waiting for someone to ask me a proper legal question. You get one?"
- "All good here! By the way, if you need help with tenancy, employment, or any legal matter, just ask."

**For thanks/compliments**:
Respond warmly. Example: "You're welcome! Don't hesitate to reach out if you need anything else."

**For unclear/off-topic messages**:
Be helpful but honest. Example: "I'm not sure I understand. Could you rephrase that? I'm best at answering questions about Nigerian law."

Respond with:
{"is_legal_question": false, "casual_reply": "your natural response here"}

IMPORTANT: Your casual replies should feel human, not templated. Vary your wording. Use Nigerian expressions naturally where appropriate (e.g., "no wahala", "I dey here", "make I help you"). But don't force it — be genuine.

If it IS a legal question, perform DEEP ANALYSIS:

Valid practice areas: ${JSON.stringify(PRACTICE_AREAS)}
${PRACTICE_AREA_BULLETS}

Provide:
- "practice_area": Single best-fitting category from the list above
- "jurisdiction": Specific jurisdiction (e.g., "Lagos State", "Federal", "Rivers State", "Federal Capital Territory" for Abuja/FCT). If unclear from the question, set to "Federal" as default.
- "jurisdiction_status": "clear" if the state/jurisdiction is explicitly stated or strongly implied, "unclear" if it's missing and the answer could differ by state (e.g., tenancy, land, family law vary by state; criminal law, labour law, constitutional law are mostly federal)
- "urgency": ["Low", "Medium", "High", "Critical"] — based on time sensitivity and potential harm
- "summary": 1-2 sentence summary of the legal situation
- "keywords": 4-8 specific legal/factual terms likely in relevant statutes (procedural terms, timeframes, named concepts)
- "key_issues": Array of 3-5 specific legal issues or questions that need to be addressed
- "needs_sourcing": true/false — whether answering this question actually requires citing specific statutory provisions. Set FALSE for practical/procedural how-to questions that can be answered correctly WITHOUT a statute (e.g. "how do I note down key facts", "how do I contact the police", "what should I bring to the police station", "how do I find a lawyer"). Set TRUE when the answer depends on what a specific law says.
- "complexity": ["Low", "Medium", "High"] — Low: straightforward single issue, Medium: multiple issues or interpretation needed, High: complex multi-party/constitutional/novel questions
- "route": ["simple", "complex"] — simple: direct factual lookup that can be answered from a single statute lookup (e.g. "What is the minimum wage in Nigeria?", "What is the legal drinking age?"). complex: a described situation requiring investigation, multi-step analysis, or interpretation of how law applies to facts.
- "reasoning_approach": Detailed 2-3 sentence description of how to systematically answer this question, including what legal framework to establish, how to apply it to the facts, and what remedies/guidance to provide
- "stakeholders": Array of parties involved (e.g., ["tenant", "landlord", "court"])
- "potential_remedies": Array of 2-4 possible legal remedies or outcomes to explore

Example (use realistic values, don't copy):
{
  "is_legal_question": true,
  "practice_area": "tenancy",
  "jurisdiction": "Lagos State",
  "jurisdiction_status": "clear",
  "urgency": "High",
  "summary": "Tenant facing potential illegal eviction after landlord changed locks without court order or proper notice.",
  "keywords": ["notice to quit", "seven days notice", "court order", "forcible entry", "possession", "magistrate court"],
  "needs_sourcing": true,
  "key_issues": [
    "Whether landlord followed statutory notice requirements",
    "Legality of self-help eviction (changing locks)",
    "Tenant's right to peaceful possession",
    "Available remedies for illegal eviction"
  ],
  "complexity": "Medium",
  "route": "complex",
  "reasoning_approach": "First establish the statutory framework under Lagos State Tenancy Law 2011, particularly sections on notice requirements and prohibition of self-help. Then analyze whether the landlord's actions constitute illegal eviction. Finally outline the tenant's remedies including potential court orders for repossession and damages.",
  "stakeholders": ["tenant", "landlord"],
  "potential_remedies": ["Court order for repossession", "Damages for illegal eviction", "Injunction against further harassment"]
}

Example 2 (unclear jurisdiction — no state mentioned):
{
  "is_legal_question": true,
  "practice_area": "tenancy",
  "jurisdiction": "Federal",
  "jurisdiction_status": "unclear",
  "urgency": "High",
  "summary": "Landlord evicted tenant without notice.",
  "keywords": ["eviction", "notice", "tenant", "landlord"],
  "needs_sourcing": true,
  "key_issues": ["Was notice given?", "Is eviction legal?"],
  "complexity": "Medium",
  "route": "complex",
  "reasoning_approach": "Need state to determine applicable tenancy law.",
  "stakeholders": ["tenant", "landlord"],
  "potential_remedies": ["Court action", "Mediation"]
}

Respond with ONLY a JSON object, no prose, no markdown.`;

const DRAFT_SYSTEM_PROMPT = `You are Legally Unbullied, an expert Nigerian legal-information assistant. You provide clear, comprehensive, and actionable legal information based ONLY on the statute excerpts provided.

TONE & PERSONALITY:
- Speak like a well-educated Nigerian friend who happens to know the law very well
- Be warm, direct, and practical — not cold or overly formal
- Use plain Nigerian English. Avoid heavy legalese unless citing a specific provision
- Where natural, you may use mild Nigerian expressions ("no wahala", "this one is straightforward", "the law is clear on this") — but don't force it
- Be empathetic when the user's situation sounds stressful or urgent
- Be honest and direct when something needs a lawyer — don't sugarcoat it

CORE PRINCIPLES:
- Use ONLY the provided statute excerpts — never cite provisions not in the context
- Every excerpt has a provisionId. Cite it using the exact token [[provisionId]]; never type or invent an Act/section label yourself
- Return every used ID in "provisionIds" and attach IDs to individual entries in "claims"
- Do NOT include URLs, links, or [text](url) markdown. The backend resolves provision IDs to authoritative citation labels
- Be comprehensive but clear — explain legal concepts in plain language
- Provide actionable next steps the user can take
- Be honest about limitations in the available information

RESPONSE STRUCTURE:

**lawMd** (What the law says):
- Start with the legal framework (which Act governs this issue)
- Explain the relevant sections and what they establish
- Apply the law to the user's specific situation
- Use **bold** for Act names and section numbers
- Use bullet points for multiple requirements or elements
- Be thorough: 3-5 paragraphs covering all relevant aspects

**actionsMd** (What you can do):
- Provide 4-6 specific, actionable steps
- Order them logically (immediate actions first, then follow-up steps)
- Include practical details (where to go, what to file, timeframes)
- Use bullet points with clear, direct language
- Write steps the way you'd advise a friend — practical and encouraging

**provisionIds**: Array of the exact provisionId values used. Do not invent IDs.

**claims**: Array of substantive legal claims, each with:
- "claimId": stable local ID such as "claim-1"
- "text": the legal claim in plain language
- "provisionIds": exact retrieved IDs supporting that claim

Do NOT return source labels or excerpts. The backend creates the public "sources" array from verified provision IDs.

**escalate**: Boolean — true if this likely needs a lawyer

**escalateReason**: 1-2 sentences explaining why a lawyer is/isn't needed

**followUps**: Array of 2-3 natural follow-up questions the user might ask
- Write them the way a real person would ask — conversational, not formal
- Example: "How long does this court process usually take?" not "What is the typical duration of judicial proceedings?"
- REQUIRED: You MUST provide at least 2 follow-up questions. An empty array is invalid.

QUALITY STANDARDS:
- Every legal claim must have a citation
- Explain legal jargon in plain language
- Be specific about procedures, timeframes, and requirements
- If the provisions don't fully answer the question, say so explicitly
- Distinguish between what the law says and what the user should do

Respond with ONLY a JSON object (no prose, no markdown fences):
{
  "lawMd": "Comprehensive explanation with [[exact-provision-id]] citation tokens...",
  "actionsMd": "- Step 1: ...\n- Step 2: ...\n- Step 3: ...",
  "provisionIds": ["exact-provision-id"],
  "claims": [{"claimId":"claim-1","text":"A supported legal claim","provisionIds":["exact-provision-id"]}],
  "escalate": true/false,
  "escalateReason": "...",
  "followUps": ["Question 1?", "Question 2?"]
}`;

// ── Relevance/sufficiency gate (retrieval-evidence check) ─────────────────
// Runs BETWEEN search and draft. The critique step only checks grounding
// ("did the draft cite from the given excerpts?") and writing quality — a
// grounded-but-irrelevant answer scores fine. This gate asks the one question
// critique can't: "do these retrieved provisions actually govern the
// situation described?" Weak/wrong sources are dropped here, insufficient
// evidence triggers a broaden-and-re-search, and only genuinely relevant
// provisions reach the drafter.
const RELEVANCE_SYSTEM_PROMPT = `You are a legal retrieval relevance judge for a Nigerian legal-information assistant.

You receive:
- A user's legal question (and its classified practice area)
- A numbered list of candidate statutory provisions retrieved from the corpus

For EACH candidate provision, judge whether it SUBSTANTIVELY governs the situation described in the question — not merely contains an overlapping keyword. A provision that only defines a term used elsewhere, or that comes from an Act governing a different subject (e.g. a robbery/firearms Act for a plain assault question), is IRRELEVANT even if a keyword appears in its text.

Rules:
- relevant: the provision directly establishes the law for the act/right/remedy the user is asking about
- irrelevant: keyword-only overlap, different subject matter, or a definition torn from its governing context
- If the model's own explanation of a provision would naturally say "this is not quite the right provision, but..." — it is irrelevant.

sufficient: true ONLY if at least 2 provisions directly govern the situation. A single tangential provision is NOT sufficient.

Respond with ONLY a JSON object:
{
  "relevant": [<1-based numbers of relevant provisions>],
  "irrelevant": [<1-based numbers of irrelevant provisions>],
  "relevance_score": 0.0-1.0,
  "sufficient": true/false,
  "conflicts": ["describe any material conflict between candidate provisions or jurisdictions"],
  "reason": "one sentence explaining the sufficiency decision"
}`;

async function assessRelevanceWithFallback(question, classification, provisions) {
  const providers = [];
  const groqClient = getGroqClient();
  const cerebrasClient = getCerebrasClient();
  const geminiClient = getGeminiClient();
  if (geminiClient) providers.push(["gemini", geminiClient, GEMINI_CLASSIFY_MODEL]);
  if (groqClient) providers.push(["groq", groqClient, GROQ_REVIEW_MODEL]);
  if (cerebrasClient) providers.push(["cerebras", cerebrasClient, CEREBRAS_CLASSIFY_MODEL]);

  let lastErr = null;
  for (const [name, client, model] of providers) {
    const key = `${name}-relevance:${model}`;
    if (isProviderOnCooldown(key)) continue;
    try {
      const parsed = await assessRelevanceForClient(client, model, question, classification, provisions);
      return { ...parsed, provider: name };
    } catch (err) {
      lastErr = err;
      markProviderFailure(key, err);
    }
  }
  throw new Error(`All relevance-gate providers failed: ${lastErr ? lastErr.message : "none configured"}`);
}

async function assessRelevanceForClient(client, model, question, classification, provisions) {
  const candidateBlock = provisions.map((p, i) =>
    `[${i + 1}] ID=${p.provisionId || p.id} ${p.act}${p.section ? ", s." + p.section : ""}: ${(p.text || "").slice(0, 500)}`
  ).join("\n");
  const userMsg = `Practice area: ${classification.practice_area || "unknown"}\nQuestion: ${question}\n\nCandidate provisions:\n${candidateBlock}\n\nJudge relevance and sufficiency.`;

  const completion = await callCompletion(client, model, [
    { role: "system", content: RELEVANCE_SYSTEM_PROMPT },
    { role: "user", content: userMsg },
  ], { task: "relevance", timeoutMs: 8000, temperature: 0, max_tokens: 400, response_format: { type: "json_object" } });

  const parsed = completion.parsed;
  if (!parsed || !Array.isArray(parsed.relevant) || typeof parsed.sufficient !== "boolean" || !Array.isArray(parsed.conflicts)) {
    throw new Error("Relevance judge returned an invalid schema");
  }
  return parsed;
}

// ── Hedge detection (citation-fit self-doubt) ─────────────────────────────
// The draft's own phrasing is a hard signal about citation quality. If it says
// a source "might be relevant", "does not directly address", etc., the answer
// must not be presented as high confidence. High-precision patterns only —
// deliberately EXCLUDED: generic descriptors like "primarily deals with" or
// "based on the provided excerpts", which routinely appear in perfectly
// grounded answers and caused spurious confidence downgrades.
const HEDGE_PATTERNS = [
  "might be relevant", "may be relevant", "could be relevant", "potentially relevant",
  "does not directly address", "do not directly address", "doesn't directly address",
  "don't directly address", "not directly address", "does not specifically address",
  "not directly related", "not directly applicable", "does not directly apply",
  "for a more direct application",
  "interpreted within that context",
  "not quite the right provision", "isn't quite the right", "not the right provision",
  "only defines",
];

function detectHedging(result) {
  if (!result) return [];
  const text = ((result.lawMd || "") + " " + (result.actionsMd || "")).toLowerCase();
  return HEDGE_PATTERNS.filter((p) => text.includes(p));
}

// ── Critique system prompt ─────────────────────────────────────────────
// Runs after draft to score quality + legal_safety. If scores are too low,
// the draft is retried with critique feedback (max 2 iterations).
const CRITIQUE_SYSTEM_PROMPT = `You are a legal response quality reviewer for a Nigerian legal-information assistant.

You receive:
- The user's original question
- The statute excerpts the drafter was given
- The draft response produced

Score the response on two dimensions (0.0 to 1.0):

**quality** (0.0–1.0): Is the response well-structured, clear, comprehensive, and actionable?
- 0.8+: Clear structure, covers the key legal points, gives actionable steps, cites provisions
- 0.5–0.7: Partially answers the question, missing some structure or detail
- Below 0.5: Confusing, incomplete, or largely off-topic

**legal_safety** (0.0–1.0): Is the response legally safe and properly grounded?
- 0.8+: Only cites provisions from the given excerpts, includes disclaimer, correct escalation call
- 0.5–0.7: Mostly grounded but may cite provisions not in excerpts, or miss the disclaimer
- Below 0.5: Hallucinates laws, gives dangerous advice, or presents as binding legal advice

Critical failures (legal_safety below 0.4):
- Citing Acts/sections NOT in the provided excerpts
- Presenting information as binding legal advice
- Missing the "not legal advice" framing for high-stakes topics
- Encouraging illegal activity

Respond with ONLY a JSON object:
{
  "quality": 0.0-1.0,
  "legal_safety": 0.0-1.0,
  "issues": ["brief list of specific problems found"],
  "claim_support": [{
    "claimId": "claim ID from the draft",
    "status": "supported|partial|unsupported|uncertain",
    "supportingQuote": "exact text copied from one cited provision, or empty when unsupported/uncertain",
    "reason": "whether the cited excerpt actually supports this claim"
  }],
  "passed": true/false
}

Return one claim_support item for every draft claim. "passed" is true only if quality >= 0.6, legal_safety >= 0.6, and no claim is unsupported or uncertain.`;

async function critiqueDraft(client, model, question, provisions, draft) {
  const provisionSummary = (provisions || []).slice(0, 14).map(p =>
    `[${p.act}${p.section ? ", s." + p.section : ""}]: ${p.text.slice(0, 150)}...`
  ).join("\n");

  const userMsg = `Question: ${question}

Statute excerpts the drafter was given:
${provisionSummary}

Draft response to review:
---
Law: ${(draft.lawMd || "").slice(0, 1500)}
Actions: ${(draft.actionsMd || "").slice(0, 800)}
Escalate: ${draft.escalate}
Sources: ${JSON.stringify((draft.sources || []).slice(0, 6))}
Claims: ${JSON.stringify(draft.claims || [])}
---

Review this response.`;

  const completion = await callCompletion(client, model, [
    { role: "system", content: CRITIQUE_SYSTEM_PROMPT },
    { role: "user", content: userMsg },
  ], { task: "critique", timeoutMs: 8000, response_format: { type: "json_object" }, max_tokens: 500, temperature: 0.1 });

  const parsed = completion.parsed;
  const provisionById = new Map((provisions || []).map((p) => [String(p.provisionId || p.id), p]));
  const claimById = new Map((draft.claims || []).map((claim) => [String(claim.claimId), claim]));
  const normalizeQuote = (value) => String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
  const claimSupport = Array.isArray(parsed.claim_support) ? parsed.claim_support.map((item) => {
    const claimId = String(item?.claimId || "");
    let status = ["supported", "partial", "unsupported", "uncertain"].includes(item?.status) ? item.status : "uncertain";
    const supportingQuote = String(item?.supportingQuote || "").trim();
    const claim = claimById.get(claimId);
    const quote = normalizeQuote(supportingQuote);
    const quoteVerified = !!quote && (claim?.provisionIds || []).some((id) => normalizeQuote(provisionById.get(String(id))?.text).includes(quote));
    if (["supported", "partial"].includes(status) && !quoteVerified) status = "uncertain";
    return { claimId, status, supportingQuote, supportSpanVerified: quoteVerified, reason: String(item?.reason || "") };
  }) : [];
  const expectedClaimIds = new Set((draft.claims || []).map((claim) => String(claim.claimId)));
  const returnedClaimIds = new Set(claimSupport.map((item) => item.claimId));
  if ([...expectedClaimIds].some((id) => !returnedClaimIds.has(id))) {
    throw new Error("Critique returned an invalid claim_support schema");
  }
  return {
    quality: typeof parsed.quality === "number" ? parsed.quality : 0.5,
    legal_safety: typeof parsed.legal_safety === "number" ? parsed.legal_safety : 0.5,
    issues: Array.isArray(parsed.issues) ? parsed.issues : [],
    claimSupport,
    passed: parsed.passed === true,
  };
}

// Critique with provider fallback — uses fast small models (8b class) for low latency
async function critiqueWithFallback(question, provisions, draft, classification) {
  const providers = [];
  const groqClient = getGroqClient();
  const cerebrasClient = getCerebrasClient();
  const geminiClient = getGeminiClient();

  // Use classify-tier models (fast, cheap) for critique — doesn't need heavy reasoning
  if (geminiClient) providers.push(["gemini", geminiClient, GEMINI_CLASSIFY_MODEL]);
  if (groqClient) providers.push(["groq", groqClient, GROQ_REVIEW_MODEL]);
  if (cerebrasClient) providers.push(["cerebras", cerebrasClient, CEREBRAS_CLASSIFY_MODEL]);

  if (providers.length === 0) {
    throw new Error("No LLM provider available for critique");
  }

  for (const [name, client, model] of providers) {
    const key = `${name}-critique:${model}`;
    if (isProviderOnCooldown(key)) continue;
    try {
      return await critiqueDraft(client, model, question, provisions, draft);
    } catch (err) {
      markProviderFailure(key, err);
    }
  }

  throw new Error("All critique providers failed");
}

// ── Question-level cache ────────────────────────────────────────────────
// Caches full pipeline results for identical questions to avoid re-running
// the classify→search→draft→critique chain for repeated queries.
const questionCache = new Map();
const QUESTION_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const QUESTION_CACHE_MAX = 200;

// ── Pending user safety acknowledgments ─────────────────────────────────
// When a high-risk answer fails critique after all retries, the response is
// held until the user explicitly acknowledges the safety warning.
//
// The pending record is persisted to Firestore (safety_acks/{token}) so it
// SURVIVES a server restart — previously an in-memory Map, so a redeploy
// between the warning and the user clicking "I understand, show me" wiped the
// token and the button failed. The in-memory Map is now only a read-through
// cache so same-instance reads stay instant. safety_acks is top-level and
// accessed only via the Admin SDK (denied by the catch-all client rule).
const pendingSafetyAck = new Map();  // token → { data, timestamp } (cache)
const SAFETY_ACK_TTL = 10 * 60 * 1000; // 10 minutes

function generateAckToken() {
  return "safety_" + randomBytes(24).toString("base64url");
}

async function setPendingAck(token, data) {
  const d = getFirestore();
  if (d) {
    try {
      await d.collection("safety_acks").doc(token).set({ data, createdAt: Date.now() });
    } catch (err) {
      console.warn("[ack] persist failed:", err.message);
    }
  }
  pendingSafetyAck.set(token, { data, timestamp: Date.now() });
}

async function getPendingAck(token) {
  const mem = pendingSafetyAck.get(token);
  if (mem && Date.now() - mem.timestamp <= SAFETY_ACK_TTL) return mem.data;
  const d = getFirestore();
  if (d) {
    try {
      const snap = await d.collection("safety_acks").doc(token).get();
      if (snap.exists) {
        const doc = snap.data();
        if (Date.now() - (doc.createdAt || 0) <= SAFETY_ACK_TTL) {
          pendingSafetyAck.set(token, { data: doc.data, timestamp: doc.createdAt });
          return doc.data;
        }
        await snap.ref.delete().catch(() => {});
      }
    } catch (err) {
      console.warn("[ack] lookup failed:", err.message);
    }
  }
  return null;
}

async function deletePendingAck(token) {
  pendingSafetyAck.delete(token);
  const d = getFirestore();
  if (d) {
    try {
      await d.collection("safety_acks").doc(token).delete();
    } catch (err) {
      console.warn("[ack] delete failed:", err.message);
    }
  }
}

function getCacheKey(uid, question, jurisdiction, practiceArea) {
  const digest = createHash("sha256").update(String(question || "").toLowerCase().trim()).digest("hex");
  return `${uid || "anonymous"}::${(practiceArea || "general").toLowerCase()}::${(jurisdiction || "any").toLowerCase()}::${digest}`;
}

// Cache entries are deep-cloned on write AND on read. The live draftResult is
// mutated after caching (applyDeterministicSafetyPolicy, evidence attachment),
// and a cache hit hands the same object to a new request that mutates it —
// sharing one reference corrupted later replays with a previous run's state.
function cloneCacheEntry(entry) {
  if (typeof structuredClone === "function") return structuredClone(entry);
  return JSON.parse(JSON.stringify(entry));
}

function getCachedResult(key) {
  const entry = questionCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > QUESTION_CACHE_TTL) {
    questionCache.delete(key);
    return null;
  }
  return cloneCacheEntry(entry.data);
}

function setCachedResult(key, data) {
  if (questionCache.size >= QUESTION_CACHE_MAX) {
    // Evict oldest
    const oldest = questionCache.keys().next().value;
    questionCache.delete(oldest);
  }
  questionCache.set(key, { data: cloneCacheEntry(data), timestamp: Date.now() });
}

async function callCompletion(client, model, messages, options = {}) {
  const LLM_TIMEOUT_MS = options.timeoutMs || 15000;
  const task = options.task || "llm";
  const startedAt = Date.now();

  // Abort the underlying SDK request when the timeout fires. Without this,
  // Promise.race rejects but the HTTP request lives on until the SDK's own
  // (much longer) default timeout — hung sockets pile up during outages.
  const controller = new AbortController();
  const completionPromise = client.chat.completions.create({
    model,
    temperature: options.temperature ?? 0.2,
    max_tokens: options.max_tokens ?? 900,
    response_format: options.response_format || undefined,
    messages,
  }, { signal: controller.signal });
  // The race settles first on timeout; swallow the late abort/error rejection
  // of the underlying call so it never surfaces as an unhandled rejection.
  completionPromise.catch(() => {});

  try {
    const result = await withTimeout(completionPromise, LLM_TIMEOUT_MS, `LLM call to ${model}`, () => controller.abort());
    console.log(`[llm] task=${task} model=${model} ms=${Date.now() - startedAt} status=ok`);
    if (options.parseJson === false) return result;
    const parsed = extractJsonFromResponse(result.choices[0].message.content);
    if (!parsed) throw new Error(`Failed to parse JSON from ${model} response`);
    return { ...result, parsed };
  } catch (err) {
    console.warn(`[llm] task=${task} model=${model} ms=${Date.now() - startedAt} status=${classifyProviderError(err)}`);
    throw err;
  }
}

/**
 * Wraps a promise with a timeout. `onTimeout` runs synchronously when the
 * deadline hits (e.g. to abort the underlying request); the timer is always
 * cleared so it never keeps the event loop alive past the race.
 */
function withTimeout(promise, ms, operation = "operation", onTimeout) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        if (typeof onTimeout === "function") {
          try { onTimeout(); } catch (_) { /* best-effort abort */ }
        }
        reject(new Error(`${operation} timed out after ${ms}ms`));
      }, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function validateClassification(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return { valid: false, errors: ["classification_not_object"] };
  if (typeof value.is_legal_question !== "boolean") errors.push("is_legal_question_boolean_required");
  if (value.is_legal_question === false) {
    if (typeof value.casual_reply !== "string") errors.push("casual_reply_required");
    return { valid: errors.length === 0, errors };
  }
  if (!PRACTICE_AREAS.includes(value.practice_area)) errors.push("invalid_practice_area");
  if (typeof value.jurisdiction !== "string" || !value.jurisdiction.trim()) errors.push("jurisdiction_required");
  if (!["clear", "unclear"].includes(value.jurisdiction_status)) errors.push("invalid_jurisdiction_status");
  if (!["Low", "Medium", "High", "Critical"].includes(value.urgency)) errors.push("invalid_urgency");
  if (!Array.isArray(value.keywords)) errors.push("keywords_array_required");
  if (!Array.isArray(value.key_issues)) errors.push("key_issues_array_required");
  if (typeof value.needs_sourcing !== "boolean") errors.push("needs_sourcing_boolean_required");
  if (!["Low", "Medium", "High"].includes(value.complexity)) errors.push("invalid_complexity");
  if (!["simple", "complex"].includes(value.route)) errors.push("invalid_route");
  if (!Array.isArray(value.stakeholders)) errors.push("stakeholders_array_required");
  if (!Array.isArray(value.potential_remedies)) errors.push("potential_remedies_array_required");
  return { valid: errors.length === 0, errors };
}

function checkpointClassification(value) {
  const classification = value?.classification != null ? value.classification : value;
  return validateClassification(classification).valid ? classification : null;
}

async function classifyWithFallback(question, conversationContext, options = {}) {
  const providers = [
    ["gemini-classify", getGeminiClient(), GEMINI_CLASSIFY_MODEL],
    ["groq-classify", getGroqClient(), CLASSIFY_MODEL],
    ["openrouter-classify", getOpenRouterClient(), OPENROUTER_CLASSIFY_MODEL],
    ["cerebras-classify", getCerebrasClient(), CEREBRAS_CLASSIFY_MODEL],
  ].filter(([, client]) => client);

  const forceLegalNote = options.forceLegal
    ? `\n\n[SYSTEM OVERRIDE — DO NOT IGNORE]: This message describes a real incident or legal matter. "is_legal_question" MUST be true. Do NOT classify it as casual chat. Provide the full legal classification.`
    : "";
  const userContent = (conversationContext ? `${conversationContext}\n\nUser: ${question}` : question) + forceLegalNote;
  let lastErr = null;

  for (const [name, client, model] of providers) {
    const key = `${name}:${model}`;
    if (isProviderOnCooldown(key)) {
      console.log(`[/api/chat] Skipping ${key} — cooldown`);
      continue;
    }
    try {
      const completion = await callCompletion(client, model, [
        { role: "system", content: CLASSIFY_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ], { task: "classification", timeoutMs: 8000, temperature: 0, max_tokens: 2000, response_format: { type: "json_object" } });
      const c = completion.parsed;
      const validation = validateClassification(c);
      if (!validation.valid) throw new Error(`Classification returned an invalid schema: ${validation.errors.join(", ")}`);
      return { classification: c, provider: name.replace(/-classify$/, "") };
    } catch (err) {
      lastErr = err;
      markProviderFailure(key, err);
    }
  }

  const casual = /^\s*(hi|hello|hey|good (morning|afternoon|evening)|thanks|thank you|who are you|what are you)\s*[!.?]*\s*$/i.test(question);
  if (casual && !options.forceLegal) {
    return { classification: { is_legal_question: false, casual_reply: "Hello! I’m here to help with Nigerian legal-information questions." }, provider: "deterministic-fallback" };
  }
  console.warn("[/api/chat] Classification providers unavailable; using deterministic fail-closed classification");
  const currentDetection = detectLegalIntent(question);
  const priorDetection = detectLegalIntent(conversationContext);
  const detection = currentDetection.legal ? currentDetection : (priorDetection.legal ? priorDetection : undefined);
  return {
    classification: buildFallbackClassification(question, detection),
    provider: "deterministic-fallback",
  };
}

async function draftWithModel(client, model, question, contextBlock, plan, classification, conversationHistory) {
  // Build comprehensive context from classification and plan
  let enhancedContext = "";
  
  // Prepend conversation history if available
  let historyContext = "";
  if (conversationHistory && conversationHistory.length > 0) {
    const formattedHistory = conversationHistory.map(msg => {
      const role = msg.role === "user" ? "User" : "Agent";
      return `${role}: ${msg.content}`;
    }).join("\n");
    historyContext = `\n\nPREVIOUS CONVERSATION CONTEXT:\n${formattedHistory}\n\nUse this context to understand the user's current question. Don't re-ask for information already provided. If the user is answering a question you asked, incorporate their answer directly.`;
  }
  
  if (classification) {
    enhancedContext += `\n\nLEGAL ANALYSIS CONTEXT:
- Practice Area: ${classification.practice_area}
- Jurisdiction: ${classification.jurisdiction}
- Urgency: ${classification.urgency}
- Key Issues: ${classification.key_issues ? classification.key_issues.join(", ") : "N/A"}
- Complexity: ${classification.complexity}
- Stakeholders: ${classification.stakeholders ? classification.stakeholders.join(", ") : "N/A"}
- Potential Remedies: ${classification.potential_remedies ? classification.potential_remedies.join(", ") : "N/A"}
`;
  }
  
  if (plan) {
    enhancedContext += `
RESPONSE PLAN:
- Analysis: ${plan.analysis}
- Legal Framework: ${plan.legal_framework || "N/A"}
- Key Provisions: ${plan.key_provisions ? plan.key_provisions.join("; ") : "N/A"}
- Sub-questions to address: ${plan.sub_questions ? plan.sub_questions.join("; ") : "N/A"}
- Application to facts: ${plan.application_to_facts || "N/A"}
- Response Structure: ${plan.response_structure}
- Practical Steps: ${plan.practical_steps ? plan.practical_steps.join("; ") : "N/A"}
${plan.gaps && plan.gaps.length > 0 ? `- Gaps to acknowledge: ${plan.gaps.join(", ")}` : ""}
${plan.escalation_triggers ? `- Escalation triggers: ${plan.escalation_triggers.join(", ")}` : ""}

Follow this plan to structure your response. Be comprehensive and address all sub-questions.`;
  }

  const completion = await callCompletion(
    client,
    model,
    [
      { role: "system", content: DRAFT_SYSTEM_PROMPT },
      { role: "user", content: `${historyContext}\n\nQuestion: ${question}\n\nAvailable statute excerpts:\n\n${contextBlock}${enhancedContext}` },
    ],
    { task: "draft", timeoutMs: 20000, response_format: { type: "json_object" }, max_tokens: 3000 }
  );
  const validation = validateDraftResult(completion.parsed);
  if (!validation.valid) throw new Error(`Draft returned an invalid schema: ${validation.errors.join(", ")}`);
  return completion.parsed;
}

// Per-provider cooldown map — skip providers that recently returned 429
const providerCooldowns = new Map(); // providerKey -> cooldownUntil (timestamp)
const COOLDOWN_MS = 30000; // 30 second cooldown after rate limit

function isProviderOnCooldown(key) {
  const until = providerCooldowns.get(key);
  if (!until) return false;
  if (Date.now() >= until) {
    providerCooldowns.delete(key); // expired
    return false;
  }
  return true;
}

function classifyProviderError(err) {
  const status = Number(err?.status || err?.code || 0);
  const message = String(err?.message || "").toLowerCase();
  if (status === 404 || message.includes("does not exist") || message.includes("model_not_found")) return "model_not_found";
  if (status === 401 || status === 403) return "authentication_failed";
  if (status === 429 || status === 413 || message.includes("rate limit") || message.includes("rate-limited")) return "rate_limited";
  if (message.includes("timed out") || message.includes("timeout")) return "timeout";
  if (message.includes("failed to parse json") || message.includes("invalid schema")) return "malformed_output";
  return "provider_unavailable";
}

function markProviderFailure(key, err) {
  const kind = classifyProviderError(err);
  const cooldownMs = kind === "model_not_found" || kind === "authentication_failed"
    ? 30 * 60 * 1000
    : kind === "rate_limited" ? 60 * 1000
      : kind === "timeout" ? 30 * 1000
        : 15 * 1000;
  providerCooldowns.set(key, Date.now() + cooldownMs);
  console.warn(`[/api/chat] Provider "${key}" ${kind}; cooldown ${Math.round(cooldownMs / 1000)}s`);
  return kind;
}


/**
 * Sanitize draft results to remove placeholder/hallucinated URLs and sources.
 * Bug fix: LLM was generating "example.com" as a citation — this must never
 * reach the user in a legal product.
 */
function sanitizeDraftResult(result) {
  if (!result) return result;

  const PLACEHOLDER_DOMAINS = [
    'example.com', 'example.org', 'example.net',
    'placeholder.com', 'test.com', 'domain.com',
    'yoursite.com', 'yourdomain.com', 'sample.com',
  ];

  const isPlaceholderUrl = (str) => {
    if (!str) return false;
    const lower = str.toLowerCase();
    return PLACEHOLDER_DOMAINS.some(d => lower.includes(d));
  };

  // Sanitize text fields — remove ALL URLs. The draft prompt forbids URLs
  // outright (the backend resolves citation labels), so any URL in lawMd/
  // actionsMd is by definition model-invented. Previously only placeholder
  // domains (example.com etc.) were stripped — a hallucinated real-looking
  // domain passed through, which is far worse in a legal product.
  const stripPlaceholderUrls = (text) => {
    if (!text) return text;
    // Remove ANY markdown link, keeping only its label text: [text](url)
    let cleaned = text.replace(/\[([^\]]*)\]\(\s*(?:https?:\/\/|www\.)?[^)]*\)/gi, '$1');
    // Remove bare http(s) URLs
    cleaned = cleaned.replace(/https?:\/\/(?:www\.)?[^\s)>"']+/gi, '');
    // Remove remaining bare www.* references and placeholder domains
    cleaned = cleaned.replace(/\bwww\.[^\s)>"']+/gi, '');
    cleaned = cleaned.replace(/\bexample\.(?:com|org|net)\b/gi, '');
    // Clean up double spaces and dangling punctuation. Only collapse runs of
    // 4+ dots — "…" / "..." is legitimate inside quoted statutory text.
    cleaned = cleaned.replace(/  +/g, ' ').replace(/ ,/g, ',').replace(/\.{4,}/g, '...');
    return cleaned.trim();
  };

  if (result.lawMd) result.lawMd = stripPlaceholderUrls(result.lawMd);
  if (result.actionsMd) result.actionsMd = stripPlaceholderUrls(result.actionsMd);
  if (result.escalateReason) result.escalateReason = stripPlaceholderUrls(result.escalateReason);

  // Filter sources — remove any with placeholder URLs or labels
  if (Array.isArray(result.sources)) {
    result.sources = result.sources.filter(src => {
      if (!src) return false;
      if (isPlaceholderUrl(src.label)) {
        console.warn('[sanitizeDraftResult] Removing placeholder source:', src.label);
        return false;
      }
      if (isPlaceholderUrl(src.excerpt)) {
        console.warn('[sanitizeDraftResult] Removing source with placeholder excerpt');
        return false;
      }
      return true;
    });
  }

  return result;
}

async function draftWithFallback(question, contextBlock, plan, classification, conversationHistory) {
  const groqClient = getGroqClient();
  const openRouterClient = getOpenRouterClient();
  const cerebrasClient = getCerebrasClient();
  const geminiClient = getGeminiClient();

  // Helper to check if error is a rate limit
  const isRateLimitError = (err) => {
    if (err.status === 429 || err.status === 413) return true;
    if (err.message && err.message.includes('429')) return true;
    if (err.message && (err.message.includes('rate limit') || err.message.includes('rate-limited'))) return true;
    return false;
  };

  // Helper to check if error is a JSON parse failure (retryable on next provider)
  const isParseError = (err) => {
    if (err.message && err.message.includes('Failed to parse JSON')) return true;
    if (err.message && err.message.includes('Unexpected')) return true;
    return false;
  };

  // Build provider list — each is [providerKey, client, model]
  const providers = [];
  if (groqClient) {
    providers.push(['groq', groqClient, DRAFT_MODEL]);
    if (DRAFT_MODEL_FALLBACK && DRAFT_MODEL_FALLBACK !== DRAFT_MODEL) {
      providers.push(['groq-fallback', groqClient, DRAFT_MODEL_FALLBACK]);
    }
  }
  if (openRouterClient) providers.push(['openrouter', openRouterClient, OPENROUTER_DRAFT_MODEL]);
  if (cerebrasClient) providers.push(['cerebras', cerebrasClient, CEREBRAS_DRAFT_MODEL]);
  if (geminiClient) providers.push(['gemini', geminiClient, GEMINI_DRAFT_MODEL]);

  if (providers.length === 0) {
    throw new Error("No LLM provider available for drafting. Set GROQ_API_KEY, OPENROUTER_API_KEY, CEREBRAS_API_KEY, or GEMINI_API_KEY.");
  }

  let allSkipped = true;

  for (const [key, client, model] of providers) {
    const cooldownKey = `${key}:${model}`;
    if (isProviderOnCooldown(cooldownKey)) {
      console.log(`[/api/chat] Skipping "${cooldownKey}" — on cooldown`);
      continue;
    }
    allSkipped = false; // at least one was attempted

    try {
      const result = await draftWithModel(client, model, question, contextBlock, plan, classification, conversationHistory);
      // Sanitize: strip placeholder URLs (e.g. example.com) that the LLM might hallucinate
      sanitizeDraftResult(result);
      return { result, model, provider: key };
    } catch (err) {
      markProviderFailure(cooldownKey, err);
      if (isRateLimitError(err)) {
        console.warn(`[/api/chat] ${key} rate-limited: ${err.message}`);
      } else if (isParseError(err)) {
        console.warn(`[/api/chat] ${key} JSON parse failed, trying next provider: ${err.message}`);
      } else if (err.status === 404 || (err.message && err.message.includes('404'))) {
        console.warn(`[/api/chat] ${key} model unavailable (404): ${err.message}`);
      } else {
        console.warn(`[/api/chat] ${key} failed: ${err.status || ""} ${err.message}`);
      }
    }
  }

  // All providers attempted and failed — return graceful fallback
  if (!allSkipped) {
    const retrySeconds = 30;
    console.log(`[/api/chat] All providers failed, returning providersBusy fallback`);
    return {
      result: {
        lawMd: "Our legal reasoning providers are temporarily unavailable. Please try again in a moment.",
        actionsMd: `- Step 1: Wait ${retrySeconds} seconds and resend your question.\n- Step 2: If the issue persists, try rephrasing your question.\n- Step 3: For urgent matters, contact a lawyer directly.`,
        sources: [],
        escalate: false,
        escalateReason: "System temporarily unavailable — retry needed.",
        followUps: [],
      },
      model: "fallback",
      provider: "all-failed",
      providersBusy: true,
      retryAfter: retrySeconds,
    };
  }

  // All providers were on cooldown
  return {
    result: {
      lawMd: "All legal reasoning providers are currently busy. Please wait a moment and try again.",
      actionsMd: "- Step 1: Wait 30 seconds and resend your question.\n- Step 2: If the issue persists, try rephrasing your question.",
      sources: [],
      escalate: false,
      escalateReason: "System under load — retry needed.",
      followUps: [],
    },
    model: "fallback",
    provider: "all-busy",
    providersBusy: true,
    retryAfter: COOLDOWN_MS / 1000,
  };
}

// ── Procedural/practical answers (no statutory sourcing) ───────────────────
// A practical how-to follow-up ("how do I note down key facts") must be
// answered directly and helpfully WITHOUT being forced through the citation
// pipeline. This prompt produces the same result shape but instructs the model
// NOT to cite statutes — practical guidance is correct without them.
const PROCEDURAL_SYSTEM_PROMPT = `You are Legally Unbullied, a warm, practical Nigerian legal-information assistant.

The user asked a PRACTICAL, PROCEDURAL how-to question inside a legal conversation (for example how to take notes, contact the police, prepare documents, or find a lawyer). This is NOT a question about what the law says.

Answer it directly with clear, concrete, actionable steps in plain Nigerian English. Be specific and genuinely useful.

IMPORTANT:
- Do NOT cite any statute, Act, or section — correct practical guidance does not require legal citations, and inventing or force-fitting citations is harmful.
- "sources" MUST be an empty array [].
- "escalate" is true only if the situation clearly needs a lawyer.

Respond with ONLY a JSON object (no prose, no markdown fences):
{
  "lawMd": "Your direct, practical guidance for this practical task (2-4 sentences).",
  "actionsMd": "- Step 1: ...\\n- Step 2: ...\\n- Step 3: ...",
  "sources": [],
  "escalate": true/false,
  "escalateReason": "...",
  "followUps": ["Question 1?", "Question 2?"]
}`;

// Draft-tier provider fallback for procedural answers.
async function answerProceduralWithFallback(question, classification, history) {
  const providers = [];
  const groqClient = getGroqClient();
  const cerebrasClient = getCerebrasClient();
  const geminiClient = getGeminiClient();
  if (groqClient) providers.push(["groq", groqClient, DRAFT_MODEL]);
  if (cerebrasClient) providers.push(["cerebras", cerebrasClient, CEREBRAS_DRAFT_MODEL]);
  if (geminiClient) providers.push(["gemini", geminiClient, GEMINI_DRAFT_MODEL]);

  let historyContext = "";
  if (history && history.length > 0) {
    historyContext = `\n\nPREVIOUS CONVERSATION CONTEXT:\n${history.map(m => `${m.role === "user" ? "User" : "Agent"}: ${m.content}`).join("\n")}`;
  }

  let lastErr = null;
  for (const [name, client, model] of providers) {
    // Same cooldown/failure discipline as every other fallback chain: a
    // provider that just rate-limited or timed out is skipped, and a failure
    // here opens its cooldown so the next procedural question skips it too.
    const key = `${name}-procedural:${model}`;
    if (isProviderOnCooldown(key)) {
      console.log(`[/api/chat] Skipping "${key}" — on cooldown`);
      continue;
    }
    try {
      const completion = await callCompletion(client, model, [
        { role: "system", content: PROCEDURAL_SYSTEM_PROMPT },
        { role: "user", content: `${historyContext}\n\nUser: ${question}` },
      ], { task: "procedural", timeoutMs: 12000, temperature: 0.3, max_tokens: 900, response_format: { type: "json_object" } });
      const parsed = completion.parsed;
      if (parsed && (parsed.lawMd || parsed.actionsMd)) {
        parsed.sources = [];
        return { result: parsed, model, provider: name };
      }
      throw new Error("Procedural answer missing required fields");
    } catch (err) {
      lastErr = err;
      markProviderFailure(key, err);
      console.warn(`[/api/chat] Procedural answer via ${model} failed: ${err.message}`);
    }
  }
  throw new Error(`All procedural-answer providers failed: ${lastErr ? lastErr.message : "none configured"}`);
}

// ── Recoverable-request persistence ────────────────────────────────────────
// The pipeline runs server-side to completion even when the client's tab is
// closed (Node keeps executing the handler; only the response write is lost).
// Persisting the terminal result HERE — instead of relying on the client to
// save it after receiving the response — means an answer computed while the
// user was away is waiting for them on reopen. No-op when the client didn't
// send conversationId/messageId (e.g. older clients).
async function serverPersistMessage(req, fields) {
  const conversationId = (req.body && typeof req.body.conversationId === "string" && req.body.conversationId) || null;
  const messageId = (req.body && typeof req.body.messageId === "string" && req.body.messageId) || null;
  if (!conversationId || !messageId) return Promise.resolve();
  const db = getFirestore();
  if (!db) return Promise.resolve();

  const ref = db
    .collection("users").doc(req.uid)
    .collection("conversations").doc(conversationId)
    .collection("messages").doc(messageId);

  const patch = { userId: req.uid, ...fields };
  // This path always persists the AGENT reply.
  patch.role = "agent";

  const terminal =
    fields.pipelineStatus === "done" ||
    fields.pipelineStatus === "failed" ||
    fields.pipelineStatus === "awaiting_input";

  // Read existing fields so we only fill missing identity/ordering data and
  // never clobber what the client already synced (set+merge overwrites
  // provided fields). Defensive: older mocks may lack .get().
  let data = {};
  try {
    if (typeof ref.get === "function") {
      const existing = await ref.get();
      if (existing && existing.exists && existing.data) data = existing.data() || {};
    }
  } catch (e) {
    console.warn("[chat] serverPersistMessage read failed (best-effort):", e.message);
  }

  if (data.createdAt == null && patch.createdAt == null) {
    patch.createdAt = (req.pipelineStartedAt != null) ? req.pipelineStartedAt : Date.now();
  }
  if (data.startedAt == null && patch.startedAt == null && req.pipelineStartedAt != null) {
    patch.startedAt = req.pipelineStartedAt;
  }
  // thinkingElapsedMs: the client freezes it at "thinking complete" in the
  // LIVE path and syncs it; a background job has no client, so measure the
  // pipeline duration server-side. Base on the ORIGINAL start time
  // (client-synced) when available, so a resumed job reports its full
  // duration rather than just the resumed slice.
  if (terminal && patch.thinkingElapsedMs == null) {
    const base = data.startedAt || req.pipelineStartedAt || Date.now();
    patch.thinkingElapsedMs = Date.now() - base;
  }

  return ref.set(patch, { merge: true })
    .catch((err) => console.warn("[chat] serverPersistMessage failed:", err.message));
}

function validRetrievalCheckpoint(value) {
  if (!value || !Array.isArray(value.workingProvisions) || !value.evidence || typeof value.evidence !== "object") return false;
  if (typeof value.evidence.sufficient !== "boolean") return false;
  return value.workingProvisions.every((p) => p && (p.provisionId || p.id) && typeof p.text === "string");
}

function validDraftCheckpoint(value, provisions) {
  if (!(value && value.planResult && value.draftResult?.result && validateDraftResult(value.draftResult.result).valid)) return false;
  return verifyAndResolveCitations(value.draftResult.result, provisions || []).valid;
}

function makeInsufficientEvidenceResult(evidence, urgent) {
  return {
    lawMd: urgent
      ? "I cannot safely confirm the controlling provision from the available evidence right now. Your immediate safety matters more than forcing a weak citation, so take protective action first and get case-specific legal help as soon as possible."
      : "The available evidence does not clearly establish which provision controls these facts. I will not guess or present a weak citation as settled law; a qualified lawyer should review the exact circumstances.",
    actionsMd: urgent
      ? "- Step 1: If you or anyone with you is in immediate danger, move to a safe public place and call the police or local emergency service now.\n- Step 2: Contact a trusted person and preserve messages, photographs, medical records, names, dates, and other evidence.\n- Step 3: Do not confront the person alone or take an action that could put you at greater risk.\n- Step 4: Contact a qualified lawyer or legal-aid organisation urgently for advice based on your location and facts."
      : "- Step 1: Preserve contracts, receipts, messages, photographs, names, and dates.\n- Step 2: Write a clear timeline of what happened and what outcome you want.\n- Step 3: If the matter involves threats, violence, fraud, a child at risk, or another possible crime, move to safety where necessary and report it to the appropriate police or protection authority.\n- Step 4: Consult a qualified lawyer for advice tied to the applicable state and complete facts.",
    sources: [],
    provisionIds: [],
    claims: [],
    escalate: true,
    escalateReason: urgent
      ? "The situation may involve immediate harm and the controlling law could not be verified from the retrieved evidence."
      : "The controlling provision could not be verified from the retrieved evidence.",
    followUps: [],
    evidence,
  };
}

function applyDeterministicSafetyPolicy(result, classification, question, history) {
  if (!result) return;
  const area = String(classification?.practice_area || "").toLowerCase();
  const urgency = classification?.urgency;
  const highRisk = ["criminal_rights", "criminal_offences", "immigration_citizenship", "constitutional_rights", "family_law"].includes(area);
  const urgent = urgency === "High" || urgency === "Critical";
  const context = `${history?.map((m) => m.content).join(" ") || ""} ${question}`.toLowerCase();

  if (highRisk || urgent) {
    result.escalate = true;
    if (!result.escalateReason || /handle.*yourself|no lawyer/i.test(result.escalateReason)) {
      result.escalateReason = urgent
        ? "The situation is urgent or high-risk and should be reviewed by a qualified lawyer or appropriate emergency authority."
        : "This is a high-risk legal area and should be reviewed by a qualified lawyer.";
    }
  }

  if (urgent) {
    const actions = String(result.actionsMd || "");
    const hasImmediateStep = /(safe place|immediate danger|emergency|medical|hospital|call the police|report to the police|protect)/i.test(actions);
    if (!hasImmediateStep) {
      let first = "- Step 1: If there is immediate danger, move to a safe place and contact the police or local emergency service now.";
      if (/injur|hospital|treatment|accident|bleed|torture|beat/.test(context)) {
        first = "- Step 1: Get urgent medical help and preserve the medical report; if danger is continuing, move to a safe place and contact the police or emergency service.";
      }
      result.actionsMd = `${first}\n${actions}`.trim();
    }
  }
}

function isClearlyProceduralQuestion(question) {
  const q = String(question || "").toLowerCase();
  return (
    /\b(how (?:do|can|should) i (?:contact|find|write|note|record|prepare|organise|organize|report|reach|call|email|visit|go to)|what (?:documents?|papers?|evidence|things?|items?)\s+(?:else\s+)?should i bring|where (?:do|can|should) i (?:go|report|file)|which (?:police )?station|how do i find a lawyer)\b/.test(q) ||
    // "What should I bring to the station?" — the classifier prompt itself
    // gives this exact shape as a needs_sourcing:false example; the guard
    // used to miss it and forced the how-to question into the citation
    // pipeline. Require a legal destination so ordinary "what should I
    // bring" small talk never matches.
    /\bwhat should i bring (?:to|for)\b.{0,40}\b(police|station|court|lawyer|hearing|case|report|immigration|bail)\b/.test(q)
  );
}

async function runChatPipeline(req) {
  // Fake response object: every terminal `res.json(...)`/`res.status(...)`
  // in the original handler body now throws a sentinel we convert into a
  // plain { status, body } result below. This lets the SAME pipeline run
  // both inline (HTTP) and from the background worker, with zero duplicated
  // logic. Genuine errors still propagate to the caller.
  const res = {
    _code: 200,
    status(code) { this._code = code; return this; },
    json(body) {
      const e = new Error("chat-response");
      e.__chatResponse = { status: this._code, body };
      throw e;
    },
  };
  try {
  // ── Checkpoint resume (background-worker re-runs only) ───────────────────
  // A job re-run carries req.checkpoints (step outputs saved by a previous
  // attempt) and req.saveCheckpoint (persists new outputs). Each expensive or
  // external step is skipped when its checkpoint already exists, so a crashed
  // job RESUMES from the last completed step instead of restarting from
  // scratch. The live HTTP path passes neither, so it is unchanged.
  const cp = (req && req.checkpoints) || {};
  const saveCheckpoint = (typeof (req && req.saveCheckpoint) === "function")
    ? req.saveCheckpoint
    : async () => {};

  // Pipeline start time — used by serverPersistMessage to measure the actual
  // thinking duration for background-completed jobs (the client isn't around
  // to freeze it via collapseTrace).
  req.pipelineStartedAt = Date.now();
  const timings = {};
  const timed = async (name, fn) => {
    const started = Date.now();
    try { return await fn(); }
    finally { timings[name] = (timings[name] || 0) + (Date.now() - started); }
  };

  const rawQuestion = req.body?.question;
  if (typeof rawQuestion !== "string" || !rawQuestion.trim() || rawQuestion.length > 10000) {
    return res.status(400).json({ error: "bad_request", message: '"question" must be a non-empty string of at most 10,000 characters.' });
  }
  const question = rawQuestion.trim();

  const rawHistory = req.body?.history;
  if (rawHistory != null && !Array.isArray(rawHistory)) {
    return res.status(400).json({ error: "bad_request", message: '"history" must be an array.' });
  }
  const history = (rawHistory || []).slice(-18);
  if (history.some((item) => !item || !["user", "agent"].includes(item.role) || typeof item.content !== "string" || item.content.length > 10000 || (item.classification != null && (typeof item.classification !== "object" || Array.isArray(item.classification))) || (item.evidence != null && (typeof item.evidence !== "object" || Array.isArray(item.evidence))))) {
    return res.status(400).json({ error: "bad_request", message: "Each history item must have role user|agent and string content up to 10,000 characters." });
  }

  // Mark the message as running server-side (fire-and-forget) so a reopen
  // during the pipeline shows "still working" instead of "incomplete".
  await serverPersistMessage(req, { pipelineStatus: "running" });

  // Check that at least one LLM provider is configured
  const groqClient = getGroqClient();
  const openRouterClient = getOpenRouterClient();
  const cerebrasClient = getCerebrasClient();
  const geminiClient = getGeminiClient();
  if (!groqClient && !openRouterClient && !cerebrasClient && !geminiClient) {
    return res.status(503).json({
      error: "not_configured",
      message: "No LLM provider configured. Set GROQ_API_KEY, OPENROUTER_API_KEY, CEREBRAS_API_KEY, or GEMINI_API_KEY.",
    });
  }

  // Build conversation context for classify and draft
  let conversationContext = "";
  if (history && history.length > 0) {
    // Safety cap mirrors the client's 18-message window (no extra trimming).
    const recent = history.slice(-18);
    conversationContext = recent.map(msg => {
      const role = msg.role === "user" ? "User" : "Agent";
      const c = msg.classification && typeof msg.classification === "object" ? msg.classification : null;
      const caseLine = c ? ` [case: area=${c.practice_area || "unknown"}; jurisdiction=${c.jurisdiction || "unknown"}; jurisdiction_status=${c.jurisdiction_status || "unknown"}; urgency=${c.urgency || "unknown"}]` : "";
      return `${role}${caseLine}: ${msg.content}`;
    }).join("\n");
  }

  // Step 1: Classify (and detect casual chat)
  // Deterministic legal-intent gate: if the raw message describes an incident
  // or legal matter, steer the classifier toward a legal classification and
  // enforce it as a backstop below.
  const forcedLegal = detectLegalIntent(question).legal;
  let classification;
  let classifyProvider = null;

  const savedClassification = cp.classification ? checkpointClassification(cp.classification) : null;
  if (savedClassification) {
    classification = savedClassification;
    classifyProvider = cp.classification.classifyProvider || null;
    console.log("[chat] Resuming from validated classification checkpoint");
  } else {
    if (cp.classification) console.warn("[chat] Discarding invalid classification checkpoint");
    let classifyResult;
    try {
      classifyResult = await timed("classificationMs", () => classifyWithFallback(question, conversationContext, {
        forceLegal: forcedLegal || (history.length > 0 && detectLegalIntent(conversationContext).legal),
      }));
    } catch (err) {
      console.error("[/api/chat] classification failed:", err.status || "", err.message);
      await serverPersistMessage(req, { status: "error", errorMessage: "The classification model failed to respond. " + (err.message || ""), pipelineStatus: "failed", unread: true });
      return res.status(502).json({
        error: "classification_failed",
        message: "The classification model failed to respond. " + (err.message || ""),
      });
    }

    classification = classifyResult.classification;
    classifyProvider = classifyResult.provider;

    // Backstop: if the deterministic gate fired but the classifier still said
    // "casual", override with a valid legal classification. A described assault
    // must never fall through to a casual/empathy-only reply.
    if (forcedLegal && classification.is_legal_question === false) {
      console.warn("[/api/chat] Classifier said casual but deterministic gate detected a legal incident — forcing legal path");
      classification = buildFallbackClassification(question);
    }

    const priorClassification = [...history].reverse().map((item) => item.classification).find((item) => item && item.is_legal_question !== false);
    const currentDetection = detectLegalIntent(question);
    if (priorClassification) {
      if (classification.practice_area === "general" && !currentDetection.legal && priorClassification.practice_area) {
        classification.practice_area = priorClassification.practice_area;
        classification.context_inherited_area = true;
      }
      if (priorClassification.jurisdiction_status === "clear" && priorClassification.jurisdiction && classification.jurisdiction_status === "unclear") {
        classification.jurisdiction = priorClassification.jurisdiction;
        classification.jurisdiction_status = "clear";
        classification.context_inherited_jurisdiction = true;
      }
    }

    await saveCheckpoint("classification", { classification, classifyProvider });
  }

  // `needs_sourcing:false` is accepted only for an explicitly procedural
  // request. A described arrest, assault, eviction, dismissal, etc. still
  // needs legal evidence even when the user asks "what can we do?".
  if (classification.is_legal_question !== false && classification.needs_sourcing === false && !isClearlyProceduralQuestion(question)) {
    classification.needs_sourcing = true;
    classification.sourcing_override = "deterministic_legal_incident_guard";
  }

  // Step 2: If casual chat, return early with a friendly response
  if (classification.is_legal_question === false) {
    const casualReply = classification.casual_reply || "Hello! I'm here to help with Nigerian legal questions. Feel free to ask me anything about your rights, laws, or legal situations.";
    await serverPersistMessage(req, { status: "casual", casualReply, pipelineStatus: "done", unread: true });
    return res.json({
      isCasual: true,
      casualReply,
      provider: classifyProvider,
    });
  }

  // Step 2a: Practical/procedural follow-up — answer directly, no citations.
  // "How do I note down key facts" is correct without any statute, so skip the
  // search/relevance/draft-with-excerpts pipeline entirely and give direct
  // guidance. Never force-fit citations into a how-to answer.
  if (classification.needs_sourcing === false) {
    try {
      const proc = await answerProceduralWithFallback(question, classification, history);
      const procEvidence = {
        sufficient: true,
        relevanceScore: null,
        sourceCount: 0,
        retrievedFrom: [],
        reason: "Practical/procedural question — no statute required.",
        minSources: 0,
        noSourcing: true,
      };
      await serverPersistMessage(req, { status: "done", result: { ...proc.result, evidence: procEvidence }, pipelineStatus: "done", unread: true });
      return res.json({
        classification,
        route: "simple",
        plan: null,
        result: proc.result,
        draftModel: proc.model,
        draftProvider: proc.provider,
        critique: null,
        evidence: procEvidence,
        providersBusy: false,
        retryAfter: null,
      });
    } catch (err) {
      if (err && err.__chatResponse) throw err; // terminal response, not an error
      console.warn("[/api/chat] Procedural answer failed, using static guidance:", err.message);
      // Honest fallback: direct practical guidance with NO citations, never
      // routed back into the citation pipeline.
      const fallbackResult = {
        lawMd: "Here's straightforward guidance: write things down while they're fresh, keep it factual and specific, and keep a copy for yourself. If this relates to a legal or police matter, also note dates, names, and any documents.",
        actionsMd:
          "- Step 1: Write down the key facts (who, what, when, where) as soon as possible.\n" +
          "- Step 2: Keep it factual — what you saw or heard, not your opinion.\n" +
          "- Step 3: Save a dated copy (photo or written) for yourself.\n" +
          "- Step 4: If it's for a legal or police matter, bring this record when you report or meet a lawyer.",
        sources: [],
        escalate: false,
        escalateReason: "This is a practical task you can handle yourself.",
        followUps: [],
      };
      const procEvidence = {
        sufficient: true,
        relevanceScore: null,
        sourceCount: 0,
        retrievedFrom: [],
        reason: "Practical/procedural question — no statute required.",
        minSources: 0,
        noSourcing: true,
      };
      await serverPersistMessage(req, { status: "done", result: { ...fallbackResult, evidence: procEvidence }, pipelineStatus: "done", unread: true });
      return res.json({
        classification,
        route: "simple",
        plan: null,
        result: fallbackResult,
        draftModel: "fallback",
        draftProvider: "procedural-fallback",
        critique: null,
        evidence: procEvidence,
        providersBusy: false,
        retryAfter: null,
      });
    }
  }

  // Step 2b: HITL — if jurisdiction is unclear and the answer depends on state,
  // ask the user before proceeding. Don't guess and risk wrong law.
  const urgentWithoutJurisdiction = classification.urgency === "High" || classification.urgency === "Critical";
  if (classification.jurisdiction_status === "unclear" && STATE_VARYING_AREAS.has(classification.practice_area) && !urgentWithoutJurisdiction) {
    await serverPersistMessage(req, { status: "needsInput", needsInputQuestion: "Which state did this happen in? The laws can differ by state.", needsInputField: "jurisdiction", pipelineStatus: "awaiting_input", unread: true });
    return res.json({
      needsInput: true,
      question: "Which state did this happen in? The laws can differ by state.",
      field: "jurisdiction",
      context: {
        practice_area: classification.practice_area,
        urgency: classification.urgency,
      },
      provider: classifyProvider,
    });
  }

  // Step 3: Legal question — proceed with full pipeline
  const route = classification.route || (classification.complexity === "Low" ? "simple" : "complex");
  const isSimple = route === "simple";

  // Global answer caching is safe only for standalone first-turn questions.
  // History-dependent answers may contain case facts and must never cross
  // conversation or user boundaries.
  const cacheAllowed = history.length === 0;
  const cacheKey = getCacheKey(req.uid, question, classification.jurisdiction, classification.practice_area);
  const urgentSafety = classification.urgency === "High" || classification.urgency === "Critical";

  // ── Relevance/sufficiency gate (between search and draft) ──────────────
  // Rank the retrieved provisions by whether they actually govern the
  // situation, not just overlap keywords. Insufficient evidence triggers a
  // broaden-and-re-search; if it is still insufficient, return an honest
  // low-confidence "insufficient evidence" response instead of dressing up a
  // mismatched citation as a confident answer.
  // One controlling provision can fully answer a simple factual question.
  // Applied or high-risk scenarios retain the stronger two-source floor.
  const MIN_SOURCES = requiredSourceCount(classification);

  let workingProvisions;
  let evidence;

  if (validRetrievalCheckpoint(cp.retrieval)) {
    workingProvisions = cp.retrieval.workingProvisions;
    evidence = cp.retrieval.evidence;
    evidence.mode = evidence.mode || (workingProvisions.some((p) => p.local_eval) ? "local_fallback" : "firestore");
    console.log("[chat] Resuming from validated retrieval checkpoint");
  } else {
    if (cp.retrieval) console.warn("[chat] Discarding invalid retrieval checkpoint");
    evidence = {
      sufficient: false,
      mode: "unknown",
      relevanceScore: null,
      sourceCount: 0,
      retrievedFrom: [classification.practice_area],
      reason: "",
      conflicts: [],
      minSources: MIN_SOURCES,
    };

    let provisions;
    try {
      provisions = await timed("retrievalMs", () => findProvisions({
        practiceArea: classification.practice_area,
        jurisdiction: classification.jurisdiction,
        keywords: classification.keywords,
      }));
    } catch (err) {
      console.error("[/api/chat] Firestore lookup failed:", err.message);
      
      // Provide user-friendly error messages
      let userMessage = err.message;
      if (err.message.includes("Quota exceeded")) {
        userMessage = "Our legal database is temporarily unavailable due to high demand. Please try again in a few minutes, or ask a different question.";
      } else if (err.message.includes("timed out")) {
        userMessage = "The request took too long to process. Please try again with a simpler question.";
      }
      
      await serverPersistMessage(req, { status: "error", errorMessage: userMessage, pipelineStatus: "failed", unread: true });
      return res.status(502).json({ 
        error: "corpus_lookup_failed", 
        message: userMessage,
        technicalDetails: err.message 
      });
    }

    evidence.mode = provisions.some((p) => p.local_eval === true) ? "local_fallback" : "firestore";

    if (!provisions.length) {
      const corpusEmptyMessage =
        `No ingested legal sources match "${classification.practice_area}" yet. ` +
        "Run the ingestion script for this practice area before this endpoint can answer it.";
      await serverPersistMessage(req, { status: "corpusEmpty", corpusEmptyMessage, pipelineStatus: "done", unread: true });
      return res.json({
        classification,
        result: null,
        corpusEmpty: true,
        message: corpusEmptyMessage,
      });
    }

    workingProvisions = provisions;

  try {
    const gate = await timed("relevanceMs", () => assessRelevanceWithFallback(question, classification, provisions));
    const relevantIdx = new Set(
      Array.isArray(gate.relevant) ? gate.relevant.map((n) => Number(n) - 1).filter((i) => i >= 0 && i < provisions.length) : []
    );
    const relevantProvisions = provisions.filter((_, i) => relevantIdx.has(i));

    evidence.relevanceScore = typeof gate.relevance_score === "number" ? gate.relevance_score : null;
    evidence.reason = gate.reason || "";
    evidence.conflicts = Array.isArray(gate.conflicts) ? gate.conflicts.filter(Boolean) : [];
    evidence.sourceCount = relevantProvisions.length;

    const sufficient = gate.sufficient === true && relevantProvisions.length >= MIN_SOURCES && evidence.conflicts.length === 0;
    if (sufficient) {
      workingProvisions = relevantProvisions;
      evidence.sufficient = true;
      console.log(`[/api/chat] Relevance gate: ${relevantProvisions.length}/${provisions.length} provisions relevant — sufficient`);
    } else {
      console.log(`[/api/chat] Relevance gate: insufficient (${relevantProvisions.length} relevant of ${provisions.length}). Broadening search...`);
      // Broaden into adjacent categories (e.g. the "general" bucket for the
      // Criminal Code) and re-run the gate.
      const broad = await findProvisionsBroad({
        practiceArea: classification.practice_area,
        jurisdiction: classification.jurisdiction,
        keywords: classification.keywords || [],
        minSources: MIN_SOURCES,
        force: true,
      });
      evidence.retrievedFrom = broad.categories || [classification.practice_area];
      if (broad.provisions.some((p) => p.local_eval === true)) evidence.mode = "local_fallback";

      if (broad.provisions.length) {
        const gate2 = await timed("relevanceMs", () => assessRelevanceWithFallback(question, classification, broad.provisions));
        const relevantIdx2 = new Set(
          Array.isArray(gate2.relevant) ? gate2.relevant.map((n) => Number(n) - 1).filter((i) => i >= 0 && i < broad.provisions.length) : []
        );
        const relevantProvisions2 = broad.provisions.filter((_, i) => relevantIdx2.has(i));

        evidence.relevanceScore = typeof gate2.relevance_score === "number" ? gate2.relevance_score : evidence.relevanceScore;
        evidence.reason = gate2.reason || evidence.reason;
        evidence.conflicts = Array.isArray(gate2.conflicts) ? gate2.conflicts.filter(Boolean) : [];
        evidence.sourceCount = relevantProvisions2.length;

        if (gate2.sufficient === true && relevantProvisions2.length >= MIN_SOURCES && evidence.conflicts.length === 0) {
          workingProvisions = relevantProvisions2;
          evidence.sufficient = true;
          console.log(`[/api/chat] Broadened search: ${relevantProvisions2.length} relevant provisions — sufficient`);
        } else {
          console.log(`[/api/chat] Broadened search still insufficient (${relevantProvisions2.length} relevant). Returning insufficient-evidence response.`);
          const insuffResult = makeInsufficientEvidenceResult(evidence, urgentSafety);
          await serverPersistMessage(req, { status: "done", result: insuffResult, pipelineStatus: "done", unread: true });
          return res.json({
            classification,
            route,
            plan: null,
            result: insuffResult,
            critique: null,
            evidence,
            providersBusy: false,
            retryAfter: null,
          });
        }
      } else {
        // Broadened search found nothing either — same honest outcome.
        const insuffResult = makeInsufficientEvidenceResult(evidence, urgentSafety);
        await serverPersistMessage(req, { status: "done", result: insuffResult, pipelineStatus: "done", unread: true });
        return res.json({
          classification,
          route,
          plan: null,
          result: insuffResult,
          critique: null,
          evidence,
          providersBusy: false,
          retryAfter: null,
        });
      }
    }
  } catch (err) {
    if (err && err.__chatResponse) throw err;
    // Legal evidence verification fails closed. Candidate quantity is not proof
    // of relevance, so an unavailable judge must never become "sufficient".
    console.warn("[/api/chat] Relevance gate unavailable — withholding sourced answer:", err.message);
    evidence.sourceCount = 0;
    evidence.sufficient = false;
    evidence.validationUnavailable = true;
    evidence.reason = "Evidence relevance could not be verified at this time.";
    evidence.relevanceScore = null;
    const unavailableResult = {
      lawMd: "I found possible legal material, but I could not verify that it directly applies to your situation. Rather than give you a potentially mismatched legal answer, I am marking this as unverified.",
      actionsMd: "- Step 1: Keep a written record of the important facts and dates.\n- Step 2: If there is immediate danger or a crime, contact the appropriate emergency or police service.\n- Step 3: Consult a qualified lawyer for advice based on your exact circumstances.",
      sources: [],
      provisionIds: [],
      claims: [],
      escalate: true,
      escalateReason: "The system could not verify that the retrieved provisions apply to this situation.",
      followUps: [],
      evidence,
    };
    await serverPersistMessage(req, { status: "done", result: unavailableResult, evidence, pipelineStatus: "done", unread: true });
    return res.json({ classification, route, plan: null, result: unavailableResult, critique: null, evidence, providersBusy: false, retryAfter: null });
  }

    await saveCheckpoint("retrieval", { workingProvisions, evidence });
  }

  const EXCERPT_CHAR_CAP = 700; // keep total context small enough to fit even the tighter fallback model's per-minute limit
  const contextBlock = workingProvisions
    .map((p) => {
      const text = p.text.length > EXCERPT_CHAR_CAP ? p.text.slice(0, EXCERPT_CHAR_CAP) + "\u2026" : p.text;
      const id = p.provisionId || p.id;
      return `[provisionId: ${id}] [${p.act}${p.section ? ", s." + p.section : ""}]\n${text}`;
    })
    .join("\n\n---\n\n");

  let planResult;
  let draftResult;
  let critiqueResult = null;

  if (validDraftCheckpoint(cp.draftAndCritique, workingProvisions)) {
    // Resume only from a schema-valid draft checkpoint.
    planResult = cp.draftAndCritique.planResult;
    draftResult = cp.draftAndCritique.draftResult;
    critiqueResult = cp.draftAndCritique.critiqueResult;
    console.log("[chat] Resuming from draft/critique checkpoint");
    // The previous attempt may have crashed before caching the result.
    if (cacheAllowed && !draftResult.providersBusy && draftResult.result && critiqueResult?.passed === true && evidence?.citationVerification?.valid === true) {
      setCachedResult(cacheKey, { draftResult, critiqueResult, citationVerification: evidence.citationVerification });
    }
  } else {
    if (cp.draftAndCritique) console.warn("[chat] Discarding invalid draft checkpoint");
    planResult = { plan: null, provider: "skipped" };
    if (!isSimple) {
      // Classification already produced the legal issues, approach, remedies,
      // and stakeholders. Build the response plan deterministically instead of
      // spending another provider round-trip on duplicative JSON planning.
      planResult = {
        provider: "deterministic",
        plan: {
          analysis: classification.reasoning_approach || classification.summary || "Apply the retrieved provisions to the user's facts.",
          key_provisions: workingProvisions.slice(0, 5).map((p) => `${p.act}${p.section ? `, s.${p.section}` : ""}`),
          sub_questions: classification.key_issues || [],
          response_structure: "Explain the controlling law, apply it to the facts, then give practical next steps and escalation guidance.",
          practical_steps: classification.potential_remedies || [],
          gaps: [],
        },
      };
      timings.planningMs = 0;
    } else {
      console.log(`[/api/chat] Simple route — skipping planning (route=${route})`);
    }

    // Cache only context-free first turns. A follow-up answer is a case artifact,
    // never a globally reusable question artifact.
    const cached = cacheAllowed ? getCachedResult(cacheKey) : null;

    if (cached && cached.draftResult && !cached.draftResult.providersBusy) {
      console.log(`[/api/chat] Cache HIT for standalone question (key: ${cacheKey.slice(0, 50)})`);
      draftResult = cached.draftResult;
      critiqueResult = cached.critiqueResult || null;
      // The cached run verified citations before being stored; restore the
      // verification on this run's evidence so the response shape matches a
      // fresh pipeline run exactly.
      if (cached.citationVerification) evidence.citationVerification = cached.citationVerification;
    } else {
    // Step 5a: Draft with fallback chain (plan is null for simple route)
    try {
      draftResult = await timed("draftMs", () => draftWithFallback(question, contextBlock, planResult.plan, classification, history));
    } catch (err) {
      console.error("[/api/chat] drafting failed:", err.status || "", err.message);
      await serverPersistMessage(req, { status: "error", errorMessage: "The drafting model failed to respond. " + (err.message || ""), pipelineStatus: "failed", unread: true });
      return res.status(502).json({
        error: "drafting_failed",
        message: "The drafting model failed to respond. " + (err.message || ""),
      });
    }

    // The model selects evidence by ID; the server resolves all public labels
    // and excerpts from this run's retrieved records. Unknown IDs never reach
    // the user as citations.
    if (!draftResult.providersBusy && draftResult.result) {
      const citationVerification = verifyAndResolveCitations(draftResult.result, workingProvisions);
      evidence.citationVerification = citationVerification;
    }

    // Step 6: Critique + bounded correction
    // Skip critique for providersBusy responses (they're fallback errors, not real answers)
    if (!draftResult.providersBusy && draftResult.result) {
      const MAX_CRITIQUE_RETRIES = 1;

      // Category-specific thresholds — high-risk categories get a stricter bar.
      // Wrong advice in these areas could lead to arrest, deportation, loss of custody, etc.
      const practiceArea = (classification.practice_area || "").toLowerCase();
      const HIGH_RISK_AREAS = [
        "criminal_rights", "criminal_offences", "immigration_citizenship",
        "constitutional_rights", "family_law",
      ];
      const isHighRisk = HIGH_RISK_AREAS.includes(practiceArea);
      const QUALITY_THRESHOLD = 0.6;
      const SAFETY_THRESHOLD = isHighRisk ? 0.7 : 0.6;

      for (let attempt = 0; attempt <= MAX_CRITIQUE_RETRIES; attempt++) {
        try {
          critiqueResult = await timed("critiqueMs", () => critiqueWithFallback(
            question, workingProvisions, draftResult.result, classification
          ));

          // Override the critique's own "passed" with our category-specific thresholds
          const claimsSupported = critiqueResult.claimSupport.every((item) => item.status === "supported");
          critiqueResult.passed = critiqueResult.quality >= QUALITY_THRESHOLD
                               && critiqueResult.legal_safety >= SAFETY_THRESHOLD
                               && claimsSupported;
          if (!claimsSupported) {
            critiqueResult.issues = [...new Set([...(critiqueResult.issues || []), "claim_support_not_verified"])];
          }
          critiqueResult.thresholds = { quality: QUALITY_THRESHOLD, safety: SAFETY_THRESHOLD };
          critiqueResult.isHighRisk = isHighRisk;

          console.log(`[/api/chat] Critique ${attempt + 1}/${MAX_CRITIQUE_RETRIES + 1} [${isHighRisk ? "HIGH-RISK" : "standard"}]: quality=${critiqueResult.quality.toFixed(2)}>=${QUALITY_THRESHOLD}, safety=${critiqueResult.legal_safety.toFixed(2)}>=${SAFETY_THRESHOLD} → ${critiqueResult.passed ? "PASS" : "FAIL"}`);

          if (critiqueResult.passed || attempt === MAX_CRITIQUE_RETRIES || !isHighRisk) {
            break;
          }

          // Critique failed — retry draft with feedback
          console.log(`[/api/chat] Re-drafting with feedback: ${critiqueResult.issues.join("; ").slice(0, 100)}`);
          const feedbackContext = `\n\nIMPORTANT FEEDBACK FROM PREVIOUS DRAFT REVIEW (attempt ${attempt + 1} failed):\n${critiqueResult.issues.map(i => "- " + i).join("\n")}\n\nFix ALL of these issues. ${isHighRisk ? "This is a HIGH-RISK legal area — accuracy and safety are critical." : ""}`;

          draftResult = await timed("draftMs", () => draftWithFallback(
            question, contextBlock + feedbackContext, planResult.plan, classification, history
          ));
          if (!draftResult.providersBusy && draftResult.result) {
            evidence.citationVerification = verifyAndResolveCitations(draftResult.result, workingProvisions);
          }
        } catch (err) {
          // Verification failure is not a pass. High-risk answers flow into the
          // acknowledgment gate; standard answers are visibly downgraded.
          console.warn(`[/api/chat] Critique ${attempt + 1} unavailable: ${err.message}`);
          critiqueResult = { quality: 0.5, legal_safety: 0.5, issues: ["critique_unavailable"], passed: false, unavailable: true, thresholds: { quality: QUALITY_THRESHOLD, safety: SAFETY_THRESHOLD }, isHighRisk };
          evidence.sufficient = false;
          evidence.safetyValidationUnavailable = true;
          evidence.reason = "Response safety review could not be completed.";
          if (!isHighRisk && draftResult.result) {
            draftResult.result.escalate = true;
            draftResult.result.escalateReason = "This response could not complete safety review; consult a qualified lawyer before relying on it.";
          }
          break;
        }
      }

      // Citation integrity is deterministic and overrides model self-review.
      const citationOk = evidence.citationVerification?.valid === true;
      if (!citationOk) {
        evidence.sufficient = false;
        evidence.reason = evidence.citationVerification?.reason || "Citations could not be verified.";
        critiqueResult = critiqueResult || { quality: 0.5, legal_safety: 0.5, issues: [], passed: false, thresholds: { quality: QUALITY_THRESHOLD, safety: SAFETY_THRESHOLD }, isHighRisk };
        critiqueResult.passed = false;
        critiqueResult.issues = Array.from(new Set([...(critiqueResult.issues || []), "citation_integrity_failed"]));
        if (draftResult.result) {
          draftResult.result.escalate = true;
          draftResult.result.escalateReason = "The response's citations could not all be verified against retrieved legal text.";
        }
      }

      if (!isHighRisk && critiqueResult && !critiqueResult.passed) {
        evidence.sufficient = false;
        evidence.reason = `Response review did not pass: ${(critiqueResult.issues || []).join("; ") || "quality or safety threshold not met"}`;
        if (draftResult.result) {
          draftResult.result.escalate = true;
          draftResult.result.escalateReason = "This draft did not pass the response review threshold; consult a qualified lawyer before relying on it.";
        }
      }

      // If a high-risk category still fails after the bounded correction,
      // cache the response and require explicit user acknowledgment before delivering.
      if (isHighRisk && critiqueResult && !critiqueResult.passed) {
        console.warn(`[/api/chat] HIGH-RISK category "${practiceArea}" failed critique after ${MAX_CRITIQUE_RETRIES + 1} attempts — requiring user safety acknowledgment`);

        const ackToken = generateAckToken();
        await setPendingAck(ackToken, {
          uid: req.uid,
          conversationId: req.body?.conversationId || null,
          messageId: req.body?.messageId || null,
          question,
          classification,
          draftResult,
          critiqueResult,
          evidence,
          route,
          planResult,
          cacheKey,
          cacheAllowed,
        });

        // Return HITL response — client shows ApprovalCard for safety acknowledgment
        const ackQuestion = `This question involves ${practiceArea.replace(/_/g, " ")} — a high-risk legal area. Our quality review could not fully verify the response accuracy.`;
        const ackContext = {
          practiceArea,
          quality: critiqueResult.quality,
          legal_safety: critiqueResult.legal_safety,
          issues: critiqueResult.issues,
          message: "This response covers a high-risk legal area and could not be verified to our standard. Do you still want to see the response? We strongly recommend consulting a qualified lawyer.",
        };
        // Persist the card state AND the token (now Firestore-durable) so a
        // reopened chat re-renders a WORKING "I understand, show me" button —
        // even across a server restart.
        await serverPersistMessage(req, { status: "safetyAck", safetyAckQuestion: ackQuestion, safetyAckContext: ackContext, safetyAckToken: ackToken, pipelineStatus: "awaiting_input", unread: true });
        res.json({
          needsInput: true,
          safetyAck: true,
          ackToken,
          question: ackQuestion,
          field: "safety_acknowledgment",
          context: ackContext,
          provider: draftResult.provider,
        });
        return;
      }
    }

      // Cache the result (only successful, non-busy responses)
      if (cacheAllowed && !draftResult.providersBusy && draftResult.result && critiqueResult?.passed === true && evidence.citationVerification?.valid === true) {
        setCachedResult(cacheKey, { draftResult, critiqueResult, citationVerification: evidence.citationVerification });
      }
    }

    await saveCheckpoint("draftAndCritique", { planResult, draftResult, critiqueResult });
  }

  if (!draftResult.providersBusy && draftResult.result) {
    applyDeterministicSafetyPolicy(draftResult.result, classification, question, history);
  }

  // ── Hedge downgrade: if the draft's OWN text doubts whether its citations
  // apply ("might be relevant", "does not directly address", ...), that is
  // itself proof the citations are weak — confidence must NOT be High, even
  // if the relevance gate (or its catch branch) said "sufficient".
  if (evidence.sufficient && draftResult.result) {
    const hedges = detectHedging(draftResult.result);
    if (hedges.length > 0) {
      evidence.sufficient = false;
      evidence.hedged = true;
      evidence.hedgeMatches = hedges;
      evidence.reason = `Response hedges about citation fit: ${hedges.join("; ")}`;
      console.warn(`[/api/chat] Hedging downgrade: ${hedges.join("; ")}`);
    }
  }

  // Attach evidence inside result too so it persists with the message and the
  // client's confidence label can read it directly from agentMsg.result.
  if (draftResult.result) draftResult.result.evidence = evidence;

  // Persist the terminal state server-side (recoverable requests).
  if (draftResult.providersBusy) {
    await serverPersistMessage(req, {
      status: "providersBusy",
      providersBusyRetryAfter: draftResult.retryAfter || 30,
      providersBusyLawMd: draftResult.result?.lawMd || "All legal reasoning providers are currently busy.",
      providersBusyActionsMd: draftResult.result?.actionsMd || "",
      pipelineStatus: "failed",
      unread: true,
    });
  } else {
    await serverPersistMessage(req, {
      status: "done",
      result: draftResult.result,
      classification,
      critique: critiqueResult ? {
        quality: critiqueResult.quality,
        legal_safety: critiqueResult.legal_safety,
        passed: critiqueResult.passed,
        issues: critiqueResult.issues,
        claimSupport: critiqueResult.claimSupport || [],
        thresholds: critiqueResult.thresholds || null,
        isHighRisk: critiqueResult.isHighRisk || false,
      } : null,
      evidence,
      pipelineStatus: "done",
      unread: true,
    });
  }

  timings.totalMs = Date.now() - req.pipelineStartedAt;
  console.log(`[pipeline] totalMs=${timings.totalMs} stages=${JSON.stringify(timings)}`);
  res.json({
    classification,
    route,
    timings,
    plan: planResult.plan,
    result: draftResult.result,
    draftModel: draftResult.model,
    draftProvider: draftResult.provider,
    // Evidence quality from the relevance/sufficiency gate:
    // the client uses this to label confidence instead of hardcoding it.
    evidence,
    // Critique scores with category-specific thresholds
    critique: critiqueResult ? {
      quality: critiqueResult.quality,
      legal_safety: critiqueResult.legal_safety,
      passed: critiqueResult.passed,
      issues: critiqueResult.issues,
      claimSupport: critiqueResult.claimSupport || [],
      thresholds: critiqueResult.thresholds || null,
      isHighRisk: critiqueResult.isHighRisk || false,
    } : null,
    // Safety flag for high-risk categories that failed critique
    safetyFlag: draftResult.result?._safetyFlag || null,
    // Bug fix: forward providersBusy flag so client can render error state
    // instead of styling a fallback message as a confident legal answer
    providersBusy: draftResult.providersBusy || false,
    retryAfter: draftResult.retryAfter || null,
  });

  // Defensive fallback — every terminal path throws via res.json().
  return { status: 200, body: {} };
  } catch (err) {
    if (err && err.__chatResponse) return err.__chatResponse;
    throw err;
  }
}

const inFlightRuns = new Map();

function validRunId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9._~-]+$/.test(value);
}

function runKey(req) {
  const body = req.body || {};
  return req.uid && validRunId(body.conversationId) && validRunId(body.messageId)
    ? `${req.uid}:${body.conversationId}:${body.messageId}`
    : null;
}

async function loadPersistedTerminal(req) {
  const body = req.body || {};
  if (!req.uid || !body.conversationId || !body.messageId) return null;
  const d = getFirestore();
  if (!d) return null;
  try {
    const snap = await d.collection("users").doc(req.uid)
      .collection("conversations").doc(body.conversationId)
      .collection("messages").doc(body.messageId).get();
    if (!snap.exists) return null;
    const msg = snap.data() || {};
    if (msg.pipelineStatus !== "done" || msg.status !== "done" || !msg.result) return null;
    return {
      status: 200,
      body: {
        classification: msg.classification || null,
        route: msg.classification?.route || null,
        plan: msg.plan || null,
        result: msg.result,
        evidence: msg.evidence || msg.result?.evidence || null,
        critique: msg.critique || null,
        providersBusy: false,
        retryAfter: null,
        idempotentReplay: true,
      },
    };
  } catch (err) {
    console.warn("[chat] idempotency lookup failed:", err.message);
    return null;
  }
}

async function executeChatRequest(req) {
  await recordJobStart(req);
  let result;
  try {
    result = await runChatPipeline(req);
  } catch (err) {
    console.error("[/api/chat] unhandled pipeline error:", err && err.stack ? err.stack : err);
    result = { status: 500, body: { error: "internal_error", message: "Something went wrong while processing your question." } };
  }
  await recordJobEnd(req, result);
  return result;
}

router.post("/api/chat", async (req, res) => {
  const body = req.body || {};
  const hasRunIdentity = body.conversationId != null || body.messageId != null;
  if (hasRunIdentity && (!validRunId(body.conversationId) || !validRunId(body.messageId))) {
    return res.status(400).json({ error: "invalid_run_identity", message: "conversationId and messageId must both be URL-safe IDs up to 128 characters." });
  }
  const key = runKey(req);
  let result;

  if (key) {
    result = await loadPersistedTerminal(req);
    if (!result) {
      let promise = inFlightRuns.get(key);
      if (!promise) {
        promise = executeChatRequest(req).finally(() => inFlightRuns.delete(key));
        inFlightRuns.set(key, promise);
      }
      result = await promise;
    }
  } else {
    result = await executeChatRequest(req);
  }

  try {
    res.status(result.status).json(result.body);
  } catch (e) {
    // Client disconnected; terminal state is persisted server-side.
  }
});


/**
 * POST /api/chat/acknowledge — User acknowledges a safety-flagged response.
 *
 * When a high-risk answer fails critique, the server caches it and returns
 * a needsInput with an ackToken. The client shows an ApprovalCard; when the
 * user clicks "I understand, show me the response", this endpoint is called
 * with the token, and the cached response is returned.
 */
router.post("/api/chat/acknowledge", async (req, res) => {
  const { ackToken, acknowledged } = req.body || {};

  if (!ackToken) {
    return res.status(400).json({ error: "bad_request", message: "ackToken is required" });
  }

  const pending = await getPendingAck(ackToken);
  if (!pending || !pending.uid || pending.uid !== req.uid) {
    // Ownership mismatches deliberately look identical to missing tokens.
    return res.status(404).json({ error: "not_found", message: "Acknowledgment token expired or not found. Please re-ask your question." });
  }

  // User rejected — don't return the response
  if (acknowledged === false) {
    await deletePendingAck(ackToken);
    return res.json({
      acknowledged: false,
      message: "Response withheld. Please consult a qualified lawyer for this matter.",
    });
  }

  // User acknowledged — return the cached response with safety flag attached
  await deletePendingAck(ackToken);
  const { classification, draftResult, critiqueResult, evidence, route, planResult } = pending;

  // Attach safety flag so the client can render the warning banner
  if (draftResult.result) {
    draftResult.result._safetyFlag = {
      practiceArea: critiqueResult.isHighRisk ? (classification.practice_area || "unknown") : "unknown",
      quality: critiqueResult.quality,
      legal_safety: critiqueResult.legal_safety,
      issues: critiqueResult.issues,
      message: "This response covers a high-risk legal area and could not be verified to our standard. Please consult a qualified lawyer for this matter.",
      acknowledged: true,
    };
  }

  // Persist the acknowledged terminal result server-side. The client is not
  // the authority for this transition and may disconnect immediately after
  // clicking the button.
  if (pending.conversationId && pending.messageId) {
    const d = getFirestore();
    if (d) {
      await d.collection("users").doc(req.uid)
        .collection("conversations").doc(pending.conversationId)
        .collection("messages").doc(pending.messageId)
        .set({
          userId: req.uid,
          role: "agent",
          status: "done",
          result: draftResult.result,
          classification,
          critique: critiqueResult,
          evidence: evidence || null,
          pipelineStatus: "done",
          unread: false,
          safetyAcknowledgedAt: Date.now(),
        }, { merge: true })
        .catch((err) => console.warn("[ack] terminal persistence failed:", err.message));
    }
  }

  // Safety-flagged responses are never globally cached, even after one user
  // acknowledges the warning.

  res.json({
    acknowledged: true,
    classification,
    route,
    plan: planResult?.plan || null,
    result: draftResult.result,
    draftModel: draftResult.model,
    draftProvider: draftResult.provider,
    evidence: evidence || draftResult.result?.evidence || null,
    critique: {
      quality: critiqueResult.quality,
      legal_safety: critiqueResult.legal_safety,
      passed: critiqueResult.passed,
      issues: critiqueResult.issues,
      claimSupport: critiqueResult.claimSupport || [],
      thresholds: critiqueResult.thresholds || null,
      isHighRisk: critiqueResult.isHighRisk || false,
    },
    safetyFlag: draftResult.result?._safetyFlag || null,
    providersBusy: false,
    retryAfter: null,
  });
});


/**
 * POST /api/generate-title — Generate a short contextual title for a conversation
 * based on the user's first message. Returns { title: "Short Title" }
 * If the message is not a legal question, returns { title: null }.
 */
router.post("/api/generate-title", async (req, res) => {
  const question = (req.body && req.body.question || "").toString().trim();
  if (!question) {
    return res.status(400).json({ error: "bad_request" });
  }

  const groqClient = getGroqClient();
  const geminiClient = getGeminiClient();

  const TITLE_PROMPT = `Generate a very short title (3-6 words max) for a conversation about a Nigerian legal question. The title should capture the core topic in a natural, concise way.

IMPORTANT: If the message is NOT a legal question (e.g., greetings like "hi", "hello", casual chat, or non-legal topics), respond with exactly: NOT_LEGAL

Otherwise, return ONLY the title text, no quotes, no punctuation at the end.

Examples:
- "My landlord locked me out" → Landlord lockout dispute
- "Police arrested my brother" → Police detention rights
- "My employer hasn't paid me" → Unpaid salary claim
- "How do I register a company?" → Company registration process
- "hi there" → NOT_LEGAL
- "what's up" → NOT_LEGAL`;

  // Try Groq first, then Gemini
  const clients = [];
  if (groqClient) clients.push({ client: groqClient, model: CLASSIFY_MODEL });
  if (geminiClient) clients.push({ client: geminiClient, model: GEMINI_CLASSIFY_MODEL });

  for (const { client, model } of clients) {
    try {
      const completion = await callCompletion(
        client,
        model,
        [
          { role: "system", content: TITLE_PROMPT },
          { role: "user", content: question },
        ],
        { task: "title", timeoutMs: 8000, temperature: 0.3, max_tokens: 30, parseJson: false }
      );
      const raw = (completion.choices[0].message.content || "").trim().replace(/^["']|["']$/g, "");
      if (raw === "NOT_LEGAL" || raw.length === 0) return res.json({ title: null });
      const title = raw.slice(0, 50);
      if (title) return res.json({ title });
    } catch (err) {
      console.warn("[/api/generate-title] failed with", model, ":", err.message);
    }
  }

  res.json({ title: null });
});

router.runChatPipeline = runChatPipeline;

// Test hooks (simulate a server restart by dropping the in-memory caches).
router.__testing = {
  clearAckCache: () => pendingSafetyAck.clear(),
  clearQuestionCache: () => questionCache.clear(),
  clearProviderCooldowns: () => providerCooldowns.clear(),
};

module.exports = router;
