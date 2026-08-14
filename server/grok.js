/**
 * xAI Grok client — OpenAI-SDK compatible, just a different base URL.
 * Requires XAI_API_KEY. See https://docs.x.ai for model IDs; kept
 * configurable via env vars since the model lineup changes frequently.
 */

const OpenAI = require("openai");

let client = null;

function getClient() {
  if (client) return client;
  if (!process.env.XAI_API_KEY) {
    console.warn("[grok] XAI_API_KEY is not set — Grok calls are disabled.");
    return null;
  }
  client = new OpenAI({
    apiKey: process.env.XAI_API_KEY,
    baseURL: "https://api.x.ai/v1",
  });
  return client;
}

const CLASSIFY_MODEL = process.env.GROK_MODEL_CLASSIFY || "grok-4-fast";
const DRAFT_MODEL = process.env.GROK_MODEL_DRAFT || "grok-4";

module.exports = { getClient, CLASSIFY_MODEL, DRAFT_MODEL };
