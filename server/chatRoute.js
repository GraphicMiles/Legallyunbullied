/**
 * POST /api/chat — the real Phase 1 pipeline.
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
const router = express.Router();
const { getClient: getGroqClient, CLASSIFY_MODEL, DRAFT_MODEL, DRAFT_MODEL_FALLBACK } = require("./groq");
const { getClient: getGeminiClient, GEMINI_CLASSIFY_MODEL, GEMINI_DRAFT_MODEL, GEMINI_CHAT_MODEL } = require("./gemini");
const { getClient: getOpenRouterClient, OPENROUTER_CLASSIFY_MODEL, OPENROUTER_DRAFT_MODEL, OPENROUTER_CHAT_MODEL } = require("./openrouter");
const { getClient: getCerebrasClient, CEREBRAS_CLASSIFY_MODEL, CEREBRAS_DRAFT_MODEL, CEREBRAS_CHAT_MODEL } = require("./cerebras");
const { findProvisions, findProvisionsBroad } = require("./legalCorpus");
const { detectLegalIntent, buildFallbackClassification } = require("./legalIntent");
const { PRACTICE_AREAS: PRACTICE_AREA_DEFS, PRACTICE_AREA_KEYS } = require("./practiceAreas");

const PRACTICE_AREAS = PRACTICE_AREA_KEYS;

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
- Cite the Act and section number for every legal claim (e.g., "Section 13 of the Lagos Tenancy Law 2011")
- Do NOT include URLs, links, or [text](url) markdown in your response — citations should be inline text only
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

**sources**: Array of 3-4 most important statutory provisions cited, with:
- "label": "Act Name, s.X"
- "excerpt": The key text from that section (max 400 chars)

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
  "lawMd": "Comprehensive explanation with citations...",
  "actionsMd": "- Step 1: ...\n- Step 2: ...\n- Step 3: ...",
  "sources": [{"label": "Act, s.X", "excerpt": "..."}],
  "escalate": true/false,
  "escalateReason": "...",
  "followUps": ["Question 1?", "Question 2?"]
}`;

const PLAN_SYSTEM_PROMPT = `You are a senior Nigerian legal analyst. Your task is to deeply analyze a legal question and the available statutory provisions to create a comprehensive response strategy.

Given:
- User's question and classification
- Available statute excerpts from Nigerian law

Perform the following analysis:

1. **Legal Framework Analysis**: Identify the primary legal framework(s) that govern this question. What Acts, sections, and legal principles are most relevant?

2. **Issue Decomposition**: Break down the user's question into specific legal sub-questions that need to be answered.

3. **Provision Mapping**: For each sub-question, identify which specific statutory provisions address it. Note any gaps where the available provisions don't fully answer the question.

4. **Application Strategy**: Determine how to apply the law to the user's specific facts. What elements need to be established? What tests or criteria must be met?

5. **Remedies & Guidance**: Based on the law, what are the user's rights, obligations, and available remedies? What practical steps should they take?

6. **Risk Assessment**: What are the potential risks, limitations, or complications? When should they seek professional legal help?

Respond with a structured JSON object:

{
  "analysis": "2-3 sentence analysis of the core legal question and what needs to be determined",
  "legal_framework": "Name the primary Act(s) and key sections that govern this issue",
  "key_provisions": [
    "Section X of [Act Name] - [brief description of what it establishes]",
    "Section Y of [Act Name] - [brief description]"
  ],
  "sub_questions": [
    "What are the statutory requirements for X?",
    "Did the party comply with Y?",
    "What remedies are available?"
  ],
  "application_to_facts": "1-2 sentences on how to apply the law to the user's specific situation",
  "response_structure": "Outline of how to structure the answer (e.g., '1. Explain legal requirements, 2. Analyze compliance, 3. Outline remedies, 4. Provide practical next steps')",
  "practical_steps": [
    "Step 1: Do X",
    "Step 2: File Y",
    "Step 3: Contact Z"
  ],
  "gaps": ["Any aspects the available provisions don't fully address"],
  "escalation_triggers": ["When should the user definitely consult a lawyer?"]
}

Be thorough but concise. This plan will guide the final response to ensure it's comprehensive, accurate, and actionable.`;

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
  "reason": "one sentence explaining the sufficiency decision"
}`;

async function assessRelevanceWithFallback(question, classification, provisions) {
  const providers = [];
  const groqClient = getGroqClient();
  const cerebrasClient = getCerebrasClient();
  const geminiClient = getGeminiClient();
  if (groqClient) providers.push(["groq", groqClient, CLASSIFY_MODEL]);
  if (cerebrasClient) providers.push(["cerebras", cerebrasClient, CEREBRAS_CLASSIFY_MODEL]);
  if (geminiClient) providers.push(["gemini", geminiClient, GEMINI_CLASSIFY_MODEL]);

  let lastErr = null;
  for (const [name, client, model] of providers) {
    try {
      const parsed = await assessRelevanceForClient(client, model, question, classification, provisions);
      return { ...parsed, provider: name };
    } catch (err) {
      lastErr = err;
      console.warn(`[/api/chat] Relevance gate via ${model} failed: ${err.message}`);
    }
  }
  throw new Error(`All relevance-gate providers failed: ${lastErr ? lastErr.message : "none configured"}`);
}

async function assessRelevanceForClient(client, model, question, classification, provisions) {
  const candidateBlock = provisions.map((p, i) =>
    `[${i + 1}] ${p.act}${p.section ? ", s." + p.section : ""}: ${(p.text || "").slice(0, 220)}`
  ).join("\n");
  const userMsg = `Practice area: ${classification.practice_area || "unknown"}\nQuestion: ${question}\n\nCandidate provisions:\n${candidateBlock}\n\nJudge relevance and sufficiency.`;

  const completion = await callCompletion(client, model, [
    { role: "system", content: RELEVANCE_SYSTEM_PROMPT },
    { role: "user", content: userMsg },
  ], { temperature: 0, max_tokens: 400, response_format: { type: "json_object" } });

  return completion.parsed;
}

// ── Hedge detection (citation-fit self-doubt) ─────────────────────────────
// The draft's own phrasing is a hard signal about citation quality. If it says
// a source "might be relevant", "does not directly address", etc., the answer
// must not be presented as high confidence. High-precision patterns only.
const HEDGE_PATTERNS = [
  "might be relevant", "may be relevant", "could be relevant", "potentially relevant",
  "does not directly address", "do not directly address", "doesn't directly address",
  "don't directly address", "not directly address", "does not specifically address",
  "not directly related", "not directly applicable", "does not directly apply",
  "primarily deals with", "for a more direct application",
  "interpreted within that context",
  "not quite the right provision", "isn't quite the right", "not the right provision",
  "only defines", "based on the provided excerpts", "based on the excerpts provided",
];

function detectHedging(result) {
  if (!result) return [];
  const text = ((result.lawMd || "") + " " + (result.actionsMd || "")).toLowerCase();
  return HEDGE_PATTERNS.filter((p) => text.includes(p));
}

// ── Critique system prompt (V1 Phase 1+2) ──────────────────────────────
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
  "passed": true/false
}

"passed" is true only if BOTH quality >= 0.6 AND legal_safety >= 0.6.`;

async function critiqueDraft(client, model, question, provisions, draft) {
  const provisionSummary = (provisions || []).slice(0, 8).map(p =>
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
Sources: ${JSON.stringify((draft.sources || []).slice(0, 4))}
---

Review this response.`;

  const completion = await callCompletion(client, model, [
    { role: "system", content: CRITIQUE_SYSTEM_PROMPT },
    { role: "user", content: userMsg },
  ], { response_format: { type: "json_object" }, max_tokens: 500, temperature: 0.1 });

  const parsed = completion.parsed;
  return {
    quality: typeof parsed.quality === "number" ? parsed.quality : 0.5,
    legal_safety: typeof parsed.legal_safety === "number" ? parsed.legal_safety : 0.5,
    issues: Array.isArray(parsed.issues) ? parsed.issues : [],
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
  if (groqClient) providers.push([groqClient, CLASSIFY_MODEL]);
  if (cerebrasClient) providers.push([cerebrasClient, CEREBRAS_CLASSIFY_MODEL]);
  if (geminiClient) providers.push([geminiClient, GEMINI_CLASSIFY_MODEL]);

  if (providers.length === 0) {
    throw new Error("No LLM provider available for critique");
  }

  for (const [client, model] of providers) {
    try {
      return await critiqueDraft(client, model, question, provisions, draft);
    } catch (err) {
      console.warn(`[/api/chat] Critique via ${model} failed: ${err.message}`);
      continue; // try next provider
    }
  }

  throw new Error("All critique providers failed");
}

// ── Question-level cache (V1 Phase 11) ──────────────────────────────────
// Caches full pipeline results for identical questions to avoid re-running
// the classify→search→draft→critique chain for repeated queries.
const questionCache = new Map();
const QUESTION_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const QUESTION_CACHE_MAX = 200;

// ── Pending safety acknowledgments (V1 Phase 3 — HITL on safety fail) ────
// When a high-risk answer fails critique after all retries, the response is
// held in this map until the user explicitly acknowledges the safety warning.
const pendingSafetyAck = new Map();  // token → { result, classification, ... }
const SAFETY_ACK_TTL = 10 * 60 * 1000; // 10 minutes

function generateAckToken() {
  return "safety_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function getPendingAck(token) {
  const entry = pendingSafetyAck.get(token);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > SAFETY_ACK_TTL) {
    pendingSafetyAck.delete(token);
    return null;
  }
  return entry.data;
}

function setPendingAck(token, data) {
  pendingSafetyAck.set(token, { data, timestamp: Date.now() });
  // Clean expired entries periodically
  if (pendingSafetyAck.size > 50) {
    const now = Date.now();
    for (const [k, v] of pendingSafetyAck) {
      if (now - v.timestamp > SAFETY_ACK_TTL) pendingSafetyAck.delete(k);
    }
  }
}

function getCacheKey(question, jurisdiction) {
  return `${(jurisdiction || "any").toLowerCase()}::${question.toLowerCase().trim().slice(0, 200)}`;
}

function getCachedResult(key) {
  const entry = questionCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > QUESTION_CACHE_TTL) {
    questionCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCachedResult(key, data) {
  if (questionCache.size >= QUESTION_CACHE_MAX) {
    // Evict oldest
    const oldest = questionCache.keys().next().value;
    questionCache.delete(oldest);
  }
  questionCache.set(key, { data, timestamp: Date.now() });
}

async function planResponse(question, classification, provisions) {
  const groqClient = getGroqClient();
  const geminiClient = getGeminiClient();

  const contextSummary = provisions.slice(0, 10).map(p => 
    `[${p.act}${p.section ? ", s." + p.section : ""}]: ${p.text.slice(0, 200)}...`
  ).join("\n\n");

  const planningPrompt = `
Question: ${question}

Classification:
- Practice Area: ${classification.practice_area}
- Key Issues: ${classification.key_issues.join(", ")}
- Complexity: ${classification.complexity}
- Approach: ${classification.reasoning_approach}

Available Legal Provisions:
${contextSummary}

Analyze this question and create a structured plan for answering it.`;

  // Try Groq first
  if (groqClient) {
    try {
      const completion = await callCompletion(
        groqClient,
        DRAFT_MODEL, // Use the more capable model for planning
        [
          { role: "system", content: PLAN_SYSTEM_PROMPT },
          { role: "user", content: planningPrompt }
        ],
        { temperature: 0.3, max_tokens: 800, response_format: { type: "json_object" } }
      );
      return { plan: completion.parsed, provider: "groq" };
    } catch (err) {
      console.warn(`[/api/chat] Groq planning failed: ${err.status || ""} ${err.message}`);
    }
  }

  // Try Gemini
  if (geminiClient) {
    try {
      const completion = await callCompletion(
        geminiClient,
        GEMINI_DRAFT_MODEL,
        [
          { role: "system", content: PLAN_SYSTEM_PROMPT },
          { role: "user", content: planningPrompt }
        ],
        { temperature: 0.3, max_tokens: 800, response_format: { type: "json_object" } }
      );
      return { plan: completion.parsed, provider: "gemini" };
    } catch (err) {
      console.warn(`[/api/chat] Gemini planning failed: ${err.status || ""} ${err.message}`);
    }
  }

  // If planning fails, return a minimal plan and continue
  return { 
    plan: { 
      analysis: "Analyzing the legal question and relevant provisions.",
      key_provisions: [],
      response_structure: "Review applicable law, apply to facts, provide guidance",
      gaps: []
    }, 
    provider: "fallback" 
  };
}

async function callCompletion(client, model, messages, options = {}) {
  const LLM_TIMEOUT_MS = 30000; // 30 second timeout for LLM calls
  
  const completionPromise = client.chat.completions.create({
    model,
    temperature: options.temperature ?? 0.2,
    max_tokens: options.max_tokens ?? 900,
    response_format: options.response_format || undefined,
    messages,
  });
  
  try {
    const result = await withTimeout(completionPromise, LLM_TIMEOUT_MS, `LLM call to ${model}`);
    const parsed = extractJsonFromResponse(result.choices[0].message.content);
    if (!parsed) {
      throw new Error(`Failed to parse JSON from ${model} response`);
    }
    return { ...result, parsed };
  } catch (err) {
    throw err;
  }
}

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

async function classifyWithFallback(question, conversationContext, options = {}) {
  const groqClient = getGroqClient();
  const openRouterClient = getOpenRouterClient();
  const cerebrasClient = getCerebrasClient();
  const geminiClient = getGeminiClient();

  // Deterministic legal-intent backstop: when the raw message describes an
  // incident/legal matter, the classifier is explicitly told it MUST produce
  // a legal classification — this prevents a short, emotional message from
  // being misfiled as casual chat across provider fallbacks.
  const forceLegalNote = options.forceLegal
    ? `\n\n[SYSTEM OVERRIDE — DO NOT IGNORE]: This message describes a real incident or legal matter. "is_legal_question" MUST be true. Do NOT classify it as casual chat. Provide the full legal classification (practice_area, jurisdiction, jurisdiction_status, urgency, summary, keywords, key_issues, complexity, route, reasoning_approach, stakeholders, potential_remedies).`
    : "";
  const userContent = (conversationContext ? `${conversationContext}\n\nUser: ${question}` : question) + forceLegalNote;

  // Try Groq first (fastest, already working for casual chat)
  if (groqClient) {
    try {
      const completion = await callCompletion(
        groqClient,
        CLASSIFY_MODEL,
        [
          { role: "system", content: CLASSIFY_SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        { temperature: 0, max_tokens: 2000, response_format: { type: "json_object" } }
      );
      return { classification: completion.parsed, provider: "groq" };
    } catch (err) {
      console.warn(`[/api/chat] Groq classification failed: ${err.status || ""} ${err.message}`);
    }
  }

  // Try OpenRouter (35+ free models, OpenAI-compatible)
  if (openRouterClient) {
    try {
      const completion = await callCompletion(
        openRouterClient,
        OPENROUTER_CLASSIFY_MODEL,
        [
          { role: "system", content: CLASSIFY_SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        { temperature: 0, max_tokens: 2000, response_format: { type: "json_object" } }
      );
      return { classification: completion.parsed, provider: "openrouter" };
    } catch (err) {
      console.warn(`[/api/chat] OpenRouter classification failed: ${err.status || ""} ${err.message}`);
    }
  }

  // Try Cerebras (ultra-fast, high rate limits)
  if (cerebrasClient) {
    try {
      const completion = await callCompletion(
        cerebrasClient,
        CEREBRAS_CLASSIFY_MODEL,
        [
          { role: "system", content: CLASSIFY_SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        { temperature: 0, max_tokens: 2000, response_format: { type: "json_object" } }
      );
      return { classification: completion.parsed, provider: "cerebras" };
    } catch (err) {
      console.warn(`[/api/chat] Cerebras classification failed: ${err.status || ""} ${err.message}`);
    }
  }

  // Try Gemini as last resort
  if (geminiClient) {
    try {
      const completion = await callCompletion(
        geminiClient,
        GEMINI_CLASSIFY_MODEL,
        [
          { role: "system", content: CLASSIFY_SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        { temperature: 0, max_tokens: 2000, response_format: { type: "json_object" } }
      );
      return { classification: completion.parsed, provider: "gemini" };
    } catch (err) {
      console.error(`[/api/chat] All LLM providers failed. Last error (Gemini): ${err.status || ""} ${err.message}`);
      throw err;
    }
  }

  throw new Error("No LLM provider configured for classification. Set GROQ_API_KEY, OPENROUTER_API_KEY, CEREBRAS_API_KEY, or GEMINI_API_KEY.");
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
    { response_format: { type: "json_object" }, max_tokens: 3000 }
  );
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

function markProviderRateLimited(key) {
  providerCooldowns.set(key, Date.now() + COOLDOWN_MS);
  console.log(`[/api/chat] Provider "${key}" on cooldown for ${COOLDOWN_MS / 1000}s`);
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

  // Sanitize text fields — remove URLs that match placeholder domains
  const stripPlaceholderUrls = (text) => {
    if (!text) return text;
    // Remove markdown links with placeholder domains: [text](https://example.com)
    let cleaned = text.replace(/\[([^\]]*)\]\([^)]*example\.(?:com|org|net)[^)]*\)/gi, '$1');
    // Remove bare URLs with placeholder domains
    cleaned = cleaned.replace(/https?:\/\/(?:www\.)?example\.(?:com|org|net)[^\s)>"']*/gi, '');
    // Remove any remaining "example.com" references
    cleaned = cleaned.replace(/\bexample\.(?:com|org|net)\b/gi, '');
    // Clean up double spaces and dangling punctuation
    cleaned = cleaned.replace(/  +/g, ' ').replace(/ ,/g, ',').replace(/\.\.+/g, '.');
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

  // Helper to delay before retry (rate limit recovery)
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

  let lastErr = null;
  let allSkipped = true;
  let allRateLimited = true;

  for (const [key, client, model] of providers) {
    // Skip providers on cooldown
    if (isProviderOnCooldown(key)) {
      console.log(`[/api/chat] Skipping "${key}" — on cooldown`);
      continue;
    }
    allSkipped = false; // at least one was attempted

    try {
      const result = await draftWithModel(client, model, question, contextBlock, plan, classification, conversationHistory);
      // Sanitize: strip placeholder URLs (e.g. example.com) that the LLM might hallucinate
      sanitizeDraftResult(result);
      return { result, model, provider: key };
    } catch (err) {
      lastErr = err;
      if (isRateLimitError(err)) {
        console.warn(`[/api/chat] ${key} rate-limited: ${err.message}`);
        markProviderRateLimited(key);
      } else if (isParseError(err)) {
        console.warn(`[/api/chat] ${key} JSON parse failed, trying next provider: ${err.message}`);
      } else if (err.status === 404 || (err.message && err.message.includes('404'))) {
        console.warn(`[/api/chat] ${key} model unavailable (404): ${err.message}`);
        allRateLimited = false;
      } else {
        console.warn(`[/api/chat] ${key} failed: ${err.status || ""} ${err.message}`);
        allRateLimited = false;
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
  "lawMd": "Direct, plain-language guidance for this practical task (2-4 sentences).",
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
    try {
      const completion = await callCompletion(client, model, [
        { role: "system", content: PROCEDURAL_SYSTEM_PROMPT },
        { role: "user", content: `${historyContext}\n\nUser: ${question}` },
      ], { temperature: 0.3, max_tokens: 900 });
      const parsed = completion.parsed;
      if (parsed && (parsed.lawMd || parsed.actionsMd)) {
        parsed.sources = [];
        return { result: parsed, model, provider: name };
      }
      throw new Error("Procedural answer missing required fields");
    } catch (err) {
      lastErr = err;
      console.warn(`[/api/chat] Procedural answer via ${model} failed: ${err.message}`);
    }
  }
  throw new Error(`All procedural-answer providers failed: ${lastErr ? lastErr.message : "none configured"}`);
}

router.post("/api/chat", async (req, res) => {
  const question = (req.body && req.body.question || "").toString().trim();
  if (!question) {
    return res.status(400).json({ error: "bad_request", message: '"question" is required.' });
  }

  // Conversation history for multi-turn context (optional, additive)
  const history = (req.body && Array.isArray(req.body.history)) ? req.body.history : [];

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
      return `${role}: ${msg.content}`;
    }).join("\n");
  }

  // Step 1: Classify (and detect casual chat)
  // Deterministic legal-intent gate: if the raw message describes an incident
  // or legal matter, steer the classifier toward a legal classification and
  // enforce it as a backstop below.
  const forcedLegal = detectLegalIntent(question).legal;
  let classifyResult;
  try {
    classifyResult = await classifyWithFallback(question, conversationContext, { forceLegal: forcedLegal });
  } catch (err) {
    console.error("[/api/chat] classification failed:", err.status || "", err.message);
    return res.status(502).json({
      error: "classification_failed",
      message: "The classification model failed to respond. " + (err.message || ""),
    });
  }

  let { classification, provider: classifyProvider } = classifyResult;

  // Backstop: if the deterministic gate fired but the classifier still said
  // "casual", override with a valid legal classification. A described assault
  // must never fall through to a casual/empathy-only reply.
  if (forcedLegal && classification.is_legal_question === false) {
    console.warn("[/api/chat] Classifier said casual but deterministic gate detected a legal incident — forcing legal path");
    classification = buildFallbackClassification(question);
  }

  // Step 2: If casual chat, return early with a friendly response
  if (classification.is_legal_question === false) {
    return res.json({
      isCasual: true,
      casualReply: classification.casual_reply || "Hello! I'm here to help with Nigerian legal questions. Feel free to ask me anything about your rights, laws, or legal situations.",
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
      return res.json({
        classification,
        route: "simple",
        plan: null,
        result: proc.result,
        draftModel: proc.model,
        draftProvider: proc.provider,
        critique: null,
        evidence: {
          sufficient: true,
          relevanceScore: null,
          sourceCount: 0,
          retrievedFrom: [],
          reason: "Practical/procedural question — no statute required.",
          minSources: 0,
          noSourcing: true,
        },
        providersBusy: false,
        retryAfter: null,
      });
    } catch (err) {
      console.warn("[/api/chat] Procedural answer failed, using static guidance:", err.message);
      // Honest fallback: direct practical guidance with NO citations, never
      // routed back into the citation pipeline.
      return res.json({
        classification,
        route: "simple",
        plan: null,
        result: {
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
        },
        draftModel: "fallback",
        draftProvider: "procedural-fallback",
        critique: null,
        evidence: {
          sufficient: true,
          relevanceScore: null,
          sourceCount: 0,
          retrievedFrom: [],
          reason: "Practical/procedural question — no statute required.",
          minSources: 0,
          noSourcing: true,
        },
        providersBusy: false,
        retryAfter: null,
      });
    }
  }

  // Step 2b: HITL — if jurisdiction is unclear and the answer depends on state,
  // ask the user before proceeding. Don't guess and risk wrong law.
  if (classification.jurisdiction_status === "unclear") {
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
  let provisions;
  try {
    provisions = await findProvisions({
      practiceArea: classification.practice_area,
      jurisdiction: classification.jurisdiction,
      keywords: classification.keywords,
    });
  } catch (err) {
    console.error("[/api/chat] Firestore lookup failed:", err.message);
    
    // Provide user-friendly error messages
    let userMessage = err.message;
    if (err.message.includes("Quota exceeded")) {
      userMessage = "Our legal database is temporarily unavailable due to high demand. Please try again in a few minutes, or ask a different question.";
    } else if (err.message.includes("timed out")) {
      userMessage = "The request took too long to process. Please try again with a simpler question.";
    }
    
    return res.status(502).json({ 
      error: "corpus_lookup_failed", 
      message: userMessage,
      technicalDetails: err.message 
    });
  }

  if (!provisions.length) {
    return res.json({
      classification,
      result: null,
      corpusEmpty: true,
      message:
        `No ingested legal sources match "${classification.practice_area}" yet. ` +
        "Run the ingestion script for this practice area before this endpoint can answer it.",
    });
  }

  // Route (declared here so the insufficient-evidence early returns can use it)
  const route = classification.route || (classification.complexity === "Low" ? "simple" : "complex");
  const isSimple = route === "simple";

  // ── Relevance/sufficiency gate (between search and draft) ──────────────
  // Rank the retrieved provisions by whether they actually govern the
  // situation, not just overlap keywords. Insufficient evidence triggers a
  // broaden-and-re-search; if it is still insufficient, return an honest
  // low-confidence "insufficient evidence" response instead of dressing up a
  // mismatched citation as a confident answer.
  const MIN_SOURCES = 2; // at least 2 directly-on-point provisions required for a confident answer
  const evidence = {
    sufficient: false,
    relevanceScore: null,
    sourceCount: 0,
    retrievedFrom: [classification.practice_area],
    reason: "",
    minSources: MIN_SOURCES,
  };

  let workingProvisions = provisions;

  try {
    const gate = await assessRelevanceWithFallback(question, classification, provisions);
    const relevantIdx = new Set(
      Array.isArray(gate.relevant) ? gate.relevant.map((n) => Number(n) - 1).filter((i) => i >= 0 && i < provisions.length) : []
    );
    const relevantProvisions = relevantIdx.size
      ? provisions.filter((_, i) => relevantIdx.has(i))
      : provisions; // if the gate returned nothing, don't silently drop everything

    evidence.relevanceScore = typeof gate.relevance_score === "number" ? gate.relevance_score : null;
    evidence.reason = gate.reason || "";
    evidence.sourceCount = relevantProvisions.length;

    const sufficient = gate.sufficient === true && relevantProvisions.length >= MIN_SOURCES;
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
      });
      evidence.retrievedFrom = broad.categories || [classification.practice_area];

      if (broad.provisions.length) {
        const gate2 = await assessRelevanceWithFallback(question, classification, broad.provisions);
        const relevantIdx2 = new Set(
          Array.isArray(gate2.relevant) ? gate2.relevant.map((n) => Number(n) - 1).filter((i) => i >= 0 && i < broad.provisions.length) : []
        );
        const relevantProvisions2 = relevantIdx2.size
          ? broad.provisions.filter((_, i) => relevantIdx2.has(i))
          : broad.provisions;

        evidence.relevanceScore = typeof gate2.relevance_score === "number" ? gate2.relevance_score : evidence.relevanceScore;
        evidence.reason = gate2.reason || evidence.reason;
        evidence.sourceCount = relevantProvisions2.length;

        if (gate2.sufficient === true && relevantProvisions2.length >= MIN_SOURCES) {
          workingProvisions = relevantProvisions2;
          evidence.sufficient = true;
          console.log(`[/api/chat] Broadened search: ${relevantProvisions2.length} relevant provisions — sufficient`);
        } else {
          console.log(`[/api/chat] Broadened search still insufficient (${relevantProvisions2.length} relevant). Returning insufficient-evidence response.`);
          return res.json({
            classification,
            route,
            plan: null,
            result: {
              lawMd:
                `I found limited directly relevant Nigerian statutes for this specific situation in the available corpus. ` +
                `The closest provisions I could retrieve don't clearly and directly govern what you described, so I'd rather be honest than present a weakly-matched citation as solid law. ` +
                `This is exactly the kind of situation where a qualified lawyer can give you advice tailored to your facts.`,
              actionsMd:
                `- Step 1: Note down the key facts (dates, names, what happened) while they're fresh.\n` +
                `- Step 2: Report the incident to the police if it involves threats, assault, or a crime.\n` +
                `- Step 3: Consult a lawyer for advice specific to your situation — the right statute depends on details (state, parties, circumstances) the available sources don't fully pin down.`,
              sources: [],
              escalate: true,
              escalateReason: "No directly applicable provision was found in the ingested corpus for this situation.",
              followUps: [],
              evidence,
            },
            critique: null,
            evidence,
            providersBusy: false,
            retryAfter: null,
          });
        }
      } else {
        // Broadened search found nothing either — same honest outcome.
        return res.json({
          classification,
          route,
          plan: null,
          result: {
            lawMd:
              `I couldn't find directly relevant Nigerian statutes for this specific situation in the available corpus. ` +
              `Rather than guess, I recommend speaking to a qualified lawyer who can advise based on your exact circumstances.`,
            actionsMd:
              `- Step 1: Document the key facts while they're fresh.\n` +
              `- Step 2: If a crime or urgent harm is involved, report it to the police.\n` +
              `- Step 3: Consult a lawyer for tailored advice.`,
            sources: [],
            escalate: true,
            escalateReason: "No directly applicable provision was found in the ingested corpus.",
            followUps: [],
            evidence,
          },
          critique: null,
          evidence,
          providersBusy: false,
          retryAfter: null,
        });
      }
    }
  } catch (err) {
    // Relevance gate unavailable — degrade gracefully: pass everything through
    // so the user still gets an answer rather than an error.
    console.warn("[/api/chat] Relevance gate failed, proceeding with all provisions:", err.message);
    workingProvisions = provisions;
    evidence.sourceCount = provisions.length;
    evidence.sufficient = provisions.length >= MIN_SOURCES;
    evidence.reason = "Relevance check unavailable — all retrieved provisions passed through.";
    evidence.relevanceScore = null;
  }

  const EXCERPT_CHAR_CAP = 700; // keep total context small enough to fit even the tighter fallback model's per-minute limit
  const contextBlock = workingProvisions
    .map((p) => {
      const text = p.text.length > EXCERPT_CHAR_CAP ? p.text.slice(0, EXCERPT_CHAR_CAP) + "\u2026" : p.text;
      return `[${p.act}${p.section ? ", s." + p.section : ""}]\\n${text}`;
    })
    .join("\n\n---\n\n");

  let planResult = { plan: null, provider: "skipped" };
  if (!isSimple) {
    try {
      planResult = await planResponse(question, classification, workingProvisions);
      console.log(`[/api/chat] Planning completed via ${planResult.provider} (route=${route})`);
    } catch (err) {
      console.warn("[/api/chat] planning failed, continuing without plan:", err.message);
      planResult = { plan: null, provider: "none" };
    }
  } else {
    console.log(`[/api/chat] Simple route — skipping planning (route=${route})`);
  }

  // Step 5: Check question cache before running draft (V1 Phase 11)
  const cacheKey = getCacheKey(question, classification.jurisdiction);
  const cached = getCachedResult(cacheKey);
  let draftResult;
  let critiqueResult = null;

  if (cached && !cached.providersBusy) {
    console.log(`[/api/chat] Cache HIT for question (key: ${cacheKey.slice(0, 50)})`);
    draftResult = cached;
  } else {
    // Step 5a: Draft with fallback chain (plan is null for simple route)
    try {
      draftResult = await draftWithFallback(question, contextBlock, planResult.plan, classification, history);
    } catch (err) {
      console.error("[/api/chat] drafting failed:", err.status || "", err.message);
      return res.status(502).json({
        error: "drafting_failed",
        message: "The drafting model failed to respond. " + (err.message || ""),
      });
    }

    // Step 6: Critique + iteration loop (V1 Phase 1+2)
    // Skip critique for providersBusy responses (they're fallback errors, not real answers)
    if (!draftResult.providersBusy && draftResult.result) {
      const MAX_CRITIQUE_RETRIES = 2;

      // Phase 2: Category-specific thresholds — high-risk categories get a stricter bar.
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
          critiqueResult = await critiqueWithFallback(
            question, workingProvisions, draftResult.result, classification
          );

          // Override the critique's own "passed" with our category-specific thresholds
          critiqueResult.passed = critiqueResult.quality >= QUALITY_THRESHOLD
                               && critiqueResult.legal_safety >= SAFETY_THRESHOLD;
          critiqueResult.thresholds = { quality: QUALITY_THRESHOLD, safety: SAFETY_THRESHOLD };
          critiqueResult.isHighRisk = isHighRisk;

          console.log(`[/api/chat] Critique ${attempt + 1}/${MAX_CRITIQUE_RETRIES + 1} [${isHighRisk ? "HIGH-RISK" : "standard"}]: quality=${critiqueResult.quality.toFixed(2)}>=${QUALITY_THRESHOLD}, safety=${critiqueResult.legal_safety.toFixed(2)}>=${SAFETY_THRESHOLD} → ${critiqueResult.passed ? "PASS" : "FAIL"}`);

          if (critiqueResult.passed || attempt === MAX_CRITIQUE_RETRIES) {
            break;
          }

          // Critique failed — retry draft with feedback
          console.log(`[/api/chat] Re-drafting with feedback: ${critiqueResult.issues.join("; ").slice(0, 100)}`);
          const feedbackContext = `\n\nIMPORTANT FEEDBACK FROM PREVIOUS DRAFT REVIEW (attempt ${attempt + 1} failed):\n${critiqueResult.issues.map(i => "- " + i).join("\n")}\n\nFix ALL of these issues. ${isHighRisk ? "This is a HIGH-RISK legal area — accuracy and safety are critical." : ""}`;

          draftResult = await draftWithFallback(
            question, contextBlock + feedbackContext, planResult.plan, classification, history
          );
        } catch (err) {
          // Critique itself failed — don't block the response
          console.warn(`[/api/chat] Critique ${attempt + 1} error: ${err.message}`);
          critiqueResult = { quality: 0.5, legal_safety: 0.5, issues: ["critique_unavailable"], passed: true, thresholds: { quality: QUALITY_THRESHOLD, safety: SAFETY_THRESHOLD }, isHighRisk };
          break;
        }
      }

      // Phase 3 escalation: If high-risk category STILL fails after all retries,
      // cache the response and require explicit user acknowledgment before delivering.
      if (isHighRisk && critiqueResult && !critiqueResult.passed) {
        console.warn(`[/api/chat] HIGH-RISK category "${practiceArea}" failed critique after ${MAX_CRITIQUE_RETRIES + 1} attempts — requiring safety acknowledgment (HITL)`);

        const ackToken = generateAckToken();
        setPendingAck(ackToken, {
          question,
          classification,
          draftResult,
          critiqueResult,
          route,
          planResult,
          cacheKey,
        });

        // Return HITL response — client shows ApprovalCard for safety acknowledgment
        res.json({
          needsInput: true,
          safetyAck: true,
          ackToken,
          question: `This question involves ${practiceArea.replace(/_/g, " ")} — a high-risk legal area. Our quality review could not fully verify the response accuracy.`,
          field: "safety_acknowledgment",
          context: {
            practiceArea,
            quality: critiqueResult.quality,
            legal_safety: critiqueResult.legal_safety,
            issues: critiqueResult.issues,
            message: "This response covers a high-risk legal area and could not be verified to our standard. Do you still want to see the response? We strongly recommend consulting a qualified lawyer.",
          },
          provider: draftResult.provider,
        });
        return;
      }
    }

    // Cache the result (only successful, non-busy responses)
    if (!draftResult.providersBusy && draftResult.result) {
      setCachedResult(cacheKey, draftResult);
    }
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

  res.json({
    classification,
    route,
    plan: planResult.plan,
    result: draftResult.result,
    draftModel: draftResult.model,
    draftProvider: draftResult.provider,
    // Evidence quality from the relevance/sufficiency gate (V1 retrieval fix):
    // the client uses this to label confidence instead of hardcoding it.
    evidence,
    // Critique scores (V1 Phase 2 — split scoring with category-specific thresholds)
    critique: critiqueResult ? {
      quality: critiqueResult.quality,
      legal_safety: critiqueResult.legal_safety,
      passed: critiqueResult.passed,
      issues: critiqueResult.issues,
      thresholds: critiqueResult.thresholds || null,
      isHighRisk: critiqueResult.isHighRisk || false,
    } : null,
    // Safety flag for high-risk categories that failed critique (V1 Phase 2)
    safetyFlag: draftResult.result?._safetyFlag || null,
    // Bug fix: forward providersBusy flag so client can render error state
    // instead of styling a fallback message as a confident legal answer
    providersBusy: draftResult.providersBusy || false,
    retryAfter: draftResult.retryAfter || null,
  });
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

  const pending = getPendingAck(ackToken);
  if (!pending) {
    return res.status(404).json({ error: "not_found", message: "Acknowledgment token expired or not found. Please re-ask your question." });
  }

  // User rejected — don't return the response
  if (acknowledged === false) {
    pendingSafetyAck.delete(ackToken);
    return res.json({
      acknowledged: false,
      message: "Response withheld. Please consult a qualified lawyer for this matter.",
    });
  }

  // User acknowledged — return the cached response with safety flag attached
  pendingSafetyAck.delete(ackToken);
  const { question, classification, draftResult, critiqueResult, route, planResult, cacheKey } = pending;

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

  // Cache the result now that it's been acknowledged
  if (cacheKey && !draftResult.providersBusy) {
    setCachedResult(cacheKey, draftResult);
  }

  res.json({
    acknowledged: true,
    classification,
    route,
    plan: planResult?.plan || null,
    result: draftResult.result,
    draftModel: draftResult.model,
    draftProvider: draftResult.provider,
    critique: {
      quality: critiqueResult.quality,
      legal_safety: critiqueResult.legal_safety,
      passed: critiqueResult.passed,
      issues: critiqueResult.issues,
      thresholds: critiqueResult.thresholds || null,
      isHighRisk: critiqueResult.isHighRisk || false,
    },
    safetyFlag: draftResult.result?._safetyFlag || null,
    providersBusy: false,
    retryAfter: null,
  });
});


