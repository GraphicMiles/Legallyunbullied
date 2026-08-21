# Legally Unbullied — Bug Audit (agent pipeline + response path focus)

**Scope:** `server/chatRoute.js`, `server/evidence.js`, `server/legalCorpus.js`, `server/jobRunner.js`, `server/legalIntent.js`, `server.js`, `server/conversationRoute.js`, provider clients, `public/app.js` + components, security rules, config.
**Method:** full read-through of the pipeline, plus `npm install && npm test` (all 11 deterministic suites **pass** — every bug below lives in a path the mocked tests don't cover), plus targeted runtime reproductions where noted.

## Fix status (applied in the follow-up commit)

**Fixed:** H1 (prompt restored + JSON mode), H2 (`trust proxy 1`), H3 (3-attempt busy-retry cap), H4 (AbortController + timer cleanup), M1 (procedural cooldown discipline), M2 (lettered sections + subsection granularity), M3 (hedge list tightened, server + client), M4 (24h TTL cleanup of terminal `background_jobs`), M5 (`/api/cache-stats` auth), M6 (procedural regex covers "what should I bring to the station"), M7 (cache deep-clone on read/write), M8 (all four providers probed), L1, L2 (all URLs stripped), L3 (textContent rendering), L5 (citationVerification replayed from cache), L6 (ellipsis-safe cleanup).

**New regression tests added:** prompt-integrity + "what should I bring" procedural (`test-procedural-hedging.js`); lettered-section, subsection-granularity, wrong-section citation checks (`test-retrieval-evidence.js`); terminal-job TTL cleanup (`test-job-queue.js`). Full suite: **11/11 files pass**.

**Deliberately not changed (documented decisions, not oversights):** L4 (loose `*.onrender.com`/`*.web.app` CORS is required for Render/Firebase preview deploys), L7 (casual/corpusEmpty terminals re-running on duplicate submit is harmless and covered by the in-flight dedup), L8 (insertion-order eviction is fine at 200 entries), L9 (title-only search is a Firestore limitation, documented at the endpoint).

---

## 🔴 HIGH — user-visible or operational breakage

### H1. `PROCEDURAL_SYSTEM_PROMPT` is corrupted (server/chatRoute.js:934–951)
The prompt's JSON example was mangled by a bad edit. What the model actually receives:

```
Respond with ONLY a JSON object (no prose, no markdown fences):ge guidance for this practical task (2-4 sentences).",
  "actionsMd": "- Step 1: ...
```

The opening `{` and the whole `"lawMd": "Your direct, practica…` head of the example are gone (verified at runtime — the fragment does not parse as JSON). Intended text was clearly:

```
Respond with ONLY a JSON object (no prose, no markdown fences):
{
  "lawMd": "Your direct, practical guidance for this task (2-4 sentences).",
  ...
```

**Compounding it:** `answerProceduralWithFallback` (chatRoute.js:968–976) is the **only JSON-expecting LLM call that doesn't pass `response_format: { type: "json_object" }`**, so the broken few-shot example is the model's only guide.

**Impact:** procedural follow-ups ("how do I contact the police", "how do I find a lawyer") frequently fail JSON parsing → all providers fail → the static fallback is served. That fallback (chatRoute.js:1312–1336) is hardcoded **note-taking advice** ("write things down while they're fresh…") — i.e. a user asking how to find a lawyer gets told how to take notes. `test-procedural-hedging.js` never catches this because its mock ignores prompt contents.

**Fix:** restore the example, add `response_format: { type: "json_object" }`, and add an assertion in the test that the prompt contains a parseable JSON example.

### H2. No `trust proxy` → rate limits are GLOBAL behind Render (server.js)
`express-rate-limit` keys on `req.ip`, but the app never calls `app.set('trust proxy', 1)`. On Render every request arrives via the platform load balancer, so `req.ip` is the proxy's IP for **all users**. The 20 req/min `/api/chat` limit and 60 req/min general limit become one shared global bucket — a single heavy user (or the client's own auto-retry, see H3) 429s every user on the service. express-rate-limit 8.6.2 detects and logs this misconfiguration but doesn't fix it.

