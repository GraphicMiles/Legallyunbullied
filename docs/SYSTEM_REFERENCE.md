# Legally Unbullied — Complete System Reference

**Document version:** 1.0

**Code baseline:** 17 August 2026 cleanup

**Purpose:** canonical description of what exists in the repository, what executes in production, how every request and agent stage behaves, and what remains incomplete.

---

## 1. Product boundary

Legally Unbullied is an authenticated Nigerian legal-information assistant. It is not a law firm, lawyer, court filing system, emergency service, or substitute for professional legal advice.

A user describes a situation. The server:

1. decides whether it is legal, casual, or clearly procedural;
2. classifies the legal area and jurisdiction;
3. retrieves and ranks statutory provisions;
4. checks whether the provisions are relevant and sufficient;
5. drafts an explanation and practical actions;
6. resolves provision IDs into authoritative displayed source cards;
7. reviews quality and legal safety;
8. withholds failed high-risk answers behind a user warning;
9. persists the terminal state.

There is one legal-answer HTTP path: `POST /api/chat`. The obsolete independent SSE pipeline has been removed.

---

# 2. Repository map

## Root

| File | Purpose |
|---|---|
| `server.js` | Express application, middleware, route mounting, health, process startup |
| `package.json` / `package-lock.json` | runtime scripts and locked dependencies |
| `render.yaml` | Render web-service deployment definition |
| `.env.example` | documented environment variable names/defaults |
| `.gitignore` | excludes credentials, generated output and local caches |
| `firebase.json` | Firebase project configuration |
| `firestore.rules` | client Firestore authorization rules |
| `firestore.indexes.json` | explicit Firestore indexes (currently none) |
| `README.md` | operator/developer introduction |
| `test-*.js` | deterministic and Playwright regression tests |

## `server/`

| File | Purpose |
|---|---|
| `authMiddleware.js` | Firebase bearer-token verification |
| `firebaseAdmin.js` | Firebase Admin initialization with REST-preferred Firestore transport |
| `chatRoute.js` | canonical agent pipeline, acknowledgement and title routes |
| `conversationRoute.js` | conversation/message CRUD, migration and cleanup |
| `legalIntent.js` | deterministic incident detection and fallback classification |
| `practiceAreas.js` | canonical 20-area taxonomy shared with ingestion |
| `legalCorpus.js` | Firestore/local retrieval, raw cache, ranking, broad search, circuit breaker |
| `localLegalCorpus.js` | checked-in source parser used for evaluation/fallback |
| `evidence.js` | source-ID collection, token replacement and displayed-citation verification |
| `providerHealth.js` | startup Groq/Gemini model-list checks |
| `jobRunner.js` | single-process Firestore-backed replay queue |
| `groq.js` | Groq OpenAI-compatible client and model defaults |
| `gemini.js` | Gemini OpenAI-compatible client and model defaults |
| `openrouter.js` | optional OpenRouter client |
| `cerebras.js` | optional Cerebras client |
| `eval/critical20.json` | selected release-critical scenarios |
| `eval/scenarios100.json` | complete authored 100-scenario multi-turn dataset |
| `eval/results-critical20.json` / `eval/report-critical20.md` | critical-20 baseline artifacts |
| `eval/results100.json` / `eval/report100.md` | final local-fallback 100-scenario pressure-test artifacts |

## `public/`

| File | Purpose |
|---|---|
| `index.html` | production application shell and design tokens |
| `app.js` | client state, API calls, rendering, persistence sync and auth UI |
| `firebase-init.js` | initializes Firebase browser SDK from runtime config |
| `components/BeUIPromptBar.js` | production composer |
| `components/BeUILoadingState.js` | initial working indicator |
| `components/BeUIThinkingState.js` | live/static thought-duration display |
| `components/BeUIStreamingText.js` | local text reveal animation |
| `components/BeUIRecommendationCard.js` | handle-yourself/lawyer recommendation card |
| `styles/beui-inspired.css` | application component styles |
| `styles/beui-components.css` | production BeUI component styles |

Demo pages, unused component implementations, duplicate streaming wrappers and the production debug panel were removed during cleanup.

## `scripts/`

| File/directory | Purpose |
|---|---|
| `run-tests.js` | deterministic regression-suite coordinator |
| `pdf-to-text.js` | PDF extraction |
| `ingest.js` | reviewed single-Act section ingestion |
| `bulk-fetch-clean.js` | bulk PLAC fetch and cleaning |
| `bulk-ingest-firestore.js` | resumable bulk Firestore ingestion |
| `classify-acts.js` | LLM title classification into practice areas |
| `clean-act.js` / `lib/textClean.js` | statutory text cleanup |
| `eval/runner100.js` | authenticated live multi-turn runner |
| `eval/scoring100.js` | deterministic eight-dimension scorer and critical failures |
| `eval/report100.js` | JSON/Markdown report generator |
| `eval/liveAuth.js` | mints an evaluation Firebase ID token |
| `eval/scen_*.py` / `build-scenarios100.py` | scenario authoring/build inputs |