/**
 * GET /api/chat/stream — SSE endpoint with granular event-driven UI (V1 Phase 4).
 *
 * Emits sanitized structured events — no raw reasoning or prompts leaked:
 *   { event: "start" }
 *   { event: "classify_start" }
 *   { event: "classify_done", practiceArea, jurisdiction, urgency, route }
 *   { event: "needs_input", question, field }          ← HITL jurisdiction
 *   { event: "search_start" }
 *   { event: "search_done", sourceCount, sources[] }   ← sanitized labels only
 *   { event: "draft_start" }
 *   { event: "draft_done" }
 *   { event: "critique_start" }
 *   { event: "critique_done", quality, legal_safety, passed, isHighRisk }
 *   { event: "safety_flag", practiceArea, message, ackToken }  ← Phase 3 HITL
 *   { event: "complete", result, classification, critique, safetyFlag }
 *   { event: "casual", casualReply }
 *   { event: "corpus_empty", message }
 *   { event: "error", message }
 */
router.get("/api/chat/stream", async (req, res) => {
  const question = (req.query && req.query.question || "").toString().trim();
  if (!question) {
    res.writeHead(400, { "Content-Type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ event: "error", message: "question is required" })}\n\n`);
    return res.end();
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const emit = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Handle client disconnect
  let cancelled = false;
  req.on("close", () => { cancelled = true; });

  try {
    const pipelineStart = Date.now();
    emit({ event: "start" });

    // ── Step 1: Classify ──
    emit({ event: "classify_start" });
    const forcedLegal = detectLegalIntent(question).legal;
    const classifyResult = await classifyWithFallback(question, "", { forceLegal: forcedLegal });
    if (cancelled) return res.end();
    let classification = classifyResult.classification;

    // Deterministic backstop — a described incident must not become casual.
    if (forcedLegal && classification.is_legal_question === false) {
      console.warn("[/api/chat/stream] Classifier said casual but deterministic gate detected a legal incident — forcing legal path");
      classification = buildFallbackClassification(question);
    }

    emit({
      event: "classify_done",
      practiceArea: classification.practice_area,
      jurisdiction: classification.jurisdiction,
      urgency: classification.urgency,
      route: classification.route || "simple",
      elapsedMs: Date.now() - pipelineStart,
    });

    // Casual chat shortcut
    if (classification.is_legal_question === false) {
      emit({ event: "casual", casualReply: classification.casual_reply });
      return res.end();
    }

    // HITL: Jurisdiction unclear
    if (classification.jurisdiction_status === "unclear") {
      emit({ event: "needs_input", question: "Which state did this happen in? The laws can differ by state.", field: "jurisdiction" });
      return res.end();
    }

    // ── Step 2: Search legal sources ──
    emit({ event: "search_start" });
    let provisions;
    try {
      provisions = await findProvisions({
        practiceArea: classification.practice_area,
        jurisdiction: classification.jurisdiction,
        keywords: classification.keywords,
      });
    } catch (err) {
      emit({ event: "error", message: "Legal database unavailable." });
      return res.end();
    }
    if (cancelled) return res.end();

    if (!provisions.length) {
      emit({ event: "corpus_empty", message: "No ingested legal sources match this area yet." });
      return res.end();
    }

    // Sanitized source labels only — no raw excerpts leaked
    const sanitizedSources = provisions.slice(0, 6).map(p => ({
      label: `${p.act}${p.section ? ", s." + p.section : ""}`,
    }));
    emit({ event: "search_done", sourceCount: provisions.length, sources: sanitizedSources });

    // ── Step 3: Draft ──
    emit({ event: "draft_start" });
    const contextBlock = provisions.map((p) => `[${p.act}${p.section ? ", s." + p.section : ""}]\n${p.text}`).join("\n\n---\n\n");
    const draftResult = await draftWithFallback(question, contextBlock, null, classification);
    if (cancelled) return res.end();

    if (draftResult.providersBusy) {
      emit({ event: "complete", providersBusy: true, retryAfter: draftResult.retryAfter || 30, result: draftResult.result });
      return res.end();
    }

    emit({ event: "draft_done", elapsedMs: Date.now() - pipelineStart });

    // ── Step 4: Critique (V1 Phase 1+2) ──
    emit({ event: "critique_start" });
    let critiqueResult = null;
    const MAX_RETRIES = 2;
    const practiceArea = (classification.practice_area || "").toLowerCase();
    const HIGH_RISK = ["criminal_rights", "criminal_offences", "immigration_citizenship", "constitutional_rights", "family_law"];
    const isHighRisk = HIGH_RISK.includes(practiceArea);
    const QUALITY_T = 0.6;
    const SAFETY_T = isHighRisk ? 0.7 : 0.6;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        critiqueResult = await critiqueWithFallback(question, provisions, draftResult.result, classification);
        critiqueResult.passed = critiqueResult.quality >= QUALITY_T && critiqueResult.legal_safety >= SAFETY_T;
        critiqueResult.thresholds = { quality: QUALITY_T, safety: SAFETY_T };
        critiqueResult.isHighRisk = isHighRisk;

        if (critiqueResult.passed || attempt === MAX_RETRIES) break;

        // Retry draft with feedback
        const feedback = `\n\nFIX THESE ISSUES: ${critiqueResult.issues.join("; ")}${isHighRisk ? " This is HIGH-RISK — accuracy is critical." : ""}`;
        draftResult = await draftWithFallback(question, contextBlock + feedback, null, classification);
        if (cancelled) return res.end();
      } catch (err) {
        critiqueResult = { quality: 0.5, legal_safety: 0.5, issues: ["critique_unavailable"], passed: true, thresholds: { quality: QUALITY_T, safety: SAFETY_T }, isHighRisk };
        break;
      }
    }

    emit({
      event: "critique_done",
      quality: critiqueResult.quality,
      legal_safety: critiqueResult.legal_safety,
      passed: critiqueResult.passed,
      isHighRisk: critiqueResult.isHighRisk,
      elapsedMs: Date.now() - pipelineStart,
    });

    // ── Phase 3: Safety HITL ──
    if (isHighRisk && critiqueResult && !critiqueResult.passed) {
      const ackToken = generateAckToken();
      setPendingAck(ackToken, { question, classification, draftResult, critiqueResult, route: classification.route });
      emit({
        event: "safety_flag",
        practiceArea,
        message: "This response covers a high-risk legal area and could not be verified to our standard.",
        ackToken,
      });
      return res.end();
    }

    // ── Complete ──
    emit({
      event: "complete",
      result: draftResult.result,
      classification,
      route: classification.route,
      critique: {
        quality: critiqueResult.quality,
        legal_safety: critiqueResult.legal_safety,
        passed: critiqueResult.passed,
      },
      totalElapsedMs: Date.now() - pipelineStart,
    });
    res.end();

  } catch (err) {
    console.error("[/api/chat/stream] Error:", err.message);
    emit({ event: "error", message: "Something went wrong. Please try again." });
    res.end();
  }
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
        { temperature: 0.3, max_tokens: 30 }
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

module.exports = router;
