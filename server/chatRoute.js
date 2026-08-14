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

const CLASSIFY_SYSTEM_PROMPT = `You classify Nigerian legal questions for an information retrieval system.
Respond with ONLY a JSON object, no prose, matching exactly:
{
  "practice_area": one of ${JSON.stringify(PRACTICE_AREAS)},
  "jurisdiction": string, e.g. "Lagos State" or "Federal",
  "urgency": one of ["Low", "Medium", "High", "Critical"],
  "summary": a one-sentence neutral restatement of the issue
}`;

const DRAFT_SYSTEM_PROMPT = `You are Legally Unbullied, a Nigerian legal-information assistant. You are not a lawyer and must not give legal advice — only plain-language information about what the law says and what someone can practically do next.

Hard rules:
- Only use the statute excerpts you are given below. Never cite an Act, section number, or fact that isn't present in them.
- If the excerpts don't fully answer the question, say so plainly in "lawMd" rather than filling the gap with assumptions.
- Cite the Act and section for every legal claim in "lawMd".

Respond with ONLY a JSON object, no prose, matching exactly:
{
  "lawMd": markdown string (use **bold** for defined terms/Act names, paragraphs separated by a blank line) explaining what the law says, with inline citations like "(Act name, s.N)",
  "actionsMd": markdown string of practical next steps, each line starting with "- ",
  "sources": [{ "label": "Act name, s.N", "excerpt": "the exact excerpt text you relied on" }],
  "escalate": boolean — true if this realistically needs a lawyer, not just self-help,
  "escalateReason": one or two sentences explaining the escalate decision
}`;

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
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: CLASSIFY_SYSTEM_PROMPT },
        { role: "user", content: question },
      ],
    });
    classification = JSON.parse(classifyCompletion.choices[0].message.content);
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
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: DRAFT_SYSTEM_PROMPT },
        { role: "user", content: `Question: ${question}\n\nAvailable statute excerpts:\n\n${contextBlock}` },
      ],
    });
    result = JSON.parse(draftCompletion.choices[0].message.content);
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