The superseded 35-scenario runner/scorer/result set was removed.

## `legal_sources/`

- `constitution/` — Constitution source/extractions;
- `federal_acts/` — individually selected/cleaned federal laws;
- `state_laws/` — selected Lagos laws/directions;
- `federal_acts_bulk/` — checked-in PLAC compendium text;
- `manifest/` — classification, staging and ingestion progress;
- `SOURCES.md` — provenance notes.

Corpus counts, provenance and limitations are consolidated in section 13 of this file.

## Developer and operator quick start

Requirements:

- Node.js 18 or newer;
- Firebase web configuration;
- Firebase Admin service-account JSON;
- at least one supported LLM provider key.

```bash
cp .env.example .env
npm install
npm start
```

Open `http://localhost:3000`.

Core commands:

```bash
npm test                 # deterministic server/regression suite
npm run test:v2          # focused evidence/safety guardrails
npm run eval:dry         # list the 100-scenario evaluation plan
npm run eval:critical -- --base-url https://staging.example --delay 12000
npm run eval:full -- --base-url https://staging.example --delay 12000
npm run eval:report
```

Environment groups:

| Group | Variables |
|---|---|
| Firebase browser | `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_APP_ID` |
| Firebase server | `FIREBASE_SERVICE_ACCOUNT_JSON` |
| Providers | `GROQ_API_KEY`, `GEMINI_API_KEY`, optional `OPENROUTER_API_KEY`, `CEREBRAS_API_KEY` |
| Models | optional `GROQ_MODEL_*`, `GEMINI_MODEL_*` overrides |
| Server | `PORT`, `NODE_ENV` |
| Retrieval | `FIRESTORE_TIMEOUT_MS`, `LEGAL_CORPUS_LOCAL_FALLBACK`, evaluation-only `LOCAL_LEGAL_CORPUS` |
| Worker | `JOB_CONCURRENCY`, optional `DISABLE_JOB_WORKER` |

Real values belong only in ignored environment files or deployment secrets. Do not commit service-account JSON or provider tokens.

---

# 3. Runtime process

## Startup order

1. Load `.env` locally.
2. Construct provider clients lazily.
3. Configure Express and disable `x-powered-by`.
4. Install CORS.
5. Install 50 KB JSON body parsing.
6. Install the general API rate limiter.
7. Serve Firebase config and static assets.
8. Mount conversation routes.
9. Apply chat limiter and Firebase auth to `/api/chat*`.
10. Mount chat/title routes.
11. Install SPA fallback and global error middleware.
12. Listen on `0.0.0.0:$PORT`.
13. Start the background sweeper.
14. Probe Groq/Gemini configured model availability.

## Deployment

Render runs one web process using:

```text
build: npm install
start: npm start
health: /healthz
auto deploy: true
```

The worker is in the web process. Scaling to multiple instances is not supported safely by the current job claim model.

---

# 4. Middleware and request controls

## CORS

Explicit localhost and production origins are allowed, plus wildcard Render/Firebase hosting domains. Requests without an Origin header are allowed for server-to-server/mobile/evaluation use.

## Body limit

All parsed JSON is limited to 50 KB.

## Rate limits

- general `/api/*`: 60 requests/minute/IP;
- `/api/chat*`: additional 20 requests/minute/IP.

The server must be reviewed for correct Render proxy trust before relying on `req.ip` as a stable client identity.

## Authentication

`requireAuth` expects:

```http
Authorization: Bearer <Firebase ID token>
```

On success it sets `req.uid`. Missing/invalid tokens return 401; unavailable Admin auth returns 503.

---

# 5. API reference

## `GET /healthz`

Public health endpoint. Returns application/provider status and model availability. It does not expose credentials.

## `GET /firebase-config.js`

Public runtime Firebase web config.

## `GET /api/cache-stats`

Returns corpus cache/circuit statistics. Currently public; should become admin-only.

## `POST /api/cache-invalidate`

Clears raw/query caches and resets the Firestore circuit. Requires authentication but not yet an admin claim.

## Conversation API

All routes require Firebase authentication:

```text
GET    /api/conversations
POST   /api/conversations
GET    /api/conversations/:id
PUT    /api/conversations/:id
DELETE /api/conversations/:id
PUT    /api/conversations/:id/messages/:msgId
DELETE /api/conversations/:id/messages
POST   /api/conversations/migrate
POST   /api/conversations/cleanup
```

Canonical identity is:

```text
browser conversation ID = URL ID = Firestore conversation document ID
```

