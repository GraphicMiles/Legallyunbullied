# Legally Unbullied — Product Roadmap

> Last updated: 2026-08-16

## V1 — Core ✅ COMPLETE

All 7 phases shipped and deployed to production at `https://legally-unbullied.onrender.com`.

| Phase | Feature | Status | Commit |
|---|---|---|---|
| 1 | Pipeline (classify → search → draft → critique → answer), simple/complex router, plan tool, critique loop (2-retry cap) | ✅ Done | `a9dd4f1` |
| 2 | Split scoring (quality vs legal_safety), high-risk categories get stricter bar (0.7 safety threshold) | ✅ Done | `b6304d8` |
| 3 | `askUser` HITL — triggers on failed safety for high-risk categories, wired to safety approval card | ✅ Done | `6709cdb` |
| 4 | SSE event system + event-driven UI — 12 granular events, fetch-streaming client | ✅ Done | `6709cdb` |
| 5 | Conversation state (within-session + Firestore persistence) | ✅ Done | `9eac777` |
| 6 | Eval set (35 real scenarios) + regression scoring (15+ dimensions, pass threshold 0.7) | ✅ Done | pre-existing |
| 7 | Polish — provider fallback chain (5 providers), LLM timeouts, question cache (10-min TTL) | ✅ Done | `a9dd4f1` |

### V1 Security & Infrastructure (also shipped)

| Feature | Status | Commit |
|---|---|---|
| CORS with origin allowlist | ✅ Done | `cd2587c` |
| Rate limiting (60/min general, 20/min chat) | ✅ Done | `cd2587c` |
| Firebase ID token auth on all API endpoints | ✅ Done | `cd2587c` |
| Body size limits (50kb) | ✅ Done | `cd2587c` |
| Firestore security rules (field validation, size limits) | ✅ Done | `cd2587c` |
| Server-side conversation persistence (Firestore) | ✅ Done | `9eac777` |
| UUID v4 conversation IDs (high-entropy) | ✅ Done | `24c08c4` |
| Ownership checks return 404 (not 403) — prevents enumeration | ✅ Done | `24c08c4` |
| URL-based routing (`#chat/{uuid}`) | ✅ Done | `165bac3` |
| Legal corpus: 545/547 federal Acts ingested (~8,200 sections) | ✅ Done | bulk ingestion |

---

## V2 — Product Maturity

Build these only after V1's eval suite proves the core agent is consistently accurate and safe.

| Phase | Feature | Description | Priority |
|---|---|---|---|
| 8 | **Persistent memory** | Per-user preferences, cross-session context (remember past topics, preferred communication style, jurisdiction defaults). Currently conversations persist but there's no preference layer on top. | High |
| 9 | **Parallel tool execution** | Run `search` + partial `draft` prep concurrently where safe. Currently all pipeline steps are sequential. Could cut latency 30-40% on complex questions. | Medium |
| 10 | **Multi-model fallback** | Already done for provider failover (Phase 7). This phase adds *semantic* fallback — if primary model produces low-quality output, automatically retry with a different model tier. | Medium |
| 11 | **Question caching** | Already done for identical questions (Phase 7). This phase adds *semantic* caching — "minimum wage in Lagos" and "what's the lowest legal pay in Lagos" should hit the same cache entry. Requires embedding similarity. | Low |
| 12 | **Expanded eval + CI gating** | Grow eval set from 35 → 100+ scenarios. Add CI pipeline that runs eval on every deploy and blocks merge if score drops below regression gate. | High |

### V2 Architecture Notes

