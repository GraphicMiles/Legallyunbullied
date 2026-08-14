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


const CLASSIFY_SYSTEM_PROMPT = `You classify messages for a Nigerian legal-information assistant called "Legally Unbullied".

First, determine if this is a legal question or casual conversation.

If it's NOT a legal question (greetings like "hi", "hello", "good morning"; casual chat like "how are you", "what's up"; meta-questions about the bot like "who made you", "what can you do"; or anything unrelated to Nigerian law), respond with:
{"is_legal_question": false, "casual_reply": "A warm, natural, brief response in 1-2 sentences. Be friendly and mention you're here to help with Nigerian legal questions if they have any."}

If it IS a legal question (anything about Nigerian law, rights, legal processes, courts, police, contracts, tenancy, employment disputes, criminal matters, family law, business registration, taxes, etc.), classify it with deep analysis:

Valid values for "practice_area": ${JSON.stringify(PRACTICE_AREAS)}
${PRACTICE_AREA_BULLETS}

Pick exactly one practice_area — the single best-fitting category. Prefer "general" over force-fitting a loose match.

Valid values for "urgency": ["Low", "Medium", "High", "Critical"]

"keywords": 3-6 specific legal/factual terms likely to appear verbatim in the relevant statute text (e.g. procedural terms, timeframes, named concepts) — used to narrow down a large Act to the sections that actually matter for this question. Not generic words.

"key_issues": Array of 2-4 specific legal issues or questions raised (e.g., ["legality of lockout without court order", "tenant's right to peaceful possession", "remedies for illegal eviction"])

"complexity": "Low" | "Medium" | "High" — how complex is this legal question?
- Low: straightforward single-issue question
- Medium: multiple issues or requires interpretation
- High: complex multi-party dispute, constitutional issues, or novel legal questions

"reasoning_approach": Brief description (1 sentence) of how to approach answering this question (e.g., "First establish the legal framework for tenancy, then analyze whether the landlord's actions violated specific provisions, finally outline available remedies")

Example for a legal question (use realistic values for the actual question, don't copy this example's content):
{"is_legal_question": true, "practice_area": "tenancy", "jurisdiction": "Lagos State", "urgency": "High", "summary": "A tenant is disputing an eviction attempt made without proper notice.", "keywords": ["notice", "quit", "possession", "monthly tenant"], "key_issues": ["validity of eviction notice", "statutory notice period requirements", "tenant's right to remain in possession"], "complexity": "Medium", "reasoning_approach": "Analyze the statutory notice requirements for different tenancy types, determine if proper notice was given, and outline remedies available to the tenant."}

Respond with ONLY a JSON object, no prose, no markdown code fences.`;

const DRAFT_SYSTEM_PROMPT = `You are Legally Unbullied, a Nigerian legal-information assistant. You are not a lawyer and must not give legal advice — only plain-language information about what the law says and what someone can practically do next.

Hard rules:
- Only use the statute excerpts you are given below. Never cite an Act, section number, or fact that isn't present in them.
- If the excerpts don't fully answer the question, say so plainly in "lawMd" rather than filling the gap with assumptions.
- Cite the Act and section for every legal claim in "lawMd".
- "lawMd" and "actionsMd" may use markdown (**bold**, "- " bullet lines). Every other field is plain text, no markdown.
- Keep "sources" to at most 4 entries, each excerpt under 400 characters.
- Respond with ONLY a JSON object, no prose, no markdown code fences around it.

Example of the exact shape to return (use realistic values for the actual question, don't copy this example's content):
{"lawMd": "Under the Example Act 2020 (s.4), ...", "actionsMd": "- Do this first.\\n- Then do this.", "sources": [{"label": "Example Act 2020, s.4", "excerpt": "the exact excerpt text relied on"}], "escalate": true, "escalateReason": "Why a lawyer is or isn't needed, in one or two sentences.", "followUps": ["A natural follow-up question.", "Another natural follow-up question."]}`;

const PLAN_SYSTEM_PROMPT = `You are a legal reasoning assistant specializing in Nigerian law. Your task is to analyze the user's question and the available legal provisions, then create a structured plan for how to answer the question.

Given:
- The user's question
- The classification (practice area, key issues, complexity)
- Available statute excerpts

Create a brief, structured analysis plan that shows your reasoning process. This plan will help structure the final response.

Respond with a JSON object containing:
- "analysis": A 2-3 sentence analysis of the core legal question and what needs to be determined
- "key_provisions": Array of 2-4 most relevant provisions and why they matter (e.g., ["Section 13 of Tenancy Law - establishes notice requirements", "Section 20 - provides remedies for illegal eviction"])
- "response_structure": Brief outline of how to structure the answer (e.g., "1. Establish legal framework, 2. Apply to facts, 3. Outline remedies")
- "gaps": Any aspects of the question that the available provisions don't fully address (can be empty array if fully covered)

Keep the analysis concise but thoughtful. This demonstrates careful reasoning before drafting the response.

Respond with ONLY a JSON object, no prose, no markdown code fences.`;

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

async function callCompletion(client, model, messages, options = {}) {
  return client.chat.completions.create({
    model,
    temperature: options.temperature ?? 0.2,
    max_tokens: options.max_tokens ?? 900,
    response_format: options.response_format || undefined,
    messages,
  });
}

