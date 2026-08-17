# Legally Unbullied — Current Roadmap

> Updated 17 August 2026. Completed work reflects the code on `main`; planned work is not represented as shipped.

## Shipped foundation

- Responsive authenticated chat application
- Firebase email/password and Google authentication
- Firestore conversation persistence and localStorage migration
- Canonical URL/message identity
- Deterministic legal-intent guard
- Legal/casual/procedural routing
- State clarification for non-urgent state-sensitive matters
- Firestore legal corpus with checked-in fallback
- Raw-category cache and Firestore quota circuit breaker
- Deterministic lexical ranking and authority diversification
- Forced adjacent/general broad retrieval
- Relevance/sufficiency gate
- Deterministic complex-response plan
- Provision-ID source-card resolution
- Category-specific quality/safety thresholds
- High-risk user acknowledgement
- Provider model health, fallback, timeout and cooldown handling
- Server-side terminal result persistence
- Single-instance restart/replay background worker
- 100-scenario dataset, critical-20 gate and deterministic test suite
- Authenticated title generation
- Server message-field allowlisting
- Direct client corpus reads denied by Firestore rules
- Obsolete SSE/demo/debug code removed

## P0 — Safety and security cleanup

1. Rotate all credentials exposed during development/review.
2. Require admin authorization for corpus cache invalidation/stats.
3. Add strict classification and draft-output schemas.
4. Detect/reject plain-text model citations that bypass provision tokens.
5. Implement semantic claim-to-provision support decisions.
6. Fix message running/terminal write ordering.
7. Make unresolved emergency jurisdiction explicit in answer metadata.

## P1 — Canonical typed run and durable operations

1. Introduce a stable `runId` and typed artifact for every pipeline stage.
2. Emit events from the canonical engine if live progress/streaming is reintroduced.
3. Add upstream request cancellation and one overall pipeline deadline.
4. Replace the in-process queue with transactional Firestore leases or a durable queue.
5. Add durable cancellation and temporary-document TTL cleanup.
6. Add structured logs, tracing, alerts and model/token/cost metrics.
7. Remove Firestore N+1 conversation queries and chunk large deletes.
8. Add security headers and a strict CSP.
9. Add CI for deterministic and browser tests.

## P2 — Legal quality

1. Structured case profile with user-stated, inferred and verified provenance.
2. Hybrid lexical/semantic retrieval after deterministic quality baselines.
3. Source hierarchy, effective dates, amendment/repeal tracking and freshness alerts.
4. Expand state-law coverage.
5. Add case law only with an authoritative, licensed source strategy.
6. Build a qualified-lawyer review/audit workflow.
7. Run the full 100-scenario suite repeatedly against staging and obtain lawyer review.

## P3 — Product/scale

- real lawyer handoff and referral workflow
- verified emergency/legal-aid resource directory
- user/org quotas and spending controls
- privacy export, retention and deletion controls
- audit dashboard
- feature flags, canary deployment and rollback automation
- multi-tenant support only after security/compliance readiness

## Release gate

A release must not introduce:

- cross-user/context cache leakage;
- fabricated displayed citations;
- verification failure marked as success;
- cross-user acknowledgement access;
- duplicate terminal answers for one run;
- provider model-not-found loops;
- critical evaluation failures.

Required evidence should include deterministic tests, browser tests, critical 20, full 100 for major pipeline changes, dependency audit, and documented corpus/provider versions.
