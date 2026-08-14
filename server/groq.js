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

const CLASSIFY_MODEL = process.env.GROQ_MODEL_CLASSIFY || "llama-3.1-8b-instant";
const DRAFT_MODEL = process.env.GROQ_MODEL_DRAFT || "llama-3.3-70b-versatile";

module.exports = { getClient, CLASSIFY_MODEL, DRAFT_MODEL };
