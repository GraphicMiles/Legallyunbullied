# Agent Pipeline Audit — De-seeding & Conversational Follow-ups

**Purpose.** Record exactly how every stage of `/api/chat` works, which stages
are model-driven, which deterministic checks remain (as validation/fail-closed
backstops only), and what this de-seeding refactor changed. The operating
rules:

1. **No seeded/template answer text as a primary path.** Every message the
   user reads — legal answers, procedural how-tos, limited-coverage answers,
   follow-up suggestions — is written by a model at request time.
2. **Intent matching is dynamic (model-driven), never keyword/regex.**
3. **Deterministic regex** appears only as *validation* or a *fail-closed
   backstop* when every provider is down.
4. **Every answer is conversational** — follow-up questions carry the full
   conversation context and every terminal state offers next-step suggestions.

---

## 1. Stage-by-stage map

```
POST /api/chat
│
├─ A. Input validation                      deterministic schema check
├─ B. detectLegalIntent (regex)             BACKSTOP — builds the fallback
│                                            classification only when every
│                                            classifier provider is down
├─ C. classifyWithFallback                  MODEL — 4-classifier provider
│    (Gemini→Groq→OpenRouter→Cerebras)       chain; emits is_legal_question,
│                                            practice_area, urgency, keywords,
│                                            key_issues, potential_remedies,
│                                            needs_sourcing, route
│    • greetings now go THROUGH the model    (the regex fast-path was removed;
│      CASUAL_GREETING_PATTERN/CASUAL_REPLIES survive only as the all-
│      providers-down backstop)
│
├─ D. Context inheritance                   deterministic copy from prior
│    (practice_area / jurisdiction)          turn when the model marks the
│                                            follow-up ambiguous — not a router
│
├─ E. Routing                               MODEL — needs_sourcing flag
│
├─ F. needs_sourcing === false              MODEL — procedural LLM chain
│    (procedural/admin how-to)               (answerProceduralWithFallback →
│                                             PROCEDURAL_SYSTEM_PROMPT).
│    • **On total provider failure the
│      response is now the honest providers-
│      busy retry surface** — the five seeded
│      static cards (CAC, passport, lawyer,
│      police, generic note-taking) were
│      deleted from makeProceduralFallback.
│
├─ G. Retrieval (findProvisions)            LEXICAL INDEX over Firestore
│    • rankProvisions scores on the model-   `legal_provisions`; MAY=14 rows
│      emitted keywords (never user-text     are ranked on model keywords,
│      regexes)                              jurisdiction, provenance badges
│    • PHRASE_LOW: multi-word model phrases
│      earn partial token credit so recall
│      improves before semantic judging
│    • findProvisionsBroad re-searches
│      adjacent areas (employment↔contract
│      etc.) when the gate says insufficient
│
├─ H. assessRelevanceWithFallback           MODEL — the semantic relevance
│    (LLM judge, MIN_SOURCES per risk tier)  judge; gates provisions into
│                                            sufficient / insufficient
├─ I. High-impact plan (complex routes)     MODEL
├─ J. draftWithFallback → validDraft        MODEL — DRAFT_SYSTEM_PROMPT writes
│    Result (lawMd/actionsMd/provisionIds/   in the user's personal-adviser
│    claims/escalate/followUps)              voice; follow-ups REQUIRED (≥2)
│    • applyDeterministicSafetyPolicy        BACKSTOP — urgent+harm prepend of
│      (regex harm detection)                a physical-safety step if the
│                                            model forgot it; purely additive
├─ K. verifyAndResolveCitations             BACKSTOP — evidence.js resolves
│                                            [[provisionId]] tokens to
│                                            authoritative labels, rejects
│                                            invented citations
├─ L. Critique loop (quality/safety)        MODEL
└─ M. Terminal branches
     • evidence insufficient →
       **NEW: LIMITED_COVERAGE_SYSTEM_PROMPT**
       model-written, personalized, uncited,
       always escalating, follow-ups always
       present (hardened rails in code strip
       sources/provisionIds/claims and force
       escalate=true no matter what the model
       returned; applyDeterministicSafety-
       Policy runs on top).
       Static makeInsufficientEvidenceResult
       copy remains, but ONLY as the fail-
       closed backstop when every provider
       is down — it is never a primary path.
     • corpus empty (procedural Q) →
       procedural rescue (model-written) or
       honest providers-busy on failure
     • providers busy → honest retry surface
```

## 2. Citation indexing & citation calling

- **Indexing**: `legal_provisions` documents are fetched and cached per
  practice-area (raw category cache, 1h TTL, quota-safe circuit breaker).
  Pre-LLM ranking is lexical over the *model-emitted* classifier keywords —
  the user message is never regex-scanned to pick provisions.
