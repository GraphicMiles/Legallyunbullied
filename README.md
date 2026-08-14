# Legally Unbullied

**Understand the law. Know your rights. Find help.**

AI-powered legal-information platform for Nigeria. This repo currently contains the **Phase 1 MVP** — the AI agent question/answer chat interface — served as a single Node/Express web service.

## Structure

- `server.js` — Express server. Serves the static front-end from `public/`, exposes `/healthz`, and has a stub `POST /api/chat` route reserved for the real AI orchestration logic (see PRD, section 3).
- `public/index.html` — app shell: sidebar (conversation history, plan status) + main chat area, mobile-responsive (sidebar collapses to an off-canvas drawer under 900px).
- `public/app.js` — client logic: conversation store (persisted to `localStorage`), a simulated agent pipeline (reading → classifying → searching sources → drafting), and the structured 3-part answer format from the PRD:
  1. **What the law says** (sourced)
  2. **What you can do**
  3. **Escalation verdict** — self-resolvable, or a static outbound link to the [NBA's Find a Lawyer directory](https://www.nigerianbar.org.ng/find-a-lawyer) when a question needs a professional.
- `render.yaml` — Render Blueprint: deploys this repo as one Web Service (Node runtime, `npm install` / `npm start`).

Everything currently runs client-side against mock data — there's no real AI call yet. `POST /api/chat` is a placeholder so the front-end and backend can live in the same deploy from day one; wire the real orchestration logic into that route when it's ready and switch `public/app.js` to call it instead of its local mock classifier.

## Design system

Three-color theme (black / white / golden-yellow accent), defined entirely through CSS custom properties in `public/index.html` (`:root`) — colors, spacing, radius, and type scale are tokens, not hardcoded values, so the theme can be re-skinned centrally.

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
