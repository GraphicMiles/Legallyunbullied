/**
 * Groq client used for classification + answer drafting — OpenAI-SDK
 * compatible, just a different base URL and model lineup (Groq hosts
 * open-weight models like Llama on very fast inference hardware).
 * Requires GROQ_API_KEY. Model IDs are configurable via env vars since
 * the lineup changes over time — see https://console.groq.com/docs/models
 * for the current list.
 */

const OpenAI = require("openai");

let client = null;

function getClient() {
  if (client) return client;
  if (!process.env.GROQ_API_KEY) {
    console.warn("[groq] GROQ_API_KEY is not set — Groq calls are disabled.");
    return null;
  }
  client = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: "https://api.groq.com/openai/v1",
  });
  return client;
}

const CLASSIFY_MODEL = process.env.GROQ_MODEL_CLASSIFY || "openai/gpt-oss-20b";
const DRAFT_MODEL = process.env.GROQ_MODEL_DRAFT || "openai/gpt-oss-20b";
const REVIEW_MODEL = process.env.GROQ_MODEL_REVIEW || "openai/gpt-oss-120b";
// Groq's rate limits are per-model. If the primary drafting model is
// exhausted for the day, falling back to a different (smaller, separately
// metered) model still gets the user a real answer instead of an error —
// worse quality is better than no answer. Same idea could extend to a
// second fallback if this one also gets exhausted.
const DRAFT_MODEL_FALLBACK = process.env.GROQ_MODEL_DRAFT_FALLBACK || "openai/gpt-oss-120b";

module.exports = { getClient, CLASSIFY_MODEL, REVIEW_MODEL, DRAFT_MODEL, DRAFT_MODEL_FALLBACK };