**Fix:** `app.set("trust proxy", 1);` before the limiter middleware (Render terminates TLS at one proxy hop).

### H3. `providersBusy` auto-retry has no attempt cap (public/app.js:2860–2904)
When all LLM providers are busy, the client schedules a retry in `retryAfter` seconds; a still-busy response schedules another, forever. There is no max-attempt counter and nothing cancels it except a user action (send/switch chat).

**Impact:** if provider quota is exhausted for the day, every open tab retries every ~30s indefinitely — burning the (already global per H2) rate budget, stacking busy cards, and generating duplicate pipeline runs server-side (job docs, persistence writes).

**Fix:** cap at ~3 attempts with a visible "try again later" terminal state.

### H4. `withTimeout` doesn't abort the underlying request (server/chatRoute.js:569–578)
`Promise.race` rejects at 8–20s, but the OpenAI SDK request keeps running (SDK default timeout = **10 minutes**) with no `AbortController`. During a provider outage every attempt leaves a hung socket/HTTP call alive behind it; with 4 providers × classify/relevance/draft/critique per request this compounds under load. Also, unlike `legalCorpus.js`'s version, this one never clears its `setTimeout`.

**Fix:** create `const controller = new AbortController()`, pass `signal` to `client.chat.completions.create(...)` (SDK supports it), abort + clear timer on race loss.

---

## 🟠 MEDIUM — correctness/consistency defects

### M1. `answerProceduralWithFallback` bypasses the cooldown/circuit system (chatRoute.js:955–987)
Every other fallback chain checks `isProviderOnCooldown()` and calls `markProviderFailure()`; this one does neither. A rate-limited Groq is retried on every procedural question, and failures never open a cooldown — inconsistent with the provider-failover design and worsens H2/H3 quota burn.

### M2. Inline-citation checker generates false positives (server/evidence.js `findUnverifiedInlineCitations`)
`sectionPattern` = `\d+(...)*` can't capture lettered sections: draft says **"section 25A"** → captured candidate `25`, corpus section normalizes to `25 a` → no match → `citation_integrity_failed`. Consequence chain: critique forced fail → `escalate=true` + "citations could not be verified" banner on an answer that was actually correct, and the result is barred from caching. Lettered/subsectioned numbering (`25A`, `36(1)(a)(ii)` edge combos) is common in Nigerian statutes. Fail-closed is the right default, but the regex should at least handle the `§\d+[A-Z]` suffix form it itself allows the drafter to quote.

### M3. Hedge-detection phrases over-trigger (chatRoute.js `HEDGE_PATTERNS`, mirrored client-side)
"primarily deals with", "only defines", "based on the provided excerpts" are normal descriptive phrases in legitimately grounded answers ("The Land Use Act primarily deals with…"). A single occurrence flips `evidence.sufficient=false` and the client label to "Limited evidence" with forced escalation. The high-precision intent documented in the comment isn't met by these three entries.

### M4. `background_jobs` (and stale `safety_acks`) are never deleted (server/jobRunner.js)
One job doc — containing the user's question **and full history** — is written per chat message and never purged after reaching a terminal state. `safety_acks` are only lazily deleted on read. Unbounded growth, cost, and PII retention with no TTL/cleanup sweep.

### M5. `/api/cache-stats` is unauthenticated (server.js:170)
The invalidate endpoint was (correctly) locked behind auth as a "bug fix", but stats remained open — it leaks hit rates, corpus cache size, raw-category read counters, and whether the Firestore circuit breaker is currently open (operational recon for free).

### M6. `isClearlyProceduralQuestion` regex too narrow (chatRoute.js:1119–1122)
"What should I bring to the station?" doesn't match (`what (documents|papers|evidence) should i bring` requires the noun) while the classifier's own prompt gives exactly that phrase as a `needs_sourcing:false` example. Result: the deterministic guard flips `needs_sourcing` back to true → full citation pipeline → usually the "insufficient evidence" dead-end for a pure how-to question. The regex and the classifier prompt disagree on the same example.