## `POST /api/chat`

Canonical legal-answer request.

Request:

```json
{
  "question": "...",
  "history": [{ "role": "user|agent", "content": "..." }],
  "conversationId": "optional UUID",
  "messageId": "optional UUID"
}
```

The IDs enable server-side result persistence and job recovery.

## `POST /api/chat/acknowledge`

Consumes a user-bound safety token and either withholds or returns/persists the flagged answer.

## `POST /api/generate-title`

Generates a 3–6 word title. It is protected by Firebase authentication and the chat-specific rate limiter.

---

# 6. Canonical agent pipeline

## 6.1 Job start and pipeline timer

If UID, conversation ID and message ID are present, `background_jobs/{messageId}` is written as running before pipeline execution. A separate message running marker is also requested.

The full-success response contains stage timings.

## 6.2 Input/history

- question is trimmed;
- history uses at most the last 18 entries;
- history is converted to `User:`/`Agent:` text.

Strict request/history schemas and independent token budgeting are not yet implemented.

## 6.3 Deterministic legal intent

High-precision regex/soft-signal logic detects legal incidents including violence, theft/fraud, arrest, eviction, dismissal/wages, family, consumer, debt and discrimination issues. It protects short incident descriptions from casual misclassification.

## 6.4 Classification

Provider order:

```text
Gemini Flash Lite
→ Groq GPT-OSS 20B
→ optional OpenRouter
→ optional Cerebras
```

Timeout: 8 seconds/provider.

Legal output includes practice area, jurisdiction status, urgency, summary, keywords, key issues, sourcing requirement, complexity, route, stakeholders and potential remedies.

If providers fail for a deterministically legal conversation, fallback classification is generated locally.

## 6.5 Casual branch

Casual messages return a short generated reply and are persisted without retrieval.

## 6.6 Procedural branch

Clearly procedural requests receive practical guidance, no statutes, empty sources and `evidence.noSourcing=true`. A deterministic static fallback exists.

## 6.7 Jurisdiction branch

Non-urgent tenancy/family/land matters with unknown state ask the user for jurisdiction. High/Critical matters continue so immediate safety guidance is not blocked.

## 6.8 Cache policy

Only history-free questions can use the global in-memory answer cache. Cached answers must already have passing critique and citation integrity.

Current key uses practice area, jurisdiction and the first 300 question characters. This needs a full-question hash and privacy-sensitive cache eligibility policy.

## 6.9 Primary retrieval

`findProvisions()`:

1. obtains raw practice-area provisions;
2. filters jurisdiction;
3. optionally narrows by classifier keywords;
4. scores title/heading/text coverage and jurisdiction;
5. diversifies by Act;
6. returns at most 14.

## 6.10 Firestore/local corpus modes

Primary mode: Firestore.

Raw category data is cached independently of question keywords for one hour. Firestore timeout defaults to 5 seconds.

On quota/timeout/unavailable errors:

1. open a five-minute Firestore circuit;
2. load checked-in provisions;
3. avoid repeated category timeouts while the circuit is open;
4. cache local categories.

Local fallback can be disabled with:

```text
LEGAL_CORPUS_LOCAL_FALLBACK=false
```

Evaluation can force local mode with:

```text
LOCAL_LEGAL_CORPUS=true
```

## 6.11 Relevance/sufficiency review

Provider order:

```text
Gemini Flash Lite
→ Groq GPT-OSS 120B
→ optional Cerebras
```

The judge receives IDs and 500-character candidate excerpts. It returns relevant indices and sufficiency.

Minimum sources:

- simple, non-high-risk: 1;
- complex/high-risk: 2.

Invalid/unavailable review fails closed.

## 6.12 Broad search

An insufficient primary review forces sequential search of configured adjacent categories and `general`. Results are deduplicated, reranked, diversified and reviewed again.

## 6.13 Insufficient evidence

No draft is generated. The response escalates and displays no source cards. Urgent cases receive immediate-safety actions; non-urgent cases receive preservation and lawyer guidance.

## 6.14 Deterministic plan

Complex cases use classifier issues/remedies and top provisions to build a deterministic response plan. There is no separate planning model call.

## 6.15 Draft

Provider order:

```text
Groq GPT-OSS 20B
→ Groq GPT-OSS 120B
→ optional OpenRouter
→ optional Cerebras
→ Gemini Flash
```

Timeout: 20 seconds/provider.

Expected fields:

```json
{
  "lawMd": "... [[provisionId]] ...",
  "actionsMd": "- ...",
  "provisionIds": ["..."],
  "claims": [{"claimId":"...","text":"...","provisionIds":["..."]}],
  "escalate": true,
  "escalateReason": "...",
  "followUps": ["..."]
}
```

