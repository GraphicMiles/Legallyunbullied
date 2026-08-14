/**
 * One-time bulk classification: tag every Act title from the PLAC "2004 Laws
 * of Nigeria" index with a practice_area from server/practiceAreas.js.
 *
 * This is classification of ~550 SHORT TITLES (not full statute text), done
 * once, in batches, so it's cheap relative to the per-question classify calls
 * the live app makes. Output is a manifest consumed by scripts/bulk-ingest.js
 * — it does NOT touch Firestore.
 *
 * Usage: node scripts/classify-acts.js
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { getClient, CLASSIFY_MODEL } = require("../server/groq");
const { PRACTICE_AREAS, PRACTICE_AREA_KEYS } = require("../server/practiceAreas");

const INDEX_PATH = path.join(__dirname, "../legal_sources/manifest/placng_index.json");
const OUT_PATH = path.join(__dirname, "../legal_sources/manifest/placng_classified.json");
const BATCH_SIZE = 40;

const SYSTEM_PROMPT = `You are sorting Nigerian federal Act TITLES (not full text, just the title) into practice-area buckets for a legal-information app's retrieval system.

Valid practice_area values: ${JSON.stringify(PRACTICE_AREA_KEYS)}
${PRACTICE_AREAS.map((p) => `- "${p.key}": ${p.description}`).join("\n")}

You will be given a JSON array of {"i": <index>, "name": "<ACT TITLE>"}. Respond with ONLY a JSON object of the exact shape {"results": [{"i": <index>, "practice_area": "<key>"}, ...]} — one entry per input item, same order, no omissions, no extra prose, no markdown fences.`;

function parseModelJson(content) {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  return JSON.parse(trimmed);
}

async function classifyBatch(client, items) {
  const completion = await client.chat.completions.create({
    model: CLASSIFY_MODEL,
    temperature: 0,
    max_tokens: 2000,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(items) },
    ],
  });
  const parsed = parseModelJson(completion.choices[0].message.content);
  return parsed.results || [];
}

async function main() {
  const all = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
  const client = getClient();
  if (!client) {
    console.error("GROQ_API_KEY not set.");
    process.exit(1);
  }

  let existing = [];
  if (fs.existsSync(OUT_PATH)) {
    existing = JSON.parse(fs.readFileSync(OUT_PATH, "utf8"));
    console.log(`Resuming — ${existing.length} already classified.`);
  }
  const doneIdx = new Set(existing.map((e) => e.i));

  const pending = all.map((a, i) => ({ i, name: a.name })).filter((a) => !doneIdx.has(a.i));
  console.log(`${pending.length} remaining to classify (of ${all.length} total).`);

  for (let start = 0; start < pending.length; start += BATCH_SIZE) {
    const batch = pending.slice(start, start + BATCH_SIZE);
    let results;
    try {
      results = await classifyBatch(client, batch);
    } catch (err) {
      console.error(`Batch at ${start} failed: ${err.status || ""} ${err.message}. Retrying once...`);
      await new Promise((r) => setTimeout(r, 3000));
      try {
        results = await classifyBatch(client, batch);
      } catch (err2) {
        console.error(`Batch at ${start} failed again: ${err2.message}. Marking as "general" fallback.`);
        results = batch.map((b) => ({ i: b.i, practice_area: "general" }));
      }
    }
    const byIdx = new Map(results.map((r) => [r.i, r.practice_area]));
    for (const b of batch) {
      let pa = byIdx.get(b.i);
      if (!PRACTICE_AREA_KEYS.includes(pa)) pa = "general";
      existing.push({ i: b.i, name: b.name, practice_area: pa });
    }
    fs.writeFileSync(OUT_PATH, JSON.stringify(existing.sort((a, b) => a.i - b.i), null, 2));
    console.log(`Classified ${existing.length}/${all.length}`);
  }

  console.log("Done. Written to", OUT_PATH);
  const counts = {};
  for (const e of existing) counts[e.practice_area] = (counts[e.practice_area] || 0) + 1;
  console.log(counts);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
