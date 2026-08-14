# Legally Unbullied

**Understand the law. Know your rights. Find help.**

AI-powered legal-information platform for Nigeria. This repo currently contains the **Phase 1 MVP front-end** — the AI agent question/answer chat interface — built as static HTML/CSS/JS.

## What's here

- `index.html` — app shell: sidebar (conversation history, plan status) + main chat area, mobile-responsive (sidebar collapses to an off-canvas drawer under 900px).
- `app.js` — client logic: conversation store (persisted to `localStorage`), a simulated agent pipeline (reading → classifying → searching sources → drafting), and the structured 3-part answer format from the PRD:
  1. **What the law says** (sourced)
  2. **What you can do**
  3. **Escalation verdict** — self-resolvable, or a static outbound link to the [NBA's Find a Lawyer directory](https://www.nigerianbar.org.ng/find-a-lawyer) when a question needs a professional.

## Design system

Three-color theme (black / white / golden-yellow accent), defined entirely through CSS custom properties in `index.html` (`:root`) — colors, spacing, radius, and type scale are tokens, not hardcoded values, so the theme can be re-skinned centrally.

## Running locally

No build step. Serve the folder statically, e.g.:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080/index.html`.

## Status

This is Phase 1 UI scaffolding per the product PRD (AI agent answer, no lawyer directory/matching yet). Phase 2 (lawyer suggestion) and Phase 3 (marketplace) are documented in the PRD but not yet built.