The server rejects drafts missing required answer fields, provision IDs, claims, claim-to-provision links, escalation fields or follow-up arrays. Malformed drafts fall through to another provider and can never be presented as a legal answer.

## 6.16 Citation resolution

The server:

- accepts only IDs retrieved for that run;
- replaces `[[id]]` with authoritative labels;
- creates source cards from stored provision data;
- removes unknown IDs;
- records verification details;
- marks claims without retrieved IDs unsupported;
- rejects model-supplied source labels/URLs without retrieved IDs;
- flags Act/section citations that do not match the retrieved evidence set.

This deterministically verifies citation identity. Semantic support is reviewed claim-by-claim by the critique stage; that review remains model-based rather than an independent legal-authority engine.

## 6.17 Critique/safety review

Provider order:

```text
Gemini Flash Lite
→ Groq GPT-OSS 120B
→ optional Cerebras
```

Timeout: 8 seconds/provider.

Thresholds:

- quality: 0.6;
- standard safety: 0.6;
- high-risk safety: 0.7.

The critic must return one `supported|partial|unsupported|uncertain` decision for every structured claim. Unsupported, partial or uncertain claim support prevents a passing review. Standard failure returns limited evidence and escalation without repeated redrafts. High-risk failure permits one corrective draft/review, then requires acknowledgement.

## 6.18 Deterministic overrides

- citation-integrity failure overrides model pass;
- unsupported IDs remove displayed citations;
- evidence-related hedge language downgrades confidence;
- unavailable relevance/critique cannot become success.

## 6.19 Safety acknowledgement

A cryptographic 10-minute token is persisted with UID and optional message identity. Cross-user access returns 404. Accepted answers gain a safety banner and are persisted; flagged answers are never globally cached.

This is informed user acknowledgement, not professional review.

## 6.20 Terminal persistence

The server writes result, classification, critique, evidence, pipeline status and unread state. Provider-busy states are persisted separately. Successful complete responses expose stage timings.

---

# 7. Evidence model

## Provision record

Expected runtime shape:

```json
{
  "provisionId": "stable ID",
  "act": "Act name",
  "section": "section",
  "text": "authoritative excerpt",
  "practice_area": "taxonomy key",
  "jurisdiction": "Federal/state",
  "source_url": "optional",
  "source_version": "optional"
}
```

Existing Firestore document IDs serve as compatibility IDs when explicit `provisionId` is absent.

## Verified today

- source card came from a retrieved ID;
- displayed label/excerpt is server generated;
- unknown IDs and untrusted model source metadata are rejected;
- inline Act/section references outside the retrieved evidence set fail integrity;
- every structured claim receives a claim-support decision;
- answer evidence carries mode, source counts, conflicts, sufficiency and reason.

## Remaining evidence limitations

- claim support is judged by an LLM reviewer, not a qualified lawyer or deterministic legal entailment engine;
- current in-force status and amendments/repeals are incomplete;
- controlling jurisdiction can remain uncertain in emergency fallback;
- local fallback coverage is materially smaller than Firestore.

---

# 8. Provider control

## Startup health

Groq and Gemini model lists are checked with an 8-second timeout. `/healthz` exposes metadata-only status.

## Runtime failure classes

```text
model_not_found
authentication_failed
rate_limited
timeout
malformed_output
provider_unavailable
```

Cooldowns:

- permanent model/auth: 30 minutes;
- rate limit: 60 seconds;
- timeout: 30 seconds;
- other: 15 seconds.

Cooldowns are process-local. Provider requests timed out with `Promise.race` are not actually cancelled upstream.

---

# 9. Background worker

## Lifecycle

```text
running job document
→ live pipeline
→ done / failed / awaiting_input
```

On startup/every minute:

1. find running jobs older than five minutes;
2. reset them to queued;
3. enqueue queued jobs;
4. process with configured concurrency (default 1);
5. replay `runChatPipeline()`;
6. persist terminal state.

## Checkpoints

Worker retries can persist/reuse:

- classification;
- retrieval/evidence;
- plan/draft/critique.

The initial live request does not currently save these checkpoints; they primarily help after worker replay begins.

## Limitations

- no transactional lease;
- unsafe for multiple service instances;
- no durable cancellation;
- no TTL cleanup;
- sweeper queries can consume quota;
- start failures are swallowed as best-effort;
- message running marker is not awaited and can race terminal state.

---

# 10. Client application

## State and persistence

State includes conversations, active ID, busy state and user identity. Conversations are cached in localStorage and synchronized through the server API after authentication.

## Authentication

Firebase browser SDK supports:

- email/password sign-in and registration;
- Google popup sign-in;
- sign-out;
- ID token attachment to API requests.

## Conversation UX

- new/select/search/paginate;
- clear/delete with confirmation;
- direct URL resolution;
- server/local migration;
- copy transcript;
- unread badges;
- background-running polling.

