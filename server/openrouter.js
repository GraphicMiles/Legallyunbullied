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

function getClient() {
  if (client) return client;
  if (!process.env.OPENROUTER_API_KEY) {
    console.warn("[openrouter] OPENROUTER_API_KEY is not set — OpenRouter calls are disabled.");
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
