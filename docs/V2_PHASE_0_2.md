# V2 Phase 0–2 — Correctness Baseline and Guardrails

> Started: 2026-08-17

## Objective

Every delivered legal answer must remain inside deterministic evidence boundaries:

```
retrieve → rank → validate → draft → resolve provision IDs → safety decision
```

No memory, autonomous orchestration, or parallel retrieval is introduced in these phases.

## Phase 0 baseline

The committed legacy report (`server/eval/results.json`, 2026-08-16) covered 10 scenarios:

- overall score: 0.7174
- pass rate: 70%
- failures: consumer defective goods, traffic fake checkpoint, minimum wage
- weakest aggregate dimension: expected statutory citations (0.25)

The V2 critical release subset is stored in `server/eval/critical20.json`. It selects 20 multi-turn conversations from the 100-scenario suite across police, tenancy, employment, family, consumer, cyber, property, human rights, contract, inheritance, immigration, and complex fraud.

Run live when eval Firebase credentials and provider credentials are available:

```bash
npm run eval:critical
```

Live results are intentionally not fabricated in an environment without those credentials. Deterministic P0–P2 guardrails run with:

```bash
npm test
```

## Phase 1 containment

Implemented guardrails:

- History-dependent answers bypass the global question cache.
- Context-free cache entries include practice area and preserve critique state.
- Relevance-provider failure returns an honest unverified/escalated response without drafting.
- Critique-provider failure is never marked as passed.
- High-risk critique failure enters safety acknowledgement.
- Safety tokens use cryptographic randomness and are bound to the authenticated UID.
- Acknowledged results are persisted by the server.
- Simple non-high-risk factual routes may be sufficient with one controlling provision; complex/high-risk routes retain a two-source floor.
- Durable background job start/end writes are awaited; queue dedupe IDs are released after completion.

## Phase 2 evidence integrity

Implemented guardrails:

- Candidate provisions receive stable `provisionId` values (existing Firestore document ID is the compatibility fallback).
- Deterministic lexical ranking rewards title, heading, phrase, keyword-coverage, and jurisdiction matches.
- Results are diversified across authorities before the model shortlist is capped.
- A failed relevance gate forces actual broadening into configured adjacent areas and `general`; raw primary candidate count cannot short-circuit it.
- Draft prompts require exact `[[provisionId]]` tokens, `provisionIds`, and claim-to-provision links.
- The server—not the model—resolves source labels, excerpts, URLs, jurisdiction, and source version.
- Unknown IDs and unsupported claim links fail citation integrity, remove invented source cards, downgrade evidence, and force escalation/safety review.
- V1 label output remains accepted only when both Act and section exactly map to evidence retrieved for that run, preventing a breaking deployment while providers transition to the V2 schema.

## Explicit limitations before Phase 3+

- Claim-to-provision linkage is deterministic, but full semantic claim-support adjudication still relies on the relevance and safety review boundaries. A later canonical pipeline stage should make claim-support review its own typed artifact.
- The old SSE implementation remains separate and must not become the primary client path before the canonical runtime unifies it with REST.
- Retrieval remains sequential by design until the critical benchmark proves quality.
- Existing corpus documents should eventually persist explicit canonical IDs and authority-version metadata instead of relying on Firestore document IDs and optional fields.

## Regression gates

A Phase 0–2 change is rejected when it allows any of the following:

1. Contextual cache reuse across histories or users.
2. Relevance/critique outage interpreted as verification success.
3. Unknown evidence ID rendered as a public citation.
4. Cross-user safety-token use.
5. A simple one-authority factual answer rejected solely by the old universal two-source rule.
6. A relevance-rejected primary set preventing broadened retrieval.
7. A completed job overwritten by a delayed running-state write.