### M7. Question-cache object aliasing mutates cached entries (chatRoute.js cache HIT path, demonstrated at runtime)
On a cache hit, `draftResult` is a **live reference** to the cached object. The subsequent `draftResult.result.evidence = evidence` overwrite and `applyDeterministicSafetyPolicy` mutations permanently alter what's stored in `questionCache`. A later hit for the same question then serves run A's answer+crtitique labeled with run B's (possibly "insufficient") evidence — an internally inconsistent snapshot. Harmless-looking today, but it's a correctness landmine.

**Fix:** store a deep clone (`structuredClone`) on `setCachedResult`, or clone on read.

### M8. `/healthz` only probes Groq + Gemini (server/providerHealth.js)
Cerebras and OpenRouter are never probed. A deployment running only Cerebras reports `status: "degraded"` forever while working fine (still HTTP 200, so Render won't flap — just misleading ops signal).

---

## 🟡 LOW — hardening / polish

| # | Where | Issue |
|---|---|---|
| L1 | public/app.js:798–800 | Abort fires at **180s** but the error says "timed out after **60 seconds**". |
| L2 | chatRoute.js `sanitizeDraftResult` | Only placeholder domains (`example.com`…) are stripped; a hallucinated real-looking URL (`fake-portal.lagosstate.gov.ng`) passes through to users in a legal product. Consider stripping all URLs server-side (the draft prompt already forbids them). |
| L3 | public/app.js `renderProvidersBusy`/`buildProvidersBusyStatic` | `steps.innerHTML = actionsMd.replace(...)` — unescaped innerHTML. Safe today only because the content is server-generated static text; one refactor away from an XSS sink. Use `textContent` or escape. |
| L4 | server.js CORS | `ORIGIN_REGEX` accepts **any** `*.onrender.com` / `*.web.app` origin — any other Render/Firebase-hosted app is an allowed origin. Low risk (tokens are per-user), but looser than the "explicit allowlist" comment implies. |
| L5 | chatRoute.js cache-hit path | Replayed responses omit `evidence.citationVerification` (was validated when cached, absent when replayed) — inconsistent API shape for consumers. |
| L6 | `stripPlaceholderUrls` | `.replace(/\.\.+/g, ".")` mangles legitimate ellipses inside quoted statutory text ("…shall be…" → "."). |
| L7 | idempotency (`loadPersistedTerminal`) | Only replays `status:"done"`; casual/corpusEmpty terminals re-run the full classification on duplicate submits (client in-flight dedup mostly hides this). |
| L8 | `getCacheKey` eviction | Oldest-insertion eviction, not LRU — fine at 200 entries, just noting. |
| L9 | conversationRoute search | Server-side search matches **titles only** (documented as a Firestore limitation) — the UI's "Search chats" never finds message content. |

---

## ✅ What's solid (worth knowing)

- **All 11 deterministic test suites pass** (`npm test`), including fail-closed guardrails (relevance-gate unavailable → withheld answer; malformed draft → providersBusy, never a legal answer; invented supporting quotes → uncertain + escalate).
- Citation-token design (`[[provisionId]]` → server-resolved labels, model never controls public sources) is genuinely robust; unknown IDs are stripped and fail the verification.
- Client markdown renderer escapes HTML **before** applying formatting — no XSS from model output in answers.
- Safety-ack flow: tokens are 24-byte random, ownership-checked (uid match), Firestore-durable across restarts, and never globally cached.
- `firestore.rules` catch-all deny + Admin-SDK-only internal collections is correctly set up.

---

## Suggested fix order

1. **H1** (one-line prompt restore + `response_format`) — biggest user-visible response-quality win.
2. **H2** (`trust proxy`) — one line; prevents whole-service 429 storms.
3. **H3** (retry cap) — small client patch.
4. **H4** (AbortController) — medium; protects under load.
5. **M1–M3** — pipeline consistency + false-positive rate of the safety layer.
6. **M4–M8** and lows as follow-ups.