- **Semantic gate**: an LLM relevance judge scores the shortlist and only
  sufficient, conflict-free, two-source (high-risk) sets reach drafting.
- **Calling**: the draft model cites ONLY `[[provisionId]]` tokens;
  `verifyAndResolveCitations` authoritatively re-labels them and flags any
  invented Act/section. Citations never come from code templates.

## 3. What changed in this refactor

| Before | After |
|---|---|
| 5 seeded static answer cards (`makeProceduralFallback`) served on provider failure | Deleted; provider failure surfaces the honest "providers busy — retry" state |
| Insufficient-evidence answer was a static template (danger/livelihood/standard trio) | Model-written limited-coverage answer, personalized to the user's facts, uncited, always escalating, always with follow-ups; static copy demoted to fail-closed backstop |
| Greeting fast-path (regex → canned `CASUAL_REPLIES`) | Removed as primary path; greetings go through the classifier model, which writes the casual reply |
| Static answers often shipped `followUps: []` (dead-end) | Every limited-coverage/backstop answer gets follow-ups, model-written or derived from the classifier's own key_issues/potential_remedies |
| Multi-word model keywords matched provisions only verbatim | Partial token credit in `rankProvisions` lifts recall before the semantic judge |
| Draft prompt: generic assistant voice | Prompt now directs a personal-adviser voice: acknowledges the user's exact situation first, addresses them as "you" with their facts |
| Limited-coverage answers skipped the safety policy | `applyDeterministicSafetyPolicy` runs over limited-coverage results, so urgent violence always gets a physical-safety first step repaired in if the model omits it |

## 4. Standing deterministic surfaces (all backstops, not routers)

- `isClearlyProceduralQuestion` / `isAdministrativeHowto` — only trigger the
  procedural rescue when the evidence pipeline is already failing; never pick
  content.
- `isPersonalHarmContext`, `detectLegalIntent`, lockout/self-help checks —
  validation layers inside `applyDeterministicSafetyPolicy` and the
  fail-closed fallback classification.
- `CASUAL_GREETING_PATTERN` — all-providers-down greeting backstop.
- `makeInsufficientEvidenceResult` static copy — all-providers-down
  fail-closed backstop.
- Citation verification math in `server/evidence.js` — integrity check on
  model output, not intent matching.

## 5. Debug observability (debug panel)

An in-app debug panel (`public/debug-panel.js`, loaded before `app.js` in
`index.html`) makes every client-visible event inspectable without leaving
the app. Toggle with the bug FAB (bottom-right, above the composer) or
`Ctrl/Cmd+Shift+D`.

**What it captures automatically** (no code changes needed in callers):

- every `console.log/warn/error/info` (with args serialized + redacted),
- every `window.fetch` call: method, URL, status, latency, error body,
- uncaught errors (`window.error`) and unhandled promise rejections,
- persists across reloads for the tab session (sessionStorage, last 200),
- secret redaction is mandatory-in-code: bearer tokens, `api_key`/`token`
  fields, query-string keys, and GitHub PAT-shaped strings never persist.

**Structured chat-pipeline events** come from `window.LUDebug`:

- `app.js` emits `chat.send` (question/history size, IDs),
  `chat.response` (route, practice area, urgency, evidence stats, critique
  scores, per-stage `timings` map, providersBusy/retryAfter,
  limitedCoverage/escalate/followUp counts), `chat.providersBusy`
  (retry attempt bookkeeping), `chat.timeout` / `chat.error`,
  and `auth.user` (sign-in/out changes).
- Any other script can call `LUDebug.log(level, source, message, extra)`,
  `LUDebug.chatEvent(name, data)`, or `LUDebug.chatError(name, data)`.

**Server-side tracing**: `server/debugLog.js` is a redacted in-memory ring
buffer of the last 500 `console.*` lines, attached at boot in `server.js`
and exposed at `GET /api/debug/server-logs` behind `requireAuth +
requireAdmin` (same posture as `/api/cache-stats` — log lines reveal
provider state). The panel's **Server** button pulls that trace into the
chat timeline so a bug report can carry both client and server context.

UI: filters (All / Errors / Warn / Push-net / Chat), error-count badge on
the FAB, copy/clear buttons, and a mobile layout that stays clear of the
composer.

### Tests (this area + the de-seeding refactor)

- `test-v2-guardrails.js` — the conflicting-evidence tests now exercise the
  limited-coverage LLM path: assert `limitedCoverage: true`, sources/
  provisionIds/claims forcibly emptied, follow-ups present, livelihood
  framing for wage claims, and the safety-policy repair when a violent
  urgent question comes back from the model *without* a safety step.
- `test-procedural-hedging.js` — prompt-integrity check retargeted after the
  procedural chain was generalized into `answerWithProviderFallback`.
- All 11 deterministic suites + 21 browser suites pass.
