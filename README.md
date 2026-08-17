# Legally Unbullied

Evidence-grounded Nigerian legal-information assistant. The application classifies a user’s situation, retrieves Nigerian statutory provisions, ranks and validates the evidence, drafts an answer with provision-ID references, verifies displayed citations on the server, applies a safety review, and persists the conversation.

> Legally Unbullied provides legal information, not legal advice. Urgent or high-risk matters should be reviewed by a qualified lawyer.

## Production architecture

```text
Browser (vanilla JS + Firebase Auth)
  → authenticated POST /api/chat
  → deterministic legal-intent guard
  → LLM classification
  → Firestore/local statutory retrieval
  → deterministic ranking and broad search
  → LLM relevance review
  → deterministic response plan
  → LLM draft using provision IDs
  → server citation resolution
  → LLM quality/safety critique
  → high-risk acknowledgement when required
  → Firestore persistence
```

The main client uses the REST pipeline. The obsolete separate SSE implementation has been removed so there is only one legal-answer path.

## Important files

- `server.js` — Express service, security middleware, routes, health check, worker startup.
- `server/chatRoute.js` — canonical legal-answer pipeline and safety acknowledgement.
- `server/legalCorpus.js` — raw category cache, lexical ranking, broad retrieval, Firestore circuit breaker.
- `server/evidence.js` — provision-ID and displayed-citation verification.
- `server/legalIntent.js` — deterministic legal-incident detection and fallback classification.
- `server/jobRunner.js` — Firestore-backed, single-instance restart/replay worker.
- `server/conversationRoute.js` — authenticated conversation/message API.
- `server/providerHealth.js` — startup model availability checks.
- `server/localLegalCorpus.js` — read-only checked-in corpus fallback.
- `public/app.js` — client state, persistence sync, chat rendering and auth behavior.
- `scripts/eval/runner100.js` — live 100-scenario runner.
- `scripts/eval/scoring100.js` — deterministic evaluation scorer.
- `docs/SYSTEM_REFERENCE.md` — complete current implementation reference and gap register.
- `docs/INGESTION_STATUS.md` — legal corpus status and provenance limitations.

## Environment

Copy `.env.example` to `.env` for local development. Required production values:

- Firebase browser configuration (`FIREBASE_*`)
- `FIREBASE_SERVICE_ACCOUNT_JSON`
- at least one supported LLM provider key (`GROQ_API_KEY` or `GEMINI_API_KEY`)

Never commit credentials. Rotate any key exposed in logs, chat, screenshots or source control.

## Run

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Tests

Deterministic server/regression suite:

```bash
npm test
```

Focused V2 guardrails:

```bash
npm run test:v2
```

Playwright browser tests are stored as `test-chat-*.js` and require an installed Playwright browser plus its OS dependencies.

## Evaluation

Dry-run the 100-scenario plan:

```bash
npm run eval:dry
```

Run the critical 20 against a staging URL:

```bash
npm run eval:critical -- --base-url https://your-staging-service.onrender.com --delay 12000
```

Run all 100:

```bash
npm run eval:full -- --base-url https://your-staging-service.onrender.com --delay 12000
npm run eval:report
```

The latest committed critical result covers 20 scenarios and 61 turns: 20/20 passed with zero critical failures. It used the checked-in local corpus after Firestore quota exhaustion; it is not a substitute for a fresh full-100 run against a healthy production-equivalent corpus and qualified-lawyer review.

## Deployment

`render.yaml` defines one Render web service with automatic deployment, `/healthz`, and environment-variable placeholders. The background worker runs inside the same process and is intentionally single-instance. See `docs/SYSTEM_REFERENCE.md` before scaling beyond one instance.
