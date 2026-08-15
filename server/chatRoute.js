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
const { findProvisions } = require("./legalCorpus");
const { PRACTICE_AREAS: PRACTICE_AREA_DEFS, PRACTICE_AREA_KEYS } = require("./practiceAreas");

const PRACTICE_AREAS = PRACTICE_AREA_KEYS;

/**
 * Some models occasionally wrap JSON-mode output in markdown code fences
 * even when told not to. Strip those before parsing rather than failing outright.
 */
function parseModelJson(content) {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  return JSON.parse(trimmed);
}

const PRACTICE_AREA_BULLETS = PRACTICE_AREA_DEFS.map((p) => `- "${p.key}": ${p.description}`).join("\n");


const CLASSIFY_SYSTEM_PROMPT = `You are an expert Nigerian legal classifier. Analyze the user's message with precision.

First, determine if this is a legal question or casual conversation.

If it's NOT a legal question (greetings, casual chat, meta-questions, or non-legal topics), respond with:
{"is_legal_question": false, "casual_reply": "A warm, natural response mentioning you help with Nigerian legal questions."}

If it IS a legal question, perform DEEP ANALYSIS:

Valid practice areas: ${JSON.stringify(PRACTICE_AREAS)}
${PRACTICE_AREA_BULLETS}

Provide:
- "practice_area": Single best-fitting category from the list above
- "jurisdiction": Specific jurisdiction (e.g., "Lagos State", "Federal", "Rivers State")
- "urgency": ["Low", "Medium", "High", "Critical"] — based on time sensitivity and potential harm
- "summary": 1-2 sentence summary of the legal situation
- "keywords": 4-8 specific legal/factual terms likely in relevant statutes (procedural terms, timeframes, named concepts)
- "key_issues": Array of 3-5 specific legal issues or questions that need to be addressed
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
  "urgency": "High",
  "summary": "Tenant facing potential illegal eviction after landlord changed locks without court order or proper notice.",
  "keywords": ["notice to quit", "seven days notice", "court order", "forcible entry", "possession", "magistrate court"],
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

Respond with ONLY a JSON object, no prose, no markdown.`;

const DRAFT_SYSTEM_PROMPT = `You are Legally Unbullied, an expert Nigerian legal-information assistant. You provide clear, comprehensive, and actionable legal information based ONLY on the statute excerpts provided.

CORE PRINCIPLES:
- Use ONLY the provided statute excerpts — never cite provisions not in the context
- Cite the Act and section number for every legal claim
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

**sources**: Array of 3-4 most important statutory provisions cited, with:
- "label": "Act Name, s.X"
- "excerpt": The key text from that section (max 400 chars)

**escalate**: Boolean — true if this likely needs a lawyer

**escalateReason**: 1-2 sentences explaining why a lawyer is/isn't needed

**followUps**: Array of 2-3 natural follow-up questions the user might ask

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
      return { plan: parseModelJson(completion.choices[0].message.content), provider: "groq" };
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
      return { plan: parseModelJson(completion.choices[0].message.content), provider: "gemini" };
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

/**
 * CRITIQUE_PROMPT — evaluates a draft response against the question, plan, and provisions.
 * Returns a single quality score (0-1) and specific issues.
 * Phase 2 will split this into quality + legal_safety; Phase 1 keeps it unified.
 */
const CRITIQUE_PROMPT = `You are a senior Nigerian legal reviewer. Critique the draft answer below.

Evaluate on these dimensions and produce a SINGLE quality score (0 to 1):
- Accuracy: Does the draft cite only provisions actually in the context? Does it invent laws?
- Completeness: Does it address all key_issues from the plan?
- Clarity: Is it written in plain language a layperson can understand?
- Actionability: Are the next steps concrete and specific?
- Citation quality: Does every legal claim cite an Act and section from the provided excerpts?

Scoring guidance:
- 0.90+ : Excellent — accurate, complete, clear, well-cited, actionable
- 0.75-0.89: Good — minor gaps but substantively correct
- 0.60-0.74: Needs work — missing citations, unclear, or incomplete
- below 0.60: Poor — significant issues that require rewriting

If the draft fails, list SPECIFIC fixable issues (not vague complaints). Each issue should name what's wrong and how to fix it.

Question: {{QUESTION}}

Classification:
- Practice area: {{PRACTICE_AREA}}
- Key issues: {{KEY_ISSUES}}
- Complexity: {{COMPLEXITY}}

Plan (if available):
{{PLAN}}

Provided provisions (abbreviated):
{{PROVISIONS}}

Draft answer to critique:
{{DRAFT}}

