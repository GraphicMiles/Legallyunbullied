/**
 * Gemini fallback client — OpenAI-SDK compatible.
 *
 * When Groq rate-limits or fails, we fall through to Google Gemini via its
 * OpenAI-compatible endpoint. Same SDK, just a different base URL and model
 * lineup. Requires GEMINI_API_KEY (Google AI Studio key).
 *
 * Docs: https://ai.google.dev/gemini-api/docs/openai
 */

const OpenAI = require("openai");

let client = null;

function getClient() {
  if (client) return client;
  if (!process.env.GEMINI_API_KEY) {
    console.warn("[gemini] GEMINI_API_KEY is not set — Gemini fallback is disabled.");
    return null;
  }
  client = new OpenAI({
    apiKey: process.env.GEMINI_API_KEY,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
  });
  return client;
}

const GEMINI_CLASSIFY_MODEL = process.env.GEMINI_MODEL_CLASSIFY || "gemini-3.5-flash";
const GEMINI_DRAFT_MODEL = process.env.GEMINI_MODEL_DRAFT || "gemini-3.5-flash";
const GEMINI_CHAT_MODEL = process.env.GEMINI_MODEL_CHAT || "gemini-3.5-flash";

module.exports = {
  getClient,
  GEMINI_CLASSIFY_MODEL,
  GEMINI_DRAFT_MODEL,
  GEMINI_CHAT_MODEL,
};