- **Phase 8** needs a new Firestore collection: `users/{uid}/preferences` with fields like `defaultJurisdiction`, `preferredComplexity`, `pastTopics[]`.
- **Phase 9** requires refactoring the pipeline from sequential `await` chains to `Promise.all()` groups with dependency tracking.
- **Phase 11** needs an embedding model (e.g. `text-embedding-3-small`) and a vector store (Firestore doesn't natively support vector search — consider Pinecone or Qdrant).
- **Phase 12** needs a CI config (GitHub Actions or Render's built-in CI) that runs `npm run eval` after each deploy.

---

## V3 — Enterprise / Scale

Only relevant when the product has real users and compliance requirements.

| Phase | Feature | Description | Priority |
|---|---|---|---|
| 13 | **Observability** | Structured logging (JSON), distributed tracing per agent run (classify→search→draft→critique), dashboards for latency/cost/safety-fail-rate. Currently using `console.log` statements. | High |
| 14 | **Audit logs** | Every answer's full decision trail stored for compliance review — which tools ran, what scores they got, which citations were used, what the user asked. Legal advice requires accountability. | High |
| 15 | **Human-review dashboard** | Lets a qualified lawyer spot-check flagged or low-safety-score answers post-hoc. Currently the safety flag is user-facing only; lawyers need a backend view. | Medium |
| 16 | **Multi-tenant / quotas** | Per-user or per-org rate limits and cost controls. Currently IP-based rate limiting only. Needs user-level token buckets and spending caps. | Medium |
| 17 | **A/B testing** | Compare prompt/model changes against the eval suite and live traffic simultaneously. Needs feature flags + metrics pipeline. | Low |
| 18 | **Gradual rollout** | The 10%→100% traffic shift for new model versions. Needs a traffic router + canary deployment infrastructure. | Low |

### V3 Architecture Notes

- **Phase 13** should use a structured logging library (e.g. `pino`) with a log aggregator (Datadog, Axiom, or self-hosted Grafana Loki).
- **Phase 14** needs a new Firestore collection: `audit_logs/{runId}` with the full agent trace as a single document.
- **Phase 15** is a separate web app (React dashboard) that reads from the audit log collection and lets lawyers annotate answers.
- **Phase 16** needs a token bucket implementation (Redis or in-memory with cluster sync) keyed on `userId`.

---

## Ingestion Backlog

See `docs/INGESTION_STATUS.md` for the full breakdown. Summary:

- **545/547** federal Acts ingested from PLAC 2004 compendium — essentially complete
- **4 critical gaps** need separate sourcing (not in PLAC compendium):
  1. Recovery of Premises Act (Abuja tenancy)
  2. Violence Against Persons (Prohibition) Act 2015 (domestic violence)
  3. Federal Competition and Consumer Protection Act 2018 (consumer rights)
  4. Lagos State Tenancy Law 2011 — ✅ already hand-ingested as a flagship Act

---

## How to Test V1 Success

See the testing guide below for concrete steps to verify each phase on the live site.

### Quick Smoke Test (5 minutes)

| # | Action | Expected | Phase |
|---|---|---|---|
| 1 | Visit base URL | Empty landing state | 5 |
| 2 | Type "Hi" | Casual reply, no step trace | 1 |
| 3 | Ask a Lagos tenancy question | Full answer with citations, steps all done | 1, 2 |
| 4 | Check Network tab → response JSON | `critique` field with quality + safety scores | 2 |
| 5 | Ask a criminal rights question | Higher safety threshold (0.7) in critique scores | 2 |
| 6 | Reload page | Conversation restored from Firestore | 5 |
| 7 | Delete conversation, reload | Stays deleted | Persistence |
| 8 | `curl` the SSE endpoint | Stream of structured events | 4 |
| 9 | Run `npm run eval -- --limit 5` | Scores ≥ 0.7 | 6 |

### Detailed Per-Phase Tests

**Phase 1 — Pipeline:**
- Simple question ("What is the minimum wage?") → fast, no plan step
- Complex question (multi-fact scenario) → plan step visible, longer response
- Verify: `response.route` is `"simple"` or `"complex"` as expected

**Phase 2 — Split Scoring:**
- Check `response.critique.quality` and `response.critique.legal_safety` exist
- Standard category: thresholds are `{quality: 0.6, safety: 0.6}`
- High-risk (criminal, immigration, family, constitutional): safety threshold is 0.7
- Check `response.critique.isHighRisk` is correct for the practice area

**Phase 3 — HITL on Safety Fail:**
- Test `/api/chat/acknowledge` endpoint with invalid token → 404
- This only triggers naturally when a high-risk answer fails critique 3 times — check server logs for `"requiring safety acknowledgment"` messages

**Phase 4 — SSE:**
- `curl -N "/api/chat/stream?question=..."` with auth header
- Should see events: `start` → `classify_done` → `search_done` → `draft_done` → `critique_done` → `complete`
- Each event carries sanitized data only (no raw prompts or reasoning)

**Phase 5 — Persistence:**
- Create conversation → reload → still there
- Delete conversation → reload → stays gone
- Sign in on different device → same conversations appear

**Phase 6 — Eval:**
- `npm run eval` should score ≥ 0.7 overall
- No single scenario should score 0 (unless it's an expected error case)
- Critique dimensions should be present in scoring output

**Phase 7 — Polish:**
- Check server logs for provider fallback (e.g., `"groq rate-limited"` → next provider)
- Question cache: ask the same question twice → second response should be faster
- Check `response.providersBusy` is `false` for normal responses
