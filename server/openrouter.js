/**
 * OpenRouter client - Free LLM API with 35+ models
 * OpenAI-compatible endpoint, no credit card required
 * 
 * Sign up: https://openrouter.ai/keys
 * Rate limit: 200 RPD (free tier)
 * Docs: https://openrouter.ai/docs
 */

const OpenAI = require("openai");

let client = null;

// Retired OpenRouter ":free" IDs. Calling them costs 8–20s of timeout on
// every classify/draft fallback. Override OPENROUTER_MODEL_* to re-enable.
const RETIRED_FREE_MODELS = new Set([
  "meta-llama/llama-3.1-8b-instruct:free",
  "meta-llama/llama-3.1-70b-instruct:free",
]);

function getClient() {
  if (client) return client;
  if (!process.env.OPENROUTER_API_KEY) {
    console.warn("[openrouter] OPENROUTER_API_KEY is not set — OpenRouter calls are disabled.");
    return null;
  }
  const classify = process.env.OPENROUTER_MODEL_CLASSIFY || "meta-llama/llama-3.1-8b-instruct:free";
  const draft = process.env.OPENROUTER_MODEL_DRAFT || "meta-llama/llama-3.1-70b-instruct:free";
  if (RETIRED_FREE_MODELS.has(classify) && RETIRED_FREE_MODELS.has(draft)) {
    console.warn("[openrouter] Default free models are retired — set OPENROUTER_MODEL_CLASSIFY / OPENROUTER_MODEL_DRAFT or unset OPENROUTER_API_KEY.");
    return null;
  }
  client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": "https://legally-unbullied.onrender.com",
      "X-Title": "Legally Unbullied",
    },
  });
  return client;
}

// Free models available on OpenRouter (no credit card required)
const OPENROUTER_CLASSIFY_MODEL = process.env.OPENROUTER_MODEL_CLASSIFY || "meta-llama/llama-3.1-8b-instruct:free";
const OPENROUTER_DRAFT_MODEL = process.env.OPENROUTER_MODEL_DRAFT || "meta-llama/llama-3.1-70b-instruct:free";
const OPENROUTER_CHAT_MODEL = process.env.OPENROUTER_MODEL_CHAT || "meta-llama/llama-3.1-8b-instruct:free";

module.exports = {
  getClient,
  OPENROUTER_CLASSIFY_MODEL,
  OPENROUTER_DRAFT_MODEL,
  OPENROUTER_CHAT_MODEL,
};
