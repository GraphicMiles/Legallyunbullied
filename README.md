# Legally Unbullied

A Nigerian legal information assistant. You describe your situation in plain
English, and it answers using Nigerian statutes, showing the section behind
each point.

Most legal information online is either a forum answer with no source, or a paid
database that is hard to reach from a phone. Legally Unbullied aims at the
middle ground: an answer you can check, with the law and the section next to it.

## What it does

- Reads your question and works out which area of law it belongs to.
- Retrieves the matching provisions from a Nigerian law corpus held in
  Firestore.
- Drafts an answer in plain language, with each claim tied to a section.
- Shows the source text next to the citation, so you can read it yourself.
- Withholds an answer when the retrieved text does not support one, instead of
  filling the gap with general knowledge.
- Keeps your past questions in the app.

It covers twenty areas of law, including police conduct and arrest, tenancy,
employment, family, consumer, cybercrime, land, and contract.

## What it is not

- It is not a lawyer and it does not give legal advice. It gives legal
  information and says so in the interface.
- It does not file, send, or submit anything anywhere.
- It only knows the laws included in `legal_sources/`. A question outside that
  corpus is treated as unsupported rather than answered from memory.
- It needs Firebase and a model provider to run. There is no offline mode,
  because the work happens on the server.

## Requirements

- Node.js 18 or newer
- A Firebase project, with a web app config and an admin service account
- An API key for at least one supported model provider (Groq or Gemini)

## Run it locally

```bash
cp .env.example .env    # then fill in the values
npm install
npm start
```

Open <http://localhost:3000>.

`.env.example` documents every variable and which ones are required.

Variables fall into four groups:

| Group | What it configures |
|---|---|
| Firebase (client) | The browser app's project settings, served at `/firebase-config.js` |
| Firebase (admin) | Server-side token verification, conversations, and corpus reads |
| Providers | Groq and Gemini keys. OpenRouter and Cerebras are optional |
| Server | Port, environment, retrieval timeout, rate limits, CORS origins |

## The corpus

`legal_sources/` holds the laws the assistant answers from. It contains the
Constitution, a set of hand-cleaned federal acts, Lagos State laws, a bulk
compendium of federal acts, and extracts of CBN consumer and payment
regulations. `legal_sources/SOURCES.md` lists where each document came from.

The corpus is loaded into Firestore by the ingestion scripts:

```bash
npm run corpus:verify   # check the source files parse and match the manifest
npm run ingest          # load the reviewed acts
```

`firestore.rules` denies all browser access to the provisions collection. The
corpus is served only through the authenticated server.

## Evaluation

The repository includes a scenario set and a scoring runner used to check
answer quality and citation behaviour:

```bash
npm run eval:dry       # build the run plan without calling a model
npm run eval:critical  # the release-critical scenarios
npm run eval:full      # the full scenario sweep
npm run eval:report    # score the results into JSON and Markdown
```

These call the live API with real credentials and consume provider quota.

## Deployment

`render.yaml` describes the web service. Firestore rules are deployed
separately:

```bash
firebase deploy --only firestore:rules --project legally-unbullied
```

`.github/workflows/firestore-rules.yml` runs the same deploy from Actions and
then checks that an anonymous read of the corpus is refused. It needs the
repository secrets `FIREBASE_TOKEN` and `FIREBASE_API_KEY`.

## Project layout

```
server.js          Express server, routes, startup
server/            retrieval, citation checks, review stage, model providers
public/            the browser app and its components
legal_sources/     the Nigerian law corpus and source notes
scripts/           ingestion, cleaning, verification, and evaluation
```

## Licence

No licence has been chosen for this repository yet.
