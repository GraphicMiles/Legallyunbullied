/**
 * POST /api/chat — the real Phase 1 pipeline.
 *
 * 1. Groq classifies the question (practice area, jurisdiction, urgency).
 * 2. Firestore returns ingested statute provisions matching that category.
 * 3. If nothing's been ingested for that category yet, say so plainly
 *    instead of letting the model invent an answer with no grounding.
 * 4. Groq drafts the final answer, instructed to cite only the supplied
 *    excerpts — never to introduce acts/sections that weren't given to it.
 */

const express = require("express");
const router = express.Router();
const { getClient, CLASSIFY_MODEL, DRAFT_MODEL, DRAFT_MODEL_FALLBACK } = require("./groq");
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

const CLASSIFY_SYSTEM_PROMPT = `You classify Nigerian legal questions for an information retrieval system that only has a specific, limited set of statutes actually loaded — not general legal knowledge.

Respond with ONLY a JSON object, no prose, no markdown code fences.

Valid values for "practice_area": ${JSON.stringify(PRACTICE_AREAS)}
${PRACTICE_AREA_BULLETS}

Pick exactly one practice_area — the single best-fitting category. Prefer "general" over force-fitting a loose match.

Valid values for "urgency": ["Low", "Medium", "High", "Critical"]

"keywords": 3-6 specific legal/factual terms likely to appear verbatim in the relevant statute text (e.g. procedural terms, timeframes, named concepts) — used to narrow down a large Act to the sections that actually matter for this question. Not generic words.

Example of the exact shape to return (use realistic values for the actual question, don't copy this example's content):
{"practice_area": "tenancy", "jurisdiction": "Lagos State", "urgency": "High", "summary": "A tenant is disputing an eviction attempt made without proper notice.", "keywords": ["notice", "quit", "possession", "monthly tenant"]}`;

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

async function draftWithModel(client, model, question, contextBlock) {
  const completion = await client.chat.completions.create({
    model,
    temperature: 0.2,
    max_tokens: 900,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: DRAFT_SYSTEM_PROMPT },
      { role: "user", content: `Question: ${question}\n\nAvailable statute excerpts:\n\n${contextBlock}` },
    ],
  });
  return parseModelJson(completion.choices[0].message.content);
}

router.post("/api/chat", async (req, res) => {
  const question = (req.body && req.body.question || "").toString().trim();
  if (!question) {
    return res.status(400).json({ error: "bad_request", message: '"question" is required.' });
  }

  const client = getClient();
  if (!client) {
    return res.status(503).json({
      error: "not_configured",
      message: "GROQ_API_KEY is not set on the server yet.",
    });
  }

  let classification;
  try {
    const classifyCompletion = await client.chat.completions.create({
      model: CLASSIFY_MODEL,
      temperature: 0,
      max_tokens: 400,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: CLASSIFY_SYSTEM_PROMPT },
        { role: "user", content: question },
      ],
    });
    classification = parseModelJson(classifyCompletion.choices[0].message.content);
  } catch (err) {
    console.error("[/api/chat] classification failed:", err.status || "", err.message);
    return res.status(502).json({
      error: "classification_failed",
      message: "The classification model failed to respond. " + (err.message || ""),
    });
  }

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

  let result;
  let draftModelUsed = DRAFT_MODEL;
  try {
    result = await draftWithModel(client, DRAFT_MODEL, question, contextBlock);
  } catch (err) {
    const isRateLimited = err.status === 429;
    if (isRateLimited && DRAFT_MODEL_FALLBACK && DRAFT_MODEL_FALLBACK !== DRAFT_MODEL) {
      console.warn(`[/api/chat] ${DRAFT_MODEL} rate-limited, retrying with fallback ${DRAFT_MODEL_FALLBACK}`);
      try {
        result = await draftWithModel(client, DRAFT_MODEL_FALLBACK, question, contextBlock);
        draftModelUsed = DRAFT_MODEL_FALLBACK;
      } catch (fallbackErr) {
        console.error("[/api/chat] fallback drafting also failed:", fallbackErr.status || "", fallbackErr.message);
        return res.status(502).json({
          error: "drafting_failed",
          message: "The drafting model failed to respond, and the fallback model did too. " + (fallbackErr.message || ""),
        });
      }
    } else {
      console.error("[/api/chat] drafting failed:", err.status || "", err.message);
      return res.status(502).json({
        error: "drafting_failed",
        message: "The drafting model failed to respond. " + (err.message || ""),
      });
    }
  }

  res.json({ classification, result, draftModel: draftModelUsed });
});

module.exports = router;
