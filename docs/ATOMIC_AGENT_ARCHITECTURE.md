# Legally Unbullied — Current Agent Architecture

> Current as of 17 August 2026. The canonical detailed reference is `docs/SYSTEM_REFERENCE.md`.

## Canonical request path

The browser uses one authenticated REST path: `POST /api/chat`. There is no separate SSE legal pipeline.

```text
request/auth/rate limit
  → durable job start (when message IDs are supplied)
  → legal-intent guard
  → classify
  ├─ casual → reply
  ├─ clearly procedural → practical unsourced guidance
  ├─ non-urgent state-sensitive + unknown state → ask jurisdiction
  └─ sourced legal route
       → primary category retrieval
       → deterministic lexical ranking/diversification
       → relevance/sufficiency review
       ├─ insufficient → forced adjacent/general search + review
       ├─ still insufficient → honest escalation/safety response
       └─ sufficient
            → deterministic response plan
            → provision-ID draft
            → authoritative citation resolution
            → quality/safety critique
            ├─ standard fail → limited evidence + escalation
            ├─ high-risk fail → one corrective draft/review
            └─ persistent high-risk fail → user safety acknowledgement
                 → terminal persistence
```

## Deterministic boundaries

The model may select retrieved provision IDs, but displayed source labels, excerpts, jurisdiction, source URL and source version are resolved by the server. Unknown IDs are removed and fail citation integrity.

This does not yet prove semantic claim support. A dedicated typed claim-support stage remains planned.

## Retrieval

- Firestore is the primary corpus.
- Raw practice-area documents are cached independently of question keywords.
- Question-specific filtering and ranking happen in memory.
- A Firestore quota/timeout opens a five-minute circuit and switches to the checked-in corpus.
- At most 14 ranked/diversified provisions enter model context.
- Broad search is sequential and explicitly configured; it is not yet semantic/vector retrieval.

## Providers

- Classification: Gemini Flash Lite → Groq GPT-OSS 20B → optional providers.
- Relevance/critique: Gemini Flash Lite → Groq GPT-OSS 120B → optional Cerebras.
- Draft: Groq GPT-OSS 20B → GPT-OSS 120B → optional providers → Gemini Flash.
- Model/task cooldowns are in memory.
- Stage timeouts exist, but upstream requests are not yet cancelled after timeout.

## Persistence and recovery

Conversations are stored under the authenticated UID. A Firestore-backed job record supports restart/replay on a single Render instance. Worker retries can save classification, retrieval and draft/critique checkpoints.

This is not a distributed queue. There is no transactional lease, durable cancellation or completed-job TTL.

## Safety

- relevance and critique failures are fail-closed on the canonical path;
- high-risk categories require a higher safety score;
- one corrective redraft is allowed for high-risk answers;
- unresolved high-risk review requires explicit user acknowledgement;
- urgent insufficient-evidence responses prioritize immediate physical safety.

User acknowledgement is not lawyer review and must not be represented as such.
