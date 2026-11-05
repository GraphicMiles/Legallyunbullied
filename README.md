# Legally Unbullied

A Nigerian legal information assistant that answers from statute and case law,
and shows the provision it used. Ask a question in plain English, and it works
out which area of law applies, retrieves the matching provisions from a Nigerian
law corpus, and drafts an answer with every claim tied to a section.

When the retrieved text does not support the answer, it refuses instead of
guessing. That refusal is a designed state, not an error.

## Why it exists

Legal information online is either a forum post with no source or a paid
database nobody can reach from a phone. The gap is an answer you can check: here
is the law, here is the section, here is what it means for your situation. The
hard part is not generating the sentence, it is refusing to generate the ones
that are not grounded.

## What you can do

- **Ask a question** and get an answer that cites the provisions behind it.
- **Read the citation** next to the claim, with the retrieved text it came from.
- **Work across twenty practice areas**, from police conduct and tenancy to
  employment, family, consumer and cyber matters.
- **See when the assistant refuses**, and why: the answer is withheld when the
  citation check cannot find support in the retrieved text.
- **Keep a history** of past questions in the browser app.

## Running it

```bash
npm install
npm start
```

Then open http://localhost:3000. The server, the browser application and the
pipeline start together, but the pipeline needs configuration: a Firebase
project, a model API key, and the corpus loaded. `.env.example` lists the
variables, and `docs/SYSTEM_REFERENCE.md` is the canonical document for setup,
providers, retrieval, deployment and the endpoint list.

### Tests and evaluation

```bash
npm test                   # deterministic suite through scripts/run-tests.js
npm run test:v2            # guardrails, retrieval evidence, safety acknowledgement
npm run eval:critical      # the critical-scenario evaluation runner
```

The root also holds the browser and chat tests, one file per behaviour, which is
why there are so many `test-*.js` files next to `server.js`.

## What is not here

- This is legal information, not legal advice. The interface says so and the
  answers are written to stay descriptive.
- Coverage is the corpus included in `legal_sources/`. A question outside it is
  answered as unsupported rather than filled in from general knowledge.
- The app needs Firebase and a model provider. There is no offline mode, because
  the pipeline is server side by design.
- Nothing is filed, sent or submitted anywhere. It answers questions.

## How it is built

```
server.js            the Node server and API
server/              retrieval, citation control, the critic stage, providers
public/              the browser application
legal_sources/       the Nigerian law corpus and ingestion inputs
scripts/             runners, evaluation, ingestion and setup
docs/                SYSTEM_REFERENCE.md and design notes
```

`firestore.rules` denies all browser access to `legal_provisions`: the corpus is
served only through the authenticated server pipeline. Rules are deployed with

```bash
firebase deploy --only firestore:rules --project legally-unbullied
```

and `.github/workflows/firestore-rules.yml` does the same from Actions, then
asserts that an anonymous read fails.

### Deploy

`render.yaml` describes the deployed service. The Firebase project and its rules
are configured separately.