## Answer UX

- loading state;
- elapsed thought display;
- local text reveal animation;
- escaped Markdown;
- authoritative source cards;
- recommendation/escalation card;
- follow-up buttons;
- safety acknowledgement;
- provider-busy auto-retry.

## Important behavior

The server returns a complete REST result. “Streaming” is a browser reveal animation, not live provider token streaming. The visible multi-step trace is presentation pacing after the server has done the work.

The stop button stops local UI callbacks but does not currently abort the server/provider request.

---

# 11. Conversation persistence

## Server API

- list/search/page conversations;
- create with canonical ID;
- read full conversation;
- update title;
- delete conversation/messages;
- upsert messages;
- migrate local conversations;
- clean duplicate empties.

## Known limits

- count/full listing can create N+1 Firestore queries;
- title search scans up to 1,000 records;
- delete/clear uses unchunked batches and can exceed 500 operations;
- Admin API message upsert lacks a strict field allowlist;
- no conflict version/ETag;
- no retention/archive system.

---

# 12. Firestore authorization

The repository rules protect user conversations/messages by UID and deny direct legal-corpus reads. Server routes use Firebase Admin and bypass these rules.

Updating `firestore.rules` in Git does not apply it automatically through the Render deployment; it must be deployed separately with Firebase CLI/CI (`firebase deploy --only firestore:rules`).

Current boundaries:

- direct legal-provision reads are denied; evidence is served through the server pipeline;
- conversation/message reads and writes are UID-scoped;
- the server applies an allowlist before Admin message upserts;
- server API validation remains the primary control because Admin SDK bypasses rules.

---

# 13. Legal corpus and ingestion

## 13.1 Corpus snapshot

Snapshot verified on 16 August 2026:

| Metric | Value |
|---|---:|
| PLAC 2004 compendium Acts | 547 |
| Bulk Acts ingested | 545 |
| Separately sourced gap laws | 3 |
| Additional coverage laws | 4 |
| Optional PLAC Acts remaining | 2 |
| Firestore provisions | approximately 14,384 |
| Checked-in fallback provisions parsed | approximately 7,655 |
| Subject practice areas covered | 19/19, plus `general` |

The two optional PLAC Acts not ingested are:

- Treaty to Establish the African Union (Ratification and Enforcement) Act;
- World Meteorological Organisation (Protection) Act.

Neither is used by the current evaluation set.

## 13.2 Bulk Act distribution

| Practice area | Bulk Acts |
|---|---:|
| general | 186 |
| tax_finance | 71 |
| education | 47 |
| health | 37 |
| transport_traffic | 36 |
| land_property | 23 |
| company_business | 23 |
| government_administration | 22 |
| criminal_offences | 19 |
| environment | 14 |
| criminal_rights | 12 |
| employment | 10 |
| employment_labour_safety | 9 |
| family_law | 9 |
| immigration_citizenship | 7 |
| contract | 6 |
| intellectual_property | 6 |
| constitutional_rights | 5 |
| consumer_rights | 3 |
| **Total** | **545** |

## 13.3 Important separately sourced laws

| Law | Category | Status/coverage |
|---|---|---|
| Lagos State Tenancy Law 2011 | tenancy | hand-ingested; primary Lagos rent/eviction source |
| Recovery of Premises Law/Act text | tenancy | 31 sections; uniform text used as Federal/FCT coverage pending a verbatim federal source |
| Violence Against Persons (Prohibition) Act 2015 | criminal_rights | 48 sections; domestic/sexual violence coverage |
| Federal Competition and Consumer Protection Act 2018 | consumer_rights | 168 sections; consumer/competition coverage |
| Wills Act 1837 | family_law | 33 parsed sections; testate succession |
| Child Rights Act 2003 | family_law | 278 sections; custody/welfare/protection |
| Sale of Goods Act 1893 | contract | 53 parsed sections; sale/defective-goods remedies |
| Trade Marks Act | intellectual_property | 69 sections |

The freely available Recovery of Premises source is a Kogi-issued edition of the uniform law. Its notice periods are treated as substantively aligned with the FCT federal regime, but a verbatim authoritative federal source remains preferable.

Some LawGlobal Hub coverage files are incomplete: the Wills source lacks sections 2 and 12, and the Sale of Goods source lacks sections 4 and 40–48. These limitations must remain disclosed.

## 13.4 Hand-reviewed foundation

Individually reviewed sources include:

1. Lagos State Tenancy Law 2011;
2. Labour Act;
3. Administration of Criminal Justice Act 2015;
4. National Industrial Court Act 2006;
5. Lagos State Small Claims Court Practice Direction;
6. Constitution of the Federal Republic of Nigeria 1999 as amended.

