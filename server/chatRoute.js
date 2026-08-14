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

If it IS a legal question (anything about Nigerian law, rights, legal processes, courts, police, contracts, tenancy, employment disputes, criminal matters, family law, business registration, taxes, etc.), classify it:

Valid values for "practice_area": ${JSON.stringify(PRACTICE_AREAS)}
${PRACTICE_AREA_BULLETS}

Pick exactly one practice_area — the single best-fitting category. Prefer "general" over force-fitting a loose match.

Valid values for "urgency": ["Low", "Medium", "High", "Critical"]

"keywords": 3-6 specific legal/factual terms likely to appear verbatim in the relevant statute text (e.g. procedural terms, timeframes, named concepts) — used to narrow down a large Act to the sections that actually matter for this question. Not generic words.

Example for a legal question (use realistic values for the actual question, don't copy this example's content):
{"is_legal_question": true, "practice_area": "tenancy", "jurisdiction": "Lagos State", "urgency": "High", "summary": "A tenant is disputing an eviction attempt made without proper notice.", "keywords": ["notice", "quit", "possession", "monthly tenant"]}

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

async function draftWithModel(client, model, question, contextBlock) {
  const completion = await callCompletion(
    client,
    model,
    [
      { role: "system", content: DRAFT_SYSTEM_PROMPT },
      { role: "user", content: `Question: ${question}\n\nAvailable statute excerpts:\n\n${contextBlock}` },
    ],
    { response_format: { type: "json_object" }, max_tokens: 3000 }
  );
  return parseModelJson(completion.choices[0].message.content);
}

async function draftWithFallback(question, contextBlock) {
  const groqClient = getGroqClient();
  const geminiClient = getGeminiClient();

  // Try Groq primary model
  if (groqClient) {
    try {
      const result = await draftWithModel(groqClient, DRAFT_MODEL, question, contextBlock);
      return { result, model: DRAFT_MODEL, provider: "groq" };
    } catch (err) {
      const isRateLimited = err.status === 429 || err.status === 413;
      if (isRateLimited) {
        console.warn(`[/api/chat] Groq ${DRAFT_MODEL} rate-limited, trying fallback...`);

        // Try Groq fallback model
        if (DRAFT_MODEL_FALLBACK && DRAFT_MODEL_FALLBACK !== DRAFT_MODEL) {
          try {
            const result = await draftWithModel(groqClient, DRAFT_MODEL_FALLBACK, question, contextBlock);
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
      const result = await draftWithModel(geminiClient, GEMINI_DRAFT_MODEL, question, contextBlock);
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

  // Step 4: Draft with fallback chain
  let draftResult;
  try {
    draftResult = await draftWithFallback(question, contextBlock);
  } catch (err) {
    console.error("[/api/chat] drafting failed:", err.status || "", err.message);
    return res.status(502).json({
      error: "drafting_failed",
      message: "The drafting model failed to respond. " + (err.message || ""),
    });
  }

  res.json({
    classification,
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
