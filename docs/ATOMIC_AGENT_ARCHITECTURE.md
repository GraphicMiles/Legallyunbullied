# Architecture — Legally Unbullied Agent

> Last updated: 2026-08-16

## Overview

The agent is an **event-driven, critique-and-iterate pipeline** with server-side persistence. It has evolved past the original waterfall design into the atomic agent architecture described below.

```
User Question
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│                        API LAYER                                 │
│  Auth (Firebase ID token) → Rate limit → CORS → Body validation │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                    ┌───────────┴───────────┐
                    │                       │
              POST /api/chat         GET /api/chat/stream
              (REST, full response)  (SSE, event-by-event)
                    │                       │
                    └───────────┬───────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                     AGENT PIPELINE                               │
│                                                                  │
│  1. CLASSIFY ──→ practice_area, jurisdiction, urgency, route    │
│       │                                                        │
│       ├── casual? → return casual_reply (no pipeline)           │
│       ├── unclear jurisdiction? → return needsInput (HITL)      │
│       │                                                        │
│  2. SEARCH ────→ findProvisions(practiceArea, jurisdiction)     │
│       │         Firestore legal_provisions collection            │
│       │         ~8,200 sections across 545 Acts                 │
│       │                                                        │
│  3. PLAN ─────→ planResponse() (complex route only)             │
│       │         Decomposes question, maps provisions            │
│       │                                                        │
│  4. DRAFT ────→ draftWithFallback()                             │
│       │         Provider chain: Groq → Cerebras → Gemini        │
│       │         Falls back on rate limit / error                │
│       │                                                        │
│  5. CRITIQUE ─→ critiqueWithFallback()                          │
│       │         Scores: quality (0-1) + legal_safety (0-1)      │
│       │         Thresholds: 0.6 standard, 0.7 high-risk        │
│       │         Fail? → inject feedback → re-DRAFT (max 2x)    │
│       │                                                        │
│  6. SAFETY GATE                                                │
│       │         High-risk + still failing? → HITL              │
│       │         Cache response → require user acknowledgment   │
│       │                                                        │
│  7. RESPOND ──→ return result + critique scores + safety flag  │
│                                                                  │
│  CACHE: Identical questions cached 10 min (questionCache Map)   │
└─────────────────────────────────────────────────────────────────┘
```

## Key Design Decisions

### Critique Loop (Phase 1+2)

The pipeline doesn't just draft and return — it critiques its own output:

1. Draft produces an answer
2. A separate LLM call (using fast 8b-tier models) scores quality and legal_safety
3. If scores are below threshold, the draft is retried with specific feedback injected
4. Maximum 2 retries, then the best draft is returned regardless
5. High-risk categories (criminal, immigration, family, constitutional) require safety ≥ 0.7

This catches hallucinated citations, missing disclaimers, and dangerous advice before the user sees them.

### HITL Safety Gate (Phase 3)

When a high-risk answer fails critique after all retries, the response is cached server-side and the user sees an ApprovalCard:

- "This question involves criminal_rights — a high-risk legal area"
- "Our quality review could not fully verify the response accuracy"
- User clicks "I understand, show me" → cached response is returned with a safety banner
- User clicks "Cancel" → response is discarded

This prevents potentially harmful advice from being delivered without informed consent.

### SSE Event System (Phase 4)

The `/api/chat/stream` endpoint emits granular events:

```
classify_start → classify_done → search_start → search_done →
draft_start → draft_done → critique_start → critique_done →
safety_flag (if triggered) → complete
```

Each event carries only sanitized data — no raw prompts, no LLM reasoning, no internal state. The client can use these events to drive the UI reactively instead of relying on hardcoded step pacing.

### Provider Fallback Chain (Phase 7)

Every LLM call (classify, draft, critique) tries multiple providers:

```
Classify: Groq → Cerebras → Gemini
Draft:    Groq → Groq-fallback → OpenRouter → Cerebras → Gemini
Critique: Groq → Cerebras → Gemini
```

If a provider returns 429 (rate limit), it's placed on 30s cooldown and the next provider is tried. This gives resilience against any single provider going down or throttling.

### Server-Side Persistence (Phase 5)

Conversations are stored in Firestore:

```
users/{uid}/conversations/{uuid}/messages/{uuid}
```

- Every message is persisted to Firestore when its state changes
- localStorage is kept as a write-behind cache for offline support
- On sign-in, localStorage data is migrated to Firestore
- On page load, Firestore is the authoritative source (replaces localStorage)
- Delete removes from both Firestore and localStorage

### Question Cache (Phase 7+11)

Identical questions are cached for 10 minutes:

```
Key: "{jurisdiction}::{normalized question}"
TTL: 600 seconds
Max entries: 200 (LRU eviction)
```

Skips the entire pipeline (classify → search → draft → critique) for repeat queries. Doesn't cache `providersBusy` responses.

## Security Model

| Layer | Protection |
|---|---|
| **Transport** | HTTPS (Render default) |
| **CORS** | Allowlist: `*.onrender.com`, `*.firebaseapp.com`, localhost |
| **Auth** | Firebase ID token required on all `/api/*` endpoints |
| **Rate limit** | 60/min general, 20/min `/api/chat` per IP |
| **Body size** | 50kb max |
| **Ownership** | Firestore rules + server check; non-owners get 404 (not 403) |
| **IDs** | UUID v4 (122 random bits, not guessable) |
| **Content** | `sanitizeDraftResult()` strips placeholder URLs from LLM output |
| **Firestore rules** | Field validation, document size limits, ownership enforcement |

## File Map

```
server/
  chatRoute.js          — Main pipeline (classify → search → plan → draft → critique)
  conversationRoute.js  — Conversation CRUD API (Firestore)
  authMiddleware.js     — Firebase ID token verification
  legalCorpus.js        — Firestore retrieval with in-memory cache
  groq.js / cerebras.js / gemini.js / openrouter.js — Provider clients
  practiceAreas.js      — 19-category taxonomy (shared by classifier + ingestion)
  firebaseAdmin.js      — Admin SDK init (server-side only)
  eval/
    scenarios.json      — 35 eval scenarios
    scoring.js          — 15+ scoring dimensions
    runner.js           — CLI eval runner

public/
  index.html            — App shell, CSS design system
  app.js                — Client: conversation state, pipeline UI, SSE parser, auth
  beui-components.js    — UI component library
  firebase-init.js      — Client Firebase SDK init

scripts/
  ingest.js             — Single-Act ingestion
  bulk-ingest-firestore.js — Bulk ingestion (resumable)
  bulk-fetch-clean.js   — Download + clean Acts from PLAC
  run-eval.js           — CLI entry for eval suite
```

## What's Next

See `docs/ROADMAP.md` for the full V2/V3 plan. The highest-priority next steps:

1. **Ingest remaining gap laws** (VAPP Act, FCCPA, Recovery of Premises Act) — improves eval coverage
2. **Expand eval set** to 100+ scenarios with CI gating
3. **Persistent memory** — per-user preferences, cross-session context