## 13.5 Ingestion paths

### Reviewed/single Act

```text
source PDF/text
→ extract
→ human inspect/clean
→ section parser preview
→ Firestore Admin batch write
→ invalidate corpus cache
```

Example:

```bash
node scripts/pdf-to-text.js --file legal_sources/federal_acts/example.pdf
node scripts/ingest.js \
  --file legal_sources/federal_acts/example.txt \
  --act "Example Act" \
  --practice-area contract \
  --jurisdiction Federal \
  --source-url "https://authoritative-source.example" \
  --dry-run
```

Remove `--dry-run` only after reviewing the parsed sections.

### Bulk PLAC

```text
title classification
→ fetch/cache source
→ generic text cleanup
→ staged quality statistics
→ resumable Firestore ingestion
```

Commands:

```bash
node scripts/classify-acts.js
node scripts/bulk-fetch-clean.js
node scripts/bulk-ingest-firestore.js --dry-run
node scripts/bulk-ingest-firestore.js
```

Progress is stored in `legal_sources/manifest/ingest_progress.json`.

## 13.6 Source locations

Preferred source classes:

- official gazettes and government publications;
- PLAC Laws of Nigeria;
- authoritative court/government repositories;
- reviewed secondary repositories only when an official full text is unavailable.

Every provision should eventually carry source URL, source version, jurisdiction, effective date, in-force status and review provenance.

## 13.7 Known legal-data gaps

- the PLAC corpus is largely a 2004 federal compendium;
- amendments, replacements and repeals are not systematically consolidated;
- CAMA 2020 and other amended laws require exact-version verification;
- state tenancy, family, succession and land law coverage is limited;
- intestate succession and many tort questions depend on state/common law;
- there is no case-law corpus;
- `in_force` is not a maintained legal-status service;
- source quality is uneven across automated bulk documents;
- no qualified-lawyer editorial workflow approves corpus updates;
- no scheduled freshness monitor exists.

The pipeline must use honest insufficient-evidence handling rather than extrapolating beyond this coverage.

---

# 14. Testing and evaluation

## `npm test`

Runs deterministic suites for:

- conversation identity/migration;
- pagination;
- legal intent;
- retrieval/evidence;
- procedural/hedging;
- recoverable requests;
- job replay/checkpoints;
- acknowledgement ownership/restart;
- cache/fail-closed/title behavior;
- exact/vague/multi-area retrieval, jurisdiction, stale sources and Firestore fallback pressure;
- concurrent request idempotency, worker leases and corrupted checkpoint rejection;
- malformed model output, unsupported claims, conflicting evidence and total provider failure.

## Browser tests

`test-chat-*.js` cover auth, lifecycle, context, HITL reload, ordering, pagination, retry, timer, trace, title, URL and unread behavior. They require Playwright browser/OS dependencies and are not part of `npm test`.

## Evaluation

- 100 authored scenarios;
- 20 critical subset;
- live Firebase authentication;
- resumable JSONL output;
- deterministic nine-dimension scoring, including reliability;
- report generation.

Final local-fallback pressure-test artifact:

- 100/100 scenarios passed the automated gate after fixes and targeted regression reruns;
- 0 critical failures in the final composite;
- average 3.71/5;
- 293/293 final turns returned HTTP 200;
- legal accuracy 4.12/5;
- citation accuracy 3.27/5;
- source grounding 2.16/5;
- safety 4.73/5;
- follow-up reasoning 2.33/5;
- practical usefulness 4.41/5;
- uncertainty handling 3.98/5;
- reliability 4.96/5;
- p50 0.14s, p90 4.50s, p95 12.20s, maximum 64.06s under mixed provider-available/provider-exhausted conditions.

The first uninterrupted pressure run exposed 113 classification 502s after both free provider quotas were exhausted. Deterministic fail-closed classification removed those 502s; affected scenarios were rerun and merged into the final artifact. The final result is therefore a regression composite, not a claim that one uninterrupted clean run passed first time.

The run used `LOCAL_LEGAL_CORPUS=true`; Firestore remained quota-limited and was deliberately not hammered. A complete Firestore-versus-local comparison remains pending until Firestore is available. Qualified-lawyer review also remains required, particularly because source grounding averaged only 2.16/5.

---

# 15. Security, privacy and operations

## Implemented

- Firebase bearer auth;
- UID ownership boundaries;
- CORS;
- body limits;
- IP rate limits;
- high-entropy IDs;
- environment credentials;
- provider health/cooldowns;
- no credentials committed.

## Required work

- rotate exposed Firebase/Groq/Gemini/GitHub credentials;
- admin-protect cache operational routes;
- configure/verify Render proxy trust;
- add strict schemas;
- add Helmet/CSP/security headers;
- add temporary-document TTLs;
- document user consent, provider processing, retention and deletion;
- add structured run/audit logs and quota/cost alerts;
- add CI, staging, canary and rollback.

