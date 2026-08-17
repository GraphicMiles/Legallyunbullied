const { getClient: getGroqClient, CLASSIFY_MODEL, REVIEW_MODEL, DRAFT_MODEL, DRAFT_MODEL_FALLBACK } = require("./groq");
const { getClient: getGeminiClient, GEMINI_CLASSIFY_MODEL, GEMINI_DRAFT_MODEL } = require("./gemini");

const state = {
  checkedAt: null,
  checking: false,
  providers: {
    groq: { configured: !!process.env.GROQ_API_KEY, status: "unknown", models: {} },
    gemini: { configured: !!process.env.GEMINI_API_KEY, status: "unknown", models: {} },
  },
};

function timeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`health check timed out after ${ms}ms`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

function safeError(err) {
  const status = err?.status || err?.code || null;
  if (status === 401 || status === 403) return { code: "authentication_failed" };
  if (status === 429) return { code: "rate_limited" };
  if (status === 404) return { code: "endpoint_or_model_not_found" };
  if (/timed out/i.test(err?.message || "")) return { code: "timeout" };
  return { code: "unavailable" };
}

async function probe(name, client, requiredModels) {
  const provider = state.providers[name];
  provider.configured = !!client;
  if (!client) {
    provider.status = "not_configured";
    provider.models = {};
    return;
  }
  try {
    const page = await timeout(client.models.list(), 8000);
    const rows = page?.data || page?.body?.data || [];
    const ids = new Set(rows.map((m) => String(m.id || m.name || "").replace(/^models\//, "")));
    provider.models = Object.fromEntries(requiredModels.map((id) => [id, ids.has(id)]));
    provider.status = requiredModels.every((id) => ids.has(id)) ? "healthy" : "model_mismatch";
    provider.error = null;
  } catch (err) {
    provider.status = "unavailable";
    provider.models = Object.fromEntries(requiredModels.map((id) => [id, null]));
    provider.error = safeError(err);
  }
}

async function probeProviders() {
  if (state.checking) return state;
  state.checking = true;
  try {
    await Promise.all([
      probe("groq", getGroqClient(), [CLASSIFY_MODEL, REVIEW_MODEL, DRAFT_MODEL, DRAFT_MODEL_FALLBACK]),
      probe("gemini", getGeminiClient(), [GEMINI_CLASSIFY_MODEL, GEMINI_DRAFT_MODEL]),
    ]);
    state.checkedAt = Date.now();
  } finally {
    state.checking = false;
  }
  return state;
}

function getProviderHealth() {
  return JSON.parse(JSON.stringify(state));
}

module.exports = { probeProviders, getProviderHealth };
