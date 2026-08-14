# Legally Unbullied

**Understand the law. Know your rights. Find help.**

AI-powered legal-information platform for Nigeria. This repo currently contains the **Phase 1 MVP** — the AI agent question/answer chat interface — served as a single Node/Express web service.

## Structure

- `server.js` — Express server. Serves the static front-end from `public/`, exposes `/healthz`, and mounts the real AI pipeline at `POST /api/chat` (see below).
- `server/firebaseAdmin.js` — Firebase Admin SDK init (server-side only, from `FIREBASE_SERVICE_ACCOUNT_JSON`).
- `server/groq.js` — Groq client (OpenAI-SDK compatible, open-weight models on fast inference hardware), configurable model IDs.
- `server/chatRoute.js` — the pipeline itself: Groq classifies the question -> Firestore returns matching provisions -> Groq drafts the answer, instructed to cite only what it was given.
- `scripts/pdf-to-text.js` / `scripts/ingest.js` — one-Act-at-a-time ingestion pipeline (see below).
- `scripts/bulk-fetch-clean.js` / `scripts/lib/textClean.js` / `scripts/classify-acts.js` / `scripts/bulk-ingest-firestore.js` — the bulk pipeline used to index the ~550-Act PLAC "2004 Laws of Nigeria" federal compendium (see "Bulk-indexing the federal statute book" below).
- `server/practiceAreas.js` — the shared practice-area taxonomy (19 categories) used by both the live classifier prompt and the ingestion scripts, so they can never drift out of sync.
- `public/index.html` — app shell: sidebar (conversation history, plan status, account) + main chat area, mobile-responsive (sidebar collapses to an off-canvas drawer under 900px).
- `public/app.js` — loaded as an ES module. Conversation store (persisted to `localStorage`), calls the real `POST /api/chat` endpoint, and renders the structured 3-part answer format from the PRD:
  1. **What the law says** (streamed in live, with expandable sourced context cards)
  2. **What you can do**
  3. **Escalation verdict** — self-resolvable, or a static outbound link to the [NBA's Find a Lawyer directory](https://www.nigerianbar.org.ng/find-a-lawyer) when a question needs a professional.

  The "thinking" trace is a real timeline (not a spinner): per-step icons, a live elapsed timer, tool-call chips showing which sources were checked, and a collapsed "Thought for X.Xs" summary once done. The single real classify->retrieve->draft round trip is mapped onto that 4-step visual pacing, then the answer streams in section-by-section with live markdown rendering, then reveals expandable source cards, the verdict, follow-up question chips, and a copy/feedback action row.

  Also handles: per-conversation clear/delete (kebab menu in the sidebar, plus a one-click clear icon in the topbar for the active chat) with a confirm dialog before anything destructive; and Firebase Auth (email/password + Google) via a modal, with a sidebar sign-in button that becomes a profile row once signed in, and a small avatar in the topbar.
- `render.yaml` — Render Blueprint: deploys this repo as one Web Service (Node runtime, `npm install` / `npm start`).

## The AI pipeline (`POST /api/chat`)

No vector database. Retrieval is a Firestore filter by practice area + jurisdiction, narrowed further by a keyword pre-filter (extracted during classification) once a category has too many sections to hand an LLM in one go — see `server/legalCorpus.js`. Revisit with real vector search if a single practice area's corpus grows past what keyword filtering can reasonably narrow down.

1. **Classify** — Groq (`GROQ_MODEL_CLASSIFY`, default `llama-3.1-8b-instant`) returns `{ practice_area, jurisdiction, urgency, summary }` as structured JSON.
2. **Retrieve** — `server/legalCorpus.js` queries Firestore's `legal_provisions` collection for that practice area, keeping provisions that match the jurisdiction or are Federal/unscoped.
3. **Empty-corpus guard** — if nothing's been ingested for that practice area yet, the endpoint says so explicitly (`corpusEmpty: true`) instead of letting the model invent an answer with no grounding.
4. **Draft** — Groq (`GROQ_MODEL_DRAFT`, default `llama-3.3-70b-versatile`) drafts `{ lawMd, actionsMd, sources[], escalate, escalateReason }`, instructed to cite only the Acts/sections it was actually given.

(We evaluated xAI/Grok first, then briefly OpenAI, before landing on Groq — cheap, fast, and its JSON Object Mode is exactly what `chatRoute.js` already used, so no prompt/logic changes were needed, just the client config in `server/groq.js`. That file and `server/chatRoute.js`'s two model constants are the only things that would need to change to swap providers again.)

## Ingesting legal sources

`legal_sources/` holds downloaded source documents, organized by category, with full provenance in `legal_sources/SOURCES.md`. There are two ingestion paths:

**One Act at a time** (for a hand-picked, hand-reviewed source):
1. Extract text from a source PDF:
   ```bash
   npm run pdf-to-text -- --file sources/tenancy-law-2011.pdf
   ```
   Review/clean the resulting `.txt` — this is the point to fix OCR noise, headers/footers, etc. before it becomes retrievable content.
2. Ingest it into Firestore, split into per-section chunks:
   ```bash
   npm run ingest -- \
     --file sources/tenancy-law-2011.txt \
     --act "Lagos Tenancy Law 2011" \
     --practice-area tenancy \
     --jurisdiction "Lagos State" \
     --source-url "https://..." \
     --dry-run   # drop this flag once the parsed section preview looks right
   ```
   `practice-area` must be one of the 19 keys in `server/practiceAreas.js` — kept in sync with the classifier's categories in `server/chatRoute.js` automatically (both import the same module).

Section splitting is a regex tuned to common Nigerian statute numbering (`13.—(1) ...`) — tune `SECTION_HEADER` in `scripts/ingest.js` per document if a source uses different formatting.

## Bulk-indexing the federal statute book

To go beyond a handful of hand-picked Acts, `scripts/bulk-fetch-clean.js` + `scripts/bulk-ingest-firestore.js` automate the whole PLAC "2004 Laws of Nigeria" compendium (~550 federal Acts, both PDF and HTML sources):

1. `node scripts/classify-acts.js` — one-time bulk LLM classification of every Act *title* (not full text) into a `server/practiceAreas.js` category. Cheap relative to per-question classification since it's just titles, batched. Output: `legal_sources/manifest/placng_classified.json`.
2. `node scripts/bulk-fetch-clean.js [--start N] [--limit N]` — downloads every Act (PDF or `print.php` HTML), converts to text, and runs it through `scripts/lib/textClean.js`'s generic auto-cleaner, which:
   - Splits detected section-number headers into "runs" (a restart back down to 1/2 after climbing much higher marks a new run) to distinguish a repeated Arrangement-of-Sections ToC from the real body, using content density (ToC entries are short titles; real sections have substantive prose) to decide which run is which — this works across both PDF- and HTML-sourced text without depending on a specific markup convention.
   - Additionally cuts at a bracketed `[Commencement]` clause when present (the conventional marker between a ToC and the real numbered sections in Nigerian statutes) and at explicit trailing markers (`SCHEDULE`, `ORDER <roman numeral>`, `APPENDIX`, `SUBSIDIARY LEGISLATION`, etc.) so Rules/Schedules that re-number from 1 don't collide with real section numbers.
   - Writes one cleaned `.txt` per Act to `legal_sources/federal_acts_bulk/` plus per-doc stats (section count, whether numbering came out monotonic, first/last section number) into `legal_sources/manifest/staged.json`, so results can be spot-checked before anything touches Firestore. Raw downloads are cached under `legal_sources/federal_acts_bulk/_raw/` (git-ignored — regeneratable, not committed) so re-runs and `--reclean` (re-run the cleaner against cached raw files with zero network calls) are fast.
3. `node scripts/bulk-ingest-firestore.js [--start N] [--limit N] [--dry-run]` — chunks each staged Act by section (same chunker as `scripts/ingest.js`) and batch-writes to Firestore, tagged `jurisdiction: "Federal"` and `bulk_source: "placng_2004_compendium"`. Resumable via `legal_sources/manifest/ingest_progress.json`.

This is a fully automated, best-effort pipeline across ~550 structurally-inconsistent government documents from different eras/scanners — not the same level of individual hand-review given to the first 5 flagship Acts (Lagos Tenancy Law, Labour Act, ACJA 2015, National Industrial Court Act, Lagos Small Claims Practice Direction). Spot-checked quality: of 542 unique Acts successfully fetched (3 PDFs had no extractable text layer, likely scanned images needing OCR — logged, not ingested), roughly 84% produced a perfectly clean, monotonically-numbered section sequence starting at section 1; the rest still captured real section content but occasionally missed the Act's first section or two, or had a minor numbering hiccup, due to one-off formatting quirks in specific source documents. See `legal_sources/SOURCES.md` for exact current counts.

## Design system

Three-color theme (black / white / golden-yellow accent), defined entirely through CSS custom properties in `public/index.html` (`:root`) — colors, spacing, radius, and type scale are tokens, not hardcoded values, so the theme can be re-skinned centrally.

## Environment variables

Nothing sensitive is hardcoded or committed — everything below is read from environment variables, loaded via `.env` locally (already git-ignored) and set directly in Render's dashboard in production.

Copy `.env.example` to `.env` and fill in:

**Firebase web config** (`FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_APP_ID`) — from Firebase Console → Project settings → General → Your apps. `server.js` exposes these to the browser at runtime through `GET /firebase-config.js`, which sets `window.__FIREBASE_CONFIG__` before `public/firebase-init.js` initializes the client SDK. Not secret by design (scoped by Firebase Security Rules + authorized domains), but still env-driven so the same code can point at different Firebase projects without a code change.

**`GROQ_API_KEY`** — from [console.groq.com/keys](https://console.groq.com/keys). Used by `server/groq.js` for both classification and drafting calls.

**`FIREBASE_SERVICE_ACCOUNT_JSON`** — genuinely secret. Generate at Firebase Console → Project Settings → Service Accounts → Generate new private key, then paste the entire downloaded JSON file as a single-line string. This grants full server-side Firestore/Auth/Storage access, bypassing security rules — never expose it to the client, never log it, never commit it. If it's ever pasted somewhere insecure (chat, a public repo, etc.), rotate it immediately from that same Service Accounts page.

In Render, set all of these under the service's **Environment** tab, or via **Add from .env** if you have a local `.env` file to import. If deploying via the `render.yaml` Blueprint, Render will prompt for each one — they're declared with `sync: false` so values are never stored in the repo.

Firebase Auth is wired up end-to-end: `public/app.js` is loaded as an ES module (see index.html) specifically so its auth imports and `firebase-init.js`'s own module execute in guaranteed document order — no race on `window.firebaseAuth` existing. Email/password sign-in/sign-up and Google sign-in both work against the real project (verified live: created and deleted a real test user via the Admin SDK). Conversation history/messages still live in `localStorage`, not Firestore — signing in currently only changes the sidebar/topbar identity UI, it doesn't yet sync conversations to a per-user Firestore document. That's the natural next step if cross-device history matters.

## Running locally

```bash
npm install
npm start
```

Then open `http://localhost:3000`.

## Deploying to Render

This repo includes a `render.yaml` Blueprint, so the easiest path is:

1. Render Dashboard → **New → Blueprint**
2. Connect this repo
3. Render reads `render.yaml` and pre-fills a Web Service (Node, `npm install` / `npm start`, health check on `/healthz`), and prompts for the env vars listed above — click **Apply**

Or set it up manually as a **Web Service**:
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/healthz`

## Status

- Front-end: Phase 1 UI complete per the product PRD, wired to the real `/api/chat` pipeline (no more mock data). Streaming pacing tuned for real answer lengths, with continuous auto-scroll during generation. Per-chat clear/delete and Firebase Auth (email/password + Google) are both live.
- Backend: `POST /api/chat` pipeline (classify -> retrieve -> draft) verified working end-to-end against real Firestore data and Groq — real questions get real, correctly-cited answers, now across a much broader practice-area taxonomy (19 categories, see `server/practiceAreas.js`) than the original 5.
- Legal sources: **8,150 real statute sections live in Firestore right now** (verified via a Firestore `count()` aggregation query), spanning the original 5 hand-reviewed flagship Acts (Lagos Tenancy Law, Labour Act + National Industrial Court Act, ACJA 2015, Lagos Small Claims Practice Direction — 658 sections), the Constitution (5th-Alteration-updated text, 315 sections, hand-verified section boundaries), and a first tranche of ~273 Acts (~7,177 sections) from the bulk PLAC "2004 Laws of Nigeria" federal compendium (~550 Acts total — see "Bulk-indexing the federal statute book" above). **The remaining ~270 bulk Acts are fully fetched, cleaned, and staged (`legal_sources/manifest/staged.json`) but not yet written to Firestore** — ingestion is currently blocked by the Firestore project's daily Spark (free-tier) write/read quota, which this session's heavy indexing work (delete + re-ingest of ~12,000 documents, plus verification queries) exhausted; confirmed via a raw REST call returning `429 RESOURCE_EXHAUSTED` (the Admin SDK was silently hanging instead of surfacing this, now fixed with an explicit timeout in `scripts/bulk-ingest-firestore.js` and `scripts/ingest.js`). Resuming just requires re-running `node scripts/bulk-ingest-firestore.js` once the daily quota resets, or upgrading the Firebase project to the Blaze (pay-as-you-go) plan to remove the cap entirely (usage at this scale should still cost close to nothing under Blaze's own free monthly allowance).
- Known content gaps: the Cybercrimes Act 2015 is downloaded, cleaned, and ready (`legal_sources/federal_acts/cybercrimes-act-2015-cleaned.txt`) but not yet ingested (blocked by the same quota issue above) — tagged for the `criminal_offences` practice area once it goes in.
- Auth: sign-in/sign-up/Google/logout all work against the real Firebase project. Not yet done: syncing conversation history to Firestore per-user (it's still `localStorage`-only, so it doesn't follow a signed-in user across devices).
- Not yet done: finishing the bulk ingestion above; syncing conversation history to Firestore; Phase 2 (lawyer suggestion) and Phase 3 (marketplace) per the PRD.
