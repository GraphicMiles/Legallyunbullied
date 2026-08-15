/**
 * Cerebras client - Ultra-fast LLM inference on WSE chips
 * OpenAI-compatible endpoint, no credit card required
 * 
 * Sign up: https://cloud.cerebras.ai/
 * Rate limit: 1M tokens/day, 14,400 RPD
 * Docs: https://inference-docs.cerebras.ai/introduction
 */

const OpenAI = require("openai");

let client = null;

function getClient() {
  if (client) return client;
  if (!process.env.CEREBRAS_API_KEY) {
    console.warn("[cerebras] CEREBRAS_API_KEY is not set — Cerebras calls are disabled.");
    return null;
  }
  client = new OpenAI({
    apiKey: process.env.CEREBRAS_API_KEY,
    baseURL: "https://api.cerebras.ai/v1",
  });
  return client;
}

// Models available on Cerebras (free tier)
const CEREBRAS_CLASSIFY_MODEL = process.env.CEREBRAS_MODEL_CLASSIFY || "llama3.1-8b";
const CEREBRAS_DRAFT_MODEL = process.env.CEREBRAS_MODEL_DRAFT || "llama3.1-70b";
const CEREBRAS_CHAT_MODEL = process.env.CEREBRAS_MODEL_CHAT || "llama3.1-8b";

module.exports = {
  getClient,
  CEREBRAS_CLASSIFY_MODEL,
  CEREBRAS_DRAFT_MODEL,
  CEREBRAS_CHAT_MODEL,
};