async function classifyWithFallback(question) {
  const groqClient = getGroqClient();
  const geminiClient = getGeminiClient();

  // Try Groq first
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
      // Fall through to Gemini
    }
  }

  // Try Gemini
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
      console.error(`[/api/chat] Gemini classification also failed: ${err.status || ""} ${err.message}`);
      throw err;
    }
  }

  throw new Error("No LLM provider configured for classification.");
}

async function draftWithModel(client, model, question, contextBlock, plan) {
  // Include the plan in the drafting context to guide the response
  const planContext = plan ? `

Reasoning Plan:
- Analysis: ${plan.analysis}
- Key Provisions: ${plan.key_provisions.join(", ")}
- Response Structure: ${plan.response_structure}
${plan.gaps && plan.gaps.length > 0 ? `- Gaps to Address: ${plan.gaps.join(", ")}` : ""}

Use this plan to structure your response. Follow the response structure and ensure you address the key provisions identified.` : "";

  const completion = await callCompletion(
    client,
    model,
    [
      { role: "system", content: DRAFT_SYSTEM_PROMPT },
      { role: "user", content: `Question: ${question}\n\nAvailable statute excerpts:\n\n${contextBlock}${planContext}` },
    ],
    { response_format: { type: "json_object" }, max_tokens: 3000 }
  );
  return parseModelJson(completion.choices[0].message.content);
}

async function draftWithFallback(question, contextBlock, plan) {
  const groqClient = getGroqClient();
  const geminiClient = getGeminiClient();

  // Try Groq primary model
  if (groqClient) {
    try {
      const result = await draftWithModel(groqClient, DRAFT_MODEL, question, contextBlock, plan);
      return { result, model: DRAFT_MODEL, provider: "groq" };
    } catch (err) {
      const isRateLimited = err.status === 429 || err.status === 413;
      if (isRateLimited) {
        console.warn(`[/api/chat] Groq ${DRAFT_MODEL} rate-limited, trying fallback...`);

        // Try Groq fallback model
        if (DRAFT_MODEL_FALLBACK && DRAFT_MODEL_FALLBACK !== DRAFT_MODEL) {
          try {
            const result = await draftWithModel(groqClient, DRAFT_MODEL_FALLBACK, question, contextBlock, plan);
            return { result, model: DRAFT_MODEL_FALLBACK, provider: "groq-fallback" };
          } catch (fallbackErr) {
            console.warn(`[/api/chat] Groq fallback also failed: ${fallbackErr.status || ""} ${fallbackErr.message}`);
            // Fall through to Gemini
          }
        }
      } else {
        console.error(`[/api/chat] Groq drafting failed with non-rate-limit error: ${err.status || ""} ${err.message}`);
        // For non-rate-limit errors, still try Gemini as a safety net
      }
    }
  }

  // Try Gemini
  if (geminiClient) {
    try {
      const result = await draftWithModel(geminiClient, GEMINI_DRAFT_MODEL, question, contextBlock, plan);
      return { result, model: GEMINI_DRAFT_MODEL, provider: "gemini" };
    } catch (err) {
      console.error(`[/api/chat] Gemini drafting also failed: ${err.status || ""} ${err.message}`);
      throw err;
    }
  }

  throw new Error("No LLM provider available for drafting.");
}

router.post("/api/chat", async (req, res) => {
  const question = (req.body && req.body.question || "").toString().trim();
  if (!question) {
    return res.status(400).json({ error: "bad_request", message: '"question" is required.' });
  }

  // Check that at least one LLM provider is configured
  const groqClient = getGroqClient();
  const geminiClient = getGeminiClient();
  if (!groqClient && !geminiClient) {
    return res.status(503).json({
      error: "not_configured",
      message: "No LLM provider configured. Set GROQ_API_KEY and/or GEMINI_API_KEY.",
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
    return res.status(502).json({ error: "corpus_lookup_failed", message: err.message });
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
      const text = p.text.length > EXCERPT_CHAR_CAP ? p.text.slice(0, EXCERPT_CHAR_CAP) + "…" : p.text;
      return `[${p.act}${p.section ? ", s." + p.section : ""}]\n${text}`;
    })
    .join("\n\n---\n\n");

  // Step 4: Plan the response (thinking/reasoning phase)
  let planResult;
  try {
    planResult = await planResponse(question, classification, provisions);
    console.log(`[/api/chat] Planning completed via ${planResult.provider}`);
  } catch (err) {
    console.warn("[/api/chat] planning failed, continuing without plan:", err.message);
    planResult = { plan: null, provider: "none" };
  }

  // Step 5: Draft with fallback chain (using the plan to guide the response)
  let draftResult;
  try {
    draftResult = await draftWithFallback(question, contextBlock, planResult.plan);
  } catch (err) {
    console.error("[/api/chat] drafting failed:", err.status || "", err.message);
    return res.status(502).json({
      error: "drafting_failed",
      message: "The drafting model failed to respond. " + (err.message || ""),
    });
  }

  res.json({
    classification,
    plan: planResult.plan,
    result: draftResult.result,
    draftModel: draftResult.model,
    draftProvider: draftResult.provider,
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
