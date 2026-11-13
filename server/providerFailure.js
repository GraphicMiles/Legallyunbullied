/**
 * Provider failure bookkeeping: classify an error, and decide how long a
 * provider is skipped afterwards. Extracted from chatRoute.js so it can be tested.
 *
 * A malformed reply from a model is NOT an outage: the model answered, just
 * badly. Those do not put the provider on cooldown, so one bad reply does not
 * take the provider away from every user.
 */
const providerCooldowns = new Map(); // providerKey -> cooldownUntil (timestamp)

function isProviderOnCooldown(key) {
  const until = providerCooldowns.get(key);
  if (!until) return false;
  if (Date.now() >= until) {
    providerCooldowns.delete(key);
    return false;
  }
  return true;
}

function classifyProviderError(err) {
  const status = Number(err?.status || err?.code || 0);
  const message = String(err?.message || "").toLowerCase();
  if (status === 404 || message.includes("does not exist") || message.includes("model_not_found")) return "model_not_found";
  if (status === 401 || status === 403) return "authentication_failed";
  if (status === 429 || status === 413 || message.includes("rate limit") || message.includes("rate-limited")) return "rate_limited";
  if (message.includes("timed out") || message.includes("timeout")) return "timeout";
  if (message.includes("failed to parse json") || message.includes("invalid schema")) return "malformed_output";
  return "provider_unavailable";
}

function markProviderFailure(key, err) {
  const kind = classifyProviderError(err);
  if (kind === "malformed_output") {
    console.warn(`[/api/chat] Provider "${key}" returned a malformed reply; not cooling it down`);
    return kind;
  }
  const cooldownMs = kind === "model_not_found" || kind === "authentication_failed"
    ? 30 * 60 * 1000
    : kind === "rate_limited" ? 60 * 1000
      : kind === "timeout" ? 30 * 1000
        : 15 * 1000;
  providerCooldowns.set(key, Date.now() + cooldownMs);
  console.warn(`[/api/chat] Provider "${key}" ${kind}; cooldown ${Math.round(cooldownMs / 1000)}s`);
  return kind;
}

module.exports = { isProviderOnCooldown, classifyProviderError, markProviderFailure, providerCooldowns };
