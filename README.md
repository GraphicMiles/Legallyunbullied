# Legally Unbullied

**Understand the law. Know your rights. Find help.**

AI-powered legal-information platform for Nigeria. This repo currently contains the **Phase 1 MVP** — the AI agent question/answer chat interface — served as a single Node/Express web service.

## Structure

- `server.js` — Express server. Serves the static front-end from `public/`, exposes `/healthz`, and has a stub `POST /api/chat` route reserved for the real AI orchestration logic (see PRD, section 3).
- `public/index.html` — app shell: sidebar (conversation history, plan status) + main chat area, mobile-responsive (sidebar collapses to an off-canvas drawer under 900px).
- `public/app.js` — client logic: conversation store (persisted to `localStorage`), a simulated agent pipeline, and the structured 3-part answer format from the PRD:
  1. **What the law says** (streamed in live, with expandable sourced context cards)
  2. **What you can do**
  3. **Escalation verdict** — self-resolvable, or a static outbound link to the [NBA's Find a Lawyer directory](https://www.nigerianbar.org.ng/find-a-lawyer) when a question needs a professional.

  The "thinking" trace is a real timeline (not a spinner): per-step icons, a live elapsed timer, tool-call chips showing which sources were checked, and a collapsed "Thought for X.Xs" summary once done — modeled after modern agentic UI patterns (expandable reasoning traces, streamed markdown answers, context cards, follow-up suggestions). The answer streams in section-by-section with live markdown rendering, then reveals expandable source cards, the verdict, follow-up question chips, and a copy/feedback action row.
- `render.yaml` — Render Blueprint: deploys this repo as one Web Service (Node runtime, `npm install` / `npm start`).

Everything currently runs client-side against mock data — there's no real AI call yet. `POST /api/chat` is a placeholder so the front-end and backend can live in the same deploy from day one; wire the real orchestration logic into that route when it's ready and switch `public/app.js` to call it instead of its local mock classifier.

## Design system

Three-color theme (black / white / golden-yellow accent), defined entirely through CSS custom properties in `public/index.html` (`:root`) — colors, spacing, radius, and type scale are tokens, not hardcoded values, so the theme can be re-skinned centrally.

## Environment variables

The app reads Firebase's web client config from environment variables — never hardcoded, never committed.

1. Copy `.env.example` to `.env` and fill in the values from your Firebase project's web app config (Firebase Console → Project settings → General → Your apps).
2. `server.js` loads `.env` locally (via `dotenv`) and exposes the values to the browser at runtime through `GET /firebase-config.js`, which sets `window.__FIREBASE_CONFIG__` before `public/firebase-init.js` initializes the SDK.
3. In Render, set the same variables under the service's **Environment** tab (or, if deploying via the `render.yaml` Blueprint, Render will prompt for each one — they're declared with `sync: false` so their values are never stored in the repo).

Required keys (see `.env.example`): `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_APP_ID`.

Note: Firebase web API keys aren't secret by design (they're scoped by Firebase Security Rules and authorized domains, not by being hidden) — they're still kept out of the repo here so the same code can point at different Firebase projects (dev/staging/prod) without a code change.

Firebase is initialized (`window.firebaseApp`, `window.firebaseAuth`, `window.firebaseDb`) but **not yet used** — the app still runs entirely on `localStorage` + client-side mock data. This is groundwork for the real Auth/Firestore persistence described in the PRD; nothing about the current chat experience depends on it yet.

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
3. Render reads `render.yaml` and pre-fills a Web Service (Node, `npm install` / `npm start`, health check on `/healthz`) — click **Apply**

Or set it up manually as a **Web Service**:
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/healthz`

## Status

Phase 1 UI scaffolding per the product PRD (AI agent answer, no lawyer directory/matching yet). Phase 2 (lawyer suggestion) and Phase 3 (marketplace) are documented in the PRD but not yet built.
