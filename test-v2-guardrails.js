/** Phase 0-2 regression guardrails: cache isolation and fail-closed verification. */
const assert = require("assert");
const express = require("express");
const http = require("http");

let mode = "standard";
let draftCalls = 0;

const STANDARD = {
  is_legal_question: true, practice_area: "employment", jurisdiction: "Federal",
  jurisdiction_status: "clear", urgency: "Low", summary: "pay question", keywords: ["wages"],
  key_issues: [], needs_sourcing: true, complexity: "Low", route: "simple",
  reasoning_approach: "", stakeholders: [], potential_remedies: [],
};
const HIGH_RISK = {
  ...STANDARD, practice_area: "criminal_rights", urgency: "High", summary: "detention",
  keywords: ["detention", "liberty"],
};

const provisions = [
  { id: "labour-s11", act: "Labour Act", section: "11", text: "Wages shall be paid according to the agreed terms.", jurisdiction: "Federal" },
  { id: "constitution-s35", act: "Constitution of the Federal Republic of Nigeria 1999", section: "35(1)", text: "Every person shall be entitled to personal liberty.", jurisdiction: "Federal" },
];

const fakeClient = {
  chat: { completions: { create: async ({ messages }) => {
    const sys = messages?.[0]?.content || "";
    const json = (o) => ({ choices: [{ message: { content: JSON.stringify(o) } }] });
    if (sys.includes("determine if this is a legal question or casual")) {
      return json(mode === "high-critique-failure" ? HIGH_RISK : STANDARD);
    }
    if (sys.includes("legal retrieval relevance judge")) {
      if (mode === "relevance-failure") throw new Error("judge unavailable");
      return json({ relevant: mode === "high-critique-failure" ? [1, 2] : [1], irrelevant: [], relevance_score: 0.95, sufficient: true, reason: "direct authority" });
    }
    if (sys.includes("quality reviewer")) {
      if (mode === "high-critique-failure") throw new Error("critic unavailable");
      return json({ quality: 0.9, legal_safety: 0.9, issues: [], passed: true });
    }
    if (sys.includes("Generate a very short title")) {
      return { choices: [{ message: { content: "Unpaid salary claim" } }] };
    }
    draftCalls += 1;
    if (mode === "high-critique-failure") {
      return json({
        lawMd: "Personal liberty is protected.", actionsMd: "- Keep records\n- Contact a lawyer",
        sources: [
          { label: "Labour Act, s.11", excerpt: "model text ignored" },
          { label: "Constitution of the Federal Republic of Nigeria 1999, s.35(1)", excerpt: "model text ignored" },
        ],
        escalate: true, escalateReason: "High risk", followUps: [],
      });
    }
    const historyText = messages?.[1]?.content || "";
    return json({
      lawMd: `Wages are governed by the Labour Act. ${historyText.includes("CASE-B") ? "B" : historyText.includes("CASE-A") ? "A" : "standalone"}`,
      actionsMd: "- Keep records\n- Request payment",
      sources: [{ label: "Labour Act, s.11", excerpt: "model text ignored" }],
      escalate: false, escalateReason: "Straightforward", followUps: [],
    });
  } } },
};

const groqPath = require.resolve("./server/groq");
const geminiPath = require.resolve("./server/gemini");
const openrouterPath = require.resolve("./server/openrouter");
const cerebrasPath = require.resolve("./server/cerebras");
const corpusPath = require.resolve("./server/legalCorpus");
const firebasePath = require.resolve("./server/firebaseAdmin");

