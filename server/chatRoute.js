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
const { getClient, CLASSIFY_MODEL, DRAFT_MODEL } = require("./groq");
const { findProvisions } = require("./legalCorpus");

const PRACTICE_AREAS = ["tenancy", "employment", "criminal_rights", "contract", "general"];

/**
 * Some models occasionally wrap JSON-mode output in markdown code fences
 * even when told not to. Strip those before parsing rather than failing outright.
 */
function parseModelJson(content) {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  return JSON.parse(trimmed);
}

const CLASSIFY_SYSTEM_PROMPT = `You classify Nigerian legal questions for an information retrieval system.
Respond with ONLY a JSON object, no prose, no markdown code fences.

Valid values for "practice_area": ${JSON.stringify(PRACTICE_AREAS)}
Valid values for "urgency": ["Low", "Medium", "High", "Critical"]

Example of the exact shape to return (use realistic values for the actual question, don't copy this example's content):
{"practice_area": "tenancy", "jurisdiction": "Lagos State", "urgency": "High", "summary": "A tenant is disputing an eviction attempt made without proper notice."}`;

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
      max_tokens: 300,
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

  const contextBlock = provisions
    .map((p) => `[${p.act}${p.section ? ", s." + p.section : ""}]\n${p.text}`)
    .join("\n\n---\n\n");

  let result;
  try {
    const draftCompletion = await client.chat.completions.create({
      model: DRAFT_MODEL,
      temperature: 0.2,
      max_tokens: 2000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: DRAFT_SYSTEM_PROMPT },
        { role: "user", content: `Question: ${question}\n\nAvailable statute excerpts:\n\n${contextBlock}` },
      ],
    });
    result = parseModelJson(draftCompletion.choices[0].message.content);
  } catch (err) {
    console.error("[/api/chat] drafting failed:", err.status || "", err.message);
    return res.status(502).json({
      error: "drafting_failed",
      message: "The drafting model failed to respond. " + (err.message || ""),
    });
  }

  res.json({ classification, result });
});

module.exports = router;