Current production-dependency audit reports 8 moderate, 0 high and 0 critical advisories, all requiring dependency-chain review before claiming remediation.

---

# 16. Completed, partial and missing

## Completed/substantial

- authenticated production chat;
- conversation persistence/migration;
- canonical REST legal pipeline;
- legal-intent safeguards;
- category retrieval/ranking/broadening;
- fail-closed relevance;
- provision-ID displayed citations;
- safety critique/acknowledgement;
- provider fallback/health;
- quota circuit/local fallback with `evidence.mode`;
- strict request, classification and draft schemas;
- provision-ID and inline-citation integrity checks;
- model-based per-claim support review with fail-closed escalation;
- UID-scoped cache and concurrent message idempotency;
- transactional worker leases and corrupted-checkpoint rejection;
- single-instance replay worker;
- critical-20 and full-100 local-fallback pressure gates.

## Partial

- claim support is model-reviewed rather than independently legally adjudicated;
- checkpoint recovery after worker start;
- message idempotency exists, but there is no first-class persisted `runId` state machine;
- worker leases exist, but TTL cleanup and durable cancellation do not;
- corpus provenance/freshness fields;
- full-100 has no qualified-lawyer review and no healthy-Firestore comparison;
- observability without run traces/cost accounting.

## Missing

- independent/qualified legal claim-support review;
- live events/token streaming from canonical engine;
- vector/semantic retrieval;
- case law;
- structured case memory/provenance;
- durable distributed queue/cancellation;
- lawyer review dashboard;
- real handoff/referral/emergency tools;
- amendment/repeal monitoring;
- privacy/retention/export tooling;
- multi-tenant quotas;
- CI/canary/feature flags.

---

# 17. Priority register

## P0

1. Rotate exposed secrets.
2. Admin-protect cache endpoints.
3. Independently validate model-based claim-support decisions with qualified legal review.
4. Make emergency default jurisdiction explicit and persistent across follow-ups.
5. Resolve the low local-corpus source-grounding score before expanding reliance.

## P1

1. Stable `runId` and typed stage artifacts.
2. Canonical event emission if streaming returns.
3. Upstream cancellation/global deadline.
4. Complete worker leases with TTL cleanup and durable cancellation.
5. Firestore query/delete scaling fixes.
6. structured logs, traces, alerts and cost metrics.
7. security headers/CSP.
8. CI/browser/staging gate.

## P2

1. structured case profile with provenance;
2. hybrid retrieval;
3. source freshness/amendment status;
4. state-law expansion;
5. qualified-lawyer review workflow;
6. real referral/emergency resource tools;
7. repeated full-100 and lawyer scoring;
8. privacy/NDPR operational controls.

---

# 18. Dead-code and stale-information cleanup record

Removed from the production/repository surface:

- independent `/api/chat/stream` pipeline and unused browser SSE client;
- obsolete LLM planning prompt/function (REST planning is deterministic);
- duplicate `enhanced-streaming.js` wrapper;
- production debug panel, console/fetch interception and debug toggle;
- standalone DOM debugging script;
- five pipeline/demo HTML pages;
- unused BeUI aggregate library;
- unused approval, context-card, task-row, tool-chip and duplicate loading components;
- corresponding unused component CSS sections;
- fake local “two free questions” counter and nonfunctional paid-upgrade alert;
- obsolete optional-auth middleware;
- obsolete 35-scenario runner, scorer, scenarios and results;
- stale V1/V2 phase documentation and old generated evaluation filenames;
- unused client helpers, cleanup branches and presentation constants;
- stale test fixtures/version expectations.

Current canonical artifacts are the production REST path, 100-scenario evaluation framework, critical/full evaluation results, this single documentation file and only the UI components loaded by `public/index.html`.

# 19. Final V1 reliability and pressure-test report

## 19.1 What failed

- Keyword hard-filtering dropped controlling provisions on vague questions.
- The global standalone-answer cache was not UID-scoped and used a truncated question prefix.
- Model drafts and classifications were only partially schema-validated.
- Source cards were verified, but model source labels, plain-text fabricated citations and claim support still had bypasses.
- Materially conflicting provisions were not represented in evidence sufficiency.
- The message running marker could race terminal persistence.
- Concurrent duplicate message requests could execute twice.
- Worker queue claims had no cross-instance lease.
- Corrupted draft checkpoints could be trusted without re-verifying evidence IDs.
- Under sustained pressure, both free LLM providers exhausted rate/token limits. The first full run recorded 113 classification 502s.
- Deterministic provider-outage fallback initially classified too many follow-ups as `general`/Medium and missed urgent safety prioritization.
- Firestore could not support a comparison run because its quota was already exhausted.
- Local fallback retrieval frequently returned honest insufficiency; source grounding remained weak.