require.cache[groqPath] = { id: groqPath, filename: groqPath, loaded: true, exports: { getClient: () => fakeClient, CLASSIFY_MODEL: "classify", DRAFT_MODEL: "draft", DRAFT_MODEL_FALLBACK: "draft-fallback" } };
require.cache[geminiPath] = { id: geminiPath, filename: geminiPath, loaded: true, exports: { getClient: () => null, GEMINI_CLASSIFY_MODEL: "g", GEMINI_DRAFT_MODEL: "g", GEMINI_CHAT_MODEL: "g" } };
require.cache[openrouterPath] = { id: openrouterPath, filename: openrouterPath, loaded: true, exports: { getClient: () => null, OPENROUTER_CLASSIFY_MODEL: "o", OPENROUTER_DRAFT_MODEL: "o", OPENROUTER_CHAT_MODEL: "o" } };
require.cache[cerebrasPath] = { id: cerebrasPath, filename: cerebrasPath, loaded: true, exports: { getClient: () => null, CEREBRAS_CLASSIFY_MODEL: "c", CEREBRAS_DRAFT_MODEL: "c", CEREBRAS_CHAT_MODEL: "c" } };
require.cache[corpusPath] = { id: corpusPath, filename: corpusPath, loaded: true, exports: {
  findProvisions: async () => provisions,
  findProvisionsBroad: async () => ({ provisions, categories: ["employment", "general"] }),
  COLLECTION: "legal_provisions", invalidateCache() {}, getCacheStats: () => ({}), cleanupCache() {},
} };
require.cache[firebasePath] = { id: firebasePath, filename: firebasePath, loaded: true, exports: { getFirestore: () => null } };

const chatRoute = require("./server/chatRoute");

function post(body, uid = "u1", path = "/api/chat") {
  return new Promise((resolve) => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.uid = uid; next(); });
    app.use(chatRoute);
    const server = http.Server(app);
    server.listen(0, () => {
      const payload = JSON.stringify(body);
      const req = http.request({ host: "127.0.0.1", port: server.address().port, path, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } }, (res) => {
        let buf = "";
        res.on("data", (c) => buf += c);
        res.on("end", () => { server.close(); resolve({ status: res.statusCode, body: JSON.parse(buf) }); });
      });
      req.on("error", (err) => { server.close(); throw err; });
      req.end(payload);
    });
  });
}

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); }
  catch (err) { failures++; console.log(`  FAIL  ${name}\n        ${err.stack || err.message}`); }
}

(async () => {
  console.log("\n=== V2 phase 0-2 guardrails ===\n");

  await check("history-dependent answers never use the global question cache", async () => {
    chatRoute.__testing.clearQuestionCache(); mode = "standard"; draftCalls = 0;
    const a = await post({ question: "What should I do next?", history: [{ role: "user", content: "CASE-A" }] }, "user-a");
    const b = await post({ question: "What should I do next?", history: [{ role: "user", content: "CASE-B" }] }, "user-b");
    assert.strictEqual(draftCalls, 2, "each contextual case must be drafted independently");
    assert.ok(a.body.result.lawMd.endsWith("A"));
    assert.ok(b.body.result.lawMd.endsWith("B"));
  });

  await check("standalone context-free questions remain safely cacheable", async () => {
    chatRoute.__testing.clearQuestionCache(); mode = "standard"; draftCalls = 0;
    await post({ question: "When must wages be paid?", history: [] });
    await post({ question: "When must wages be paid?", history: [] });
    assert.strictEqual(draftCalls, 1, "identical standalone question should reuse verified artifact");
  });

  await check("relevance-provider outage fails closed without drafting", async () => {
    chatRoute.__testing.clearQuestionCache(); mode = "relevance-failure"; draftCalls = 0;
    const response = await post({ question: "What does the law say about wages?", history: [] });
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.evidence.sufficient, false);
    assert.strictEqual(response.body.evidence.validationUnavailable, true);
    assert.strictEqual(response.body.result.escalate, true);
    assert.strictEqual(draftCalls, 0, "unverified evidence must not reach drafting");
  });

  await check("high-risk critique outage requires safety acknowledgment", async () => {
    chatRoute.__testing.clearQuestionCache(); chatRoute.__testing.clearProviderCooldowns(); mode = "high-critique-failure"; draftCalls = 0;
    const response = await post({ question: "The police detained me", history: [] });
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.safetyAck, true);
    assert.ok(response.body.ackToken);
  });

  await check("title generation accepts the plain-text format it requests", async () => {
    mode = "standard";
    const response = await post({ question: "My employer has not paid me" }, "u1", "/api/generate-title");
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.title, "Unpaid salary claim");
  });

  console.log(failures ? `\n${failures} V2 GUARDRAIL TEST(S) FAILED` : "\nALL V2 GUARDRAIL TESTS PASSED");
  process.exit(failures ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