Respond with ONLY a JSON object:
{
  "quality": 0.00,
  "passed": true/false,
  "issues": [
    { "dimension": "accuracy|completeness|clarity|actionability|citations", "problem": "what's wrong", "fix": "how to fix it" }
  ],
  "strengths": ["what the draft does well"],
  "rewrite_hint": "1-2 sentence instruction for how to improve the draft if it needs rewriting"
}

Rule: "passed" must be true ONLY if quality >= 0.70. Do not pass drafts below 0.70.`;

async function critiqueDraft(question, classification, plan, provisions, draft) {
  const groqClient = getGroqClient();
  const geminiClient = getGeminiClient();

  // Build abbreviated provision list for critique context
  const provisionSummary = (provisions || [])
    .slice(0, 10)
    .map(p => `[${p.act}${p.section ? ", s." + p.section : ""}] ${p.text.slice(0, 150)}...`)
    .join("\n");

  const planText = plan
    ? `Analysis: ${plan.analysis || "N/A"}
Key provisions: ${(plan.key_provisions || []).join("; ")}
Sub-questions: ${(plan.sub_questions || []).join("; ")}
Response structure: ${plan.response_structure || "N/A"}
Gaps: ${(plan.gaps || []).join(", ") || "none"}`
    : "(no plan — simple question)";

  const keyIssues = (classification.key_issues || []).join("; ");

  const critiquePrompt = CRITIQUE_PROMPT
    .replace("{{QUESTION}}", question)
    .replace("{{PRACTICE_AREA}}", classification.practice_area || "unknown")
    .replace("{{KEY_ISSUES}}", keyIssues)
    .replace("{{COMPLEXITY}}", classification.complexity || "unknown")
    .replace("{{PLAN}}", planText)
    .replace("{{PROVISIONS}}", provisionSummary)
    .replace("{{DRAFT}}", JSON.stringify(draft));

  // Try Groq
  if (groqClient) {
    try {
      const completion = await callCompletion(
        groqClient,
        DRAFT_MODEL,
        [
          { role: "system", content: "You are a precise legal reviewer. Respond with ONLY valid JSON, no markdown." },
          { role: "user", content: critiquePrompt }
        ],
        { temperature: 0.2, max_tokens: 800, response_format: { type: "json_object" } }
      );
      return { critique: parseModelJson(completion.choices[0].message.content), provider: "groq" };
    } catch (err) {
      console.warn("[/api/chat] Groq critique failed:", err.status || "", err.message);
    }
  }

  // Try Gemini
  if (geminiClient) {
    try {
      const completion = await callCompletion(
        geminiClient,
        GEMINI_DRAFT_MODEL,
        [
          { role: "system", content: "You are a precise legal reviewer. Respond with ONLY valid JSON, no markdown." },
          { role: "user", content: critiquePrompt }
        ],
        { temperature: 0.2, max_tokens: 800, response_format: { type: "json_object" } }
      );
      return { critique: parseModelJson(completion.choices[0].message.content), provider: "gemini" };
    } catch (err) {
      console.warn("[/api/chat] Gemini critique failed:", err.status || "", err.message);
    }
  }

  // Fallback: auto-pass with low quality to avoid blocking the pipeline
  return {
    critique: {
      quality: 0.70,
      passed: true,
      issues: [],
      strengths: ["auto-passed due to critique service unavailability"],
      rewrite_hint: "No critique available — returning draft as-is."
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
  
  return withTimeout(completionPromise, LLM_TIMEOUT_MS, `LLM call to ${model}`);
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

async function classifyWithFallback(question) {
  const groqClient = getGroqClient();
  const openRouterClient = getOpenRouterClient();
  const cerebrasClient = getCerebrasClient();
  const geminiClient = getGeminiClient();

  // Try Groq first (fastest, already working for casual chat)
  if (groqClient) {
    try {
      const completion = await callCompletion(
        groqClient,
        CLASSIFY_MODEL,
        [
          { role: "system", content: CLASSIFY_SYSTEM_PROMPT },
          { role: "user", content: question },
        ],
        { temperature: 0, max_tokens: 2000, response_format: { type: "json_object" } }
      );
      return { classification: parseModelJson(completion.choices[0].message.content), provider: "groq" };
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
          { role: "user", content: question },
        ],
        { temperature: 0, max_tokens: 2000, response_format: { type: "json_object" } }
      );
      return { classification: parseModelJson(completion.choices[0].message.content), provider: "openrouter" };
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
          { role: "user", content: question },
        ],
        { temperature: 0, max_tokens: 2000, response_format: { type: "json_object" } }
      );
      return { classification: parseModelJson(completion.choices[0].message.content), provider: "cerebras" };
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
          { role: "user", content: question },
        ],
        { temperature: 0, max_tokens: 2000, response_format: { type: "json_object" } }
      );
      return { classification: parseModelJson(completion.choices[0].message.content), provider: "gemini" };
    } catch (err) {
      console.error(`[/api/chat] All LLM providers failed. Last error (Gemini): ${err.status || ""} ${err.message}`);
      throw err;
    }
  }

  throw new Error("No LLM provider configured for classification. Set GROQ_API_KEY, OPENROUTER_API_KEY, CEREBRAS_API_KEY, or GEMINI_API_KEY.");
}

async function draftWithModel(client, model, question, contextBlock, plan, classification) {
  // Build comprehensive context from classification and plan
  let enhancedContext = "";
  
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
      { role: "user", content: `Question: ${question}\n\nAvailable statute excerpts:\n\n${contextBlock}${enhancedContext}` },
    ],
    { response_format: { type: "json_object" }, max_tokens: 3000 }
  );
  return parseModelJson(completion.choices[0].message.content);
}

async function draftWithFallback(question, contextBlock, plan, classification) {
  const groqClient = getGroqClient();
  const openRouterClient = getOpenRouterClient();
  const cerebrasClient = getCerebrasClient();
  const geminiClient = getGeminiClient();

  // Try Groq primary model
  if (groqClient) {
    try {
      const result = await draftWithModel(groqClient, DRAFT_MODEL, question, contextBlock, plan, classification);
      return { result, model: DRAFT_MODEL, provider: "groq" };
    } catch (err) {
      const isRateLimited = err.status === 429 || err.status === 413;
      if (isRateLimited) {
        console.warn(`[/api/chat] Groq ${DRAFT_MODEL} rate-limited, trying fallback model...`);

        // Try Groq fallback model
        if (DRAFT_MODEL_FALLBACK && DRAFT_MODEL_FALLBACK !== DRAFT_MODEL) {
          try {
            const result = await draftWithModel(groqClient, DRAFT_MODEL_FALLBACK, question, contextBlock, plan, classification);
            return { result, model: DRAFT_MODEL_FALLBACK, provider: "groq-fallback" };
          } catch (fallbackErr) {
            console.warn(`[/api/chat] Groq fallback also failed: ${fallbackErr.status || ""} ${fallbackErr.message}`);
          }
        }
      } else {
        console.warn(`[/api/chat] Groq drafting failed: ${err.status || ""} ${err.message}`);
      }
    }
  }

  // Try OpenRouter (35+ free models)
  if (openRouterClient) {
    try {
      const result = await draftWithModel(openRouterClient, OPENROUTER_DRAFT_MODEL, question, contextBlock, plan, classification);
      return { result, model: OPENROUTER_DRAFT_MODEL, provider: "openrouter" };
    } catch (err) {
      console.warn(`[/api/chat] OpenRouter drafting failed: ${err.status || ""} ${err.message}`);
    }
  }

  // Try Cerebras (ultra-fast)
  if (cerebrasClient) {
    try {
      const result = await draftWithModel(cerebrasClient, CEREBRAS_DRAFT_MODEL, question, contextBlock, plan, classification);
      return { result, model: CEREBRAS_DRAFT_MODEL, provider: "cerebras" };
    } catch (err) {
      console.warn(`[/api/chat] Cerebras drafting failed: ${err.status || ""} ${err.message}`);
    }
  }

  // Try Gemini as last resort
  if (geminiClient) {
    try {
      const result = await draftWithModel(geminiClient, GEMINI_DRAFT_MODEL, question, contextBlock, plan, classification);
      return { result, model: GEMINI_DRAFT_MODEL, provider: "gemini" };
    } catch (err) {
      console.error(`[/api/chat] All LLM providers failed. Last error (Gemini): ${err.status || ""} ${err.message}`);
      throw err;
    }
  }

  throw new Error("No LLM provider available for drafting. Set GROQ_API_KEY, OPENROUTER_API_KEY, CEREBRAS_API_KEY, or GEMINI_API_KEY.");
}

router.post("/api/chat", async (req, res) => {
  const question = (req.body && req.body.question || "").toString().trim();
  if (!question) {
    return res.status(400).json({ error: "bad_request", message: '"question" is required.' });
  }

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

  // Step 1: Classify (and detect casual chat)
  let classifyResult;
  try {
    classifyResult = await classifyWithFallback(question);
  } catch (err) {
    console.error("[/api/chat] classification failed:", err.status || "", err.message);
    return res.status(502).json({
      error: "classification_failed",
      message: "The classification model failed to respond. " + (err.message || ""),
    });
  }

  const { classification, provider: classifyProvider } = classifyResult;

  // Step 2: If casual chat, return early with a friendly response
  if (classification.is_legal_question === false) {
    return res.json({
      isCasual: true,
      casualReply: classification.casual_reply || "Hello! I'm here to help with Nigerian legal questions. Feel free to ask me anything about your rights, laws, or legal situations.",
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

  const EXCERPT_CHAR_CAP = 700; // keep total context small enough to fit even the tighter fallback model's per-minute limit
  const contextBlock = provisions
    .map((p) => {
      const text = p.text.length > EXCERPT_CHAR_CAP ? p.text.slice(0, EXCERPT_CHAR_CAP) + "\u2026" : p.text;
      return `[${p.act}${p.section ? ", s." + p.section : ""}]\\n${text}`;
    })
    .join("\n\n---\n\n");

  // Step 4: Route — simple skips planning, complex plans + iterates
  const route = classification.route || (classification.complexity === "Low" ? "simple" : "complex");
  const isSimple = route === "simple";

  let planResult = { plan: null, provider: "skipped" };
  if (!isSimple) {
    try {
      planResult = await planResponse(question, classification, provisions);
      console.log(`[/api/chat] Planning completed via ${planResult.provider} (route=${route})`);
    } catch (err) {
      console.warn("[/api/chat] planning failed, continuing without plan:", err.message);
      planResult = { plan: null, provider: "none" };
    }
  } else {
    console.log(`[/api/chat] Simple route — skipping planning (route=${route})`);
  }

  // Step 5: Draft with fallback chain (plan is null for simple route)
  let draftResult;
  try {
    draftResult = await draftWithFallback(question, contextBlock, planResult.plan, classification);
  } catch (err) {
    console.error("[/api/chat] drafting failed:", err.status || "", err.message);
    return res.status(502).json({
      error: "drafting_failed",
      message: "The drafting model failed to respond. " + (err.message || ""),
    });
  }

  // Step 6: Critique — quality gate. Complex path iterates (max 2 retries); simple path does one pass.
  const MAX_RETRIES = 2;
  let currentDraft = draftResult.result;
  let currentDraftMeta = { model: draftResult.model, provider: draftResult.provider };
  let lastCritique = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let critiqueResult;
    try {
      critiqueResult = await critiqueDraft(question, classification, planResult.plan, provisions, currentDraft);
      lastCritique = critiqueResult.critique;
      console.log(`[/api/chat] Critique attempt ${attempt}/${MAX_RETRIES}: quality=${lastCritique.quality?.toFixed(2)} passed=${lastCritique.passed} via ${critiqueResult.provider}`);
    } catch (err) {
      console.warn("[/api/chat] critique failed, treating as pass:", err.message);
      break; // don't block on critique errors
    }

    if (lastCritique && lastCritique.passed) {
      break; // good enough — exit loop
    }

    // Failed critique — complex path rewrites; simple path accepts the draft anyway
    if (isSimple) {
      console.log("[/api/chat] Simple route: critique failed but skipping rewrite");
      break;
    }

    if (attempt === MAX_RETRIES) {
      console.log("[/api/chat] Max critique retries exhausted — returning best draft");
      break;
    }

    // Rewrite draft using critique feedback
    const rewriteHint = lastCritique?.rewrite_hint || "Improve the draft addressing the issues listed.";
    const rewriteIssues = (lastCritique?.issues || []).map(i => `- [${i.dimension}] ${i.problem} → fix: ${i.fix}`).join("\n");

    try {
      const rewriteResult = await draftWithFallback(
        question,
        contextBlock,
        {
          ...planResult.plan,
          rewrite_hint: rewriteHint,
          critique_issues: rewriteIssues,
          previous_quality: lastCritique?.quality
        },
        classification
      );
      currentDraft = rewriteResult.result;
      currentDraftMeta = { model: rewriteResult.model, provider: rewriteResult.provider };
      console.log(`[/api/chat] Rewrite attempt ${attempt + 1} via ${rewriteResult.provider}`);
    } catch (err) {
      console.warn("[/api/chat] rewrite failed, keeping previous draft:", err.message);
      break;
    }
  }

  res.json({
    classification,
    route,
    plan: planResult.plan,
    result: currentDraft,
    draftModel: currentDraftMeta.model,
    draftProvider: currentDraftMeta.provider,
    critique: lastCritique || null,
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