## 19.2 What was fixed

- Removed hard keyword filtering; all jurisdiction-valid category provisions are ranked.
- Scoped answer cache by UID and full SHA-256 question hash; history remains excluded.
- Added strict question/history, classification and draft schemas.
- Required provision IDs and structured claims in substantive drafts.
- Rejected untrusted model source metadata and unknown inline Act/section references.
- Added per-claim `supported|partial|unsupported|uncertain` review; non-supported claims fail review and escalate.
- Added evidence conflicts and prevented conflicts from becoming sufficient.
- Added `evidence.mode = firestore|local_fallback` and verified local-fallback answers through the same gates.
- Awaited the message running marker.
- Added in-flight duplicate request coalescing and persisted terminal replay.
- Added transactional worker leases and lease-expiry recovery.
- Added classification/retrieval/draft checkpoint validation and corrupt-checkpoint recomputation.
- Added deterministic fail-closed classification for total provider outage, preserving prior legal area when possible.
- Added deterministic urgent-category detection and immediate-safety/escalation policy.
- Added stale/repealed source filtering/ranking controls.
- Kept Firestore circuit behavior: Firestore → checked-in corpus → verified answer or safe escalation.

## 19.3 Regression tests added

- UID/cache isolation, full-question cache identity and concurrent duplicate execution;
- exact-section, vague, wrong-category, adjacent-area, multi-intent and Federal/state retrieval;
- Firestore quota circuit/no-hammer behavior and local-fallback mode;
- stale/repealed source handling;
- fabricated provision ID, source metadata, Act and section rejection;
- malformed draft schema and bad request/history rejection;
- conflicting evidence and unsupported claim escalation;
- total provider failure and critique/relevance failure;
- urgent high-risk deterministic escalation;
- cross-instance worker lease exclusion;
- corrupt checkpoint rejection/recomputation;
- existing disconnect/recovery, acknowledgement ownership, pagination, migration and queue tests retained.

`npm test` now runs 11 deterministic test files and passes.

## 19.4 100-case results

Final composite after fixes and targeted reruns, using `LOCAL_LEGAL_CORPUS=true`:

| Metric | Result |
|---|---:|
| Scenarios | 100 |
| Turns | 293 |
| HTTP 200 turns | 293/293 |
| Automated passes | 100/100 |
| Critical failures | 0 |
| Average score | 3.71/5 |
| Legal accuracy | 4.12/5 |
| Citation accuracy | 3.27/5 |
| Source grounding | 2.16/5 |
| Safety | 4.73/5 |
| Follow-up reasoning | 2.33/5 |
| Practical usefulness | 4.41/5 |
| Communication | 3.42/5 |
| Uncertainty handling | 3.98/5 |
| Reliability | 4.96/5 |
| p50 / p90 / p95 latency | 0.14s / 4.50s / 12.20s |
| Maximum latency | 64.06s |

Four turns ended in a safe `providersBusy` response during provider exhaustion; none became confident legal answers. The final score is a composite containing targeted reruns after each demonstrated failure, not a first-attempt clean run.

## 19.5 Firestore vs local-fallback results

| Mode | Result |
|---|---|
| Firestore | Full comparison not run: quota exhausted. The system opened its circuit and did not repeatedly hammer Firestore. |
| Local fallback | Full 100-scenario pressure run completed through the same relevance, citation, claim-support and safety gates. |

No equivalence claim is made. Firestore documents approximately 14,384 provisions; checked-in fallback parsing yields approximately 7,655. A healthy-Firestore comparison remains mandatory when quota returns.

## 19.6 Remaining known limitations

- Local source grounding is low (2.16/5) and many answers safely escalate instead of giving sourced law.
- Claim support is model-reviewed, not independently verified by a qualified lawyer.
- The final 100 result is a regression composite, not one uninterrupted first-pass run.
- Provider quotas were exhausted during pressure; production needs budget/quota planning and cancellation of timed-out upstream calls.
- Follow-up reasoning and communication remain below 3.5/5.
- Firestore/local parity is unmeasured.
- Local corpus is smaller and has provenance/freshness gaps.
- Durable server cancellation and job TTL cleanup remain incomplete.
- No qualified-lawyer review, case-law corpus, amendment/repeal monitor, or full state-law coverage exists.
- Exposed Firebase, Groq, Gemini and GitHub credentials still require rotation.

# 20. Accuracy statement

This file documents repository-controlled behavior and the executed regression composite. It does not certify external Render settings, Firebase IAM/quotas, provider retention policies, statutory legal accuracy, or current-law completeness. Those require cloud-console inspection, a healthy-Firestore comparison and qualified legal review.
