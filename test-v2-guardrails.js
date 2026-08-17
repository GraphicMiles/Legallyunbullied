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
      if (mode === "all-providers-fail") throw new Error("classifier unavailable");
      return json(["high-critique-failure", "high-pass"].includes(mode) ? HIGH_RISK : STANDARD);
    }
    if (sys.includes("legal retrieval relevance judge")) {
      if (["relevance-failure", "all-providers-fail"].includes(mode)) throw new Error("judge unavailable");
      const conflicts = mode === "conflicting-evidence" ? ["Federal and state provisions conflict"] : [];
      return json({ relevant: ["high-critique-failure", "high-pass"].includes(mode) ? [1, 2] : [1], irrelevant: [], relevance_score: 0.95, sufficient: true, conflicts, reason: conflicts.length ? "material conflict" : "direct authority" });
    }
    if (sys.includes("quality reviewer")) {
      if (mode === "high-critique-failure") throw new Error("critic unavailable");
      const status = mode === "unsupported-claim" ? "unsupported" : "supported";
      const supportingQuote = mode === "invented-span" ? "This sentence does not exist in any provision" : (["high-critique-failure", "high-pass"].includes(mode) ? "Every person shall be entitled to personal liberty" : "Wages shall be paid");
      return json({ quality: 0.9, legal_safety: status === "supported" ? 0.9 : 0.5, issues: status === "supported" ? [] : ["unsupported claim"], claim_support: [{ claimId: "claim-1", status, supportingQuote: status === "supported" ? supportingQuote : "", reason: status }], passed: status === "supported" });
    }
    if (sys.includes("Generate a very short title")) {
      return { choices: [{ message: { content: "Unpaid salary claim" } }] };
    }
    draftCalls += 1;
    if (mode === "idempotency") await new Promise((resolve) => setTimeout(resolve, 50));
    if (mode === "malformed-draft") return json({ lawMd: "incomplete" });
    if (["high-critique-failure", "high-pass"].includes(mode)) {
      return json({
        lawMd: "Personal liberty is protected.", actionsMd: "- Keep records\n- Contact a lawyer",
        provisionIds: ["labour-s11", "constitution-s35"],
        claims: [{ claimId: "claim-1", text: "Personal liberty is protected.", provisionIds: ["constitution-s35"] }],
        sources: [],
        escalate: true, escalateReason: "High risk", followUps: [],
      });
    }
    const historyText = messages?.[1]?.content || "";
    return json({
      lawMd: `Wages are governed by the Labour Act. ${historyText.includes("CASE-B") ? "B" : historyText.includes("CASE-A") ? "A" : "standalone"}`,
      actionsMd: "- Keep records\n- Request payment",
      provisionIds: ["labour-s11"],
      claims: [{ claimId: "claim-1", text: "Wages are governed by the Labour Act.", provisionIds: ["labour-s11"] }],
      sources: [],
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
let localCorpusMode = false;
const corpusRows = () => provisions.map((p) => localCorpusMode ? { ...p, local_eval: true } : { ...p });
require.cache[corpusPath] = { id: corpusPath, filename: corpusPath, loaded: true, exports: {
  findProvisions: async () => corpusRows(),
  findProvisionsBroad: async () => ({ provisions: corpusRows(), categories: ["employment", "general"] }),
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

  await check("standalone context-free questions cache only within the same user", async () => {
    chatRoute.__testing.clearQuestionCache(); mode = "standard"; draftCalls = 0;
    await post({ question: "When must wages be paid?", history: [] }, "user-a");
    await post({ question: "When must wages be paid?", history: [] }, "user-a");
    assert.strictEqual(draftCalls, 1, "same user should reuse a verified standalone artifact");
    await post({ question: "When must wages be paid?", history: [] }, "user-b");
    assert.strictEqual(draftCalls, 2, "a different user must not receive another user's cached answer");
  });

  await check("duplicate concurrent message requests execute the pipeline once", async () => {
    chatRoute.__testing.clearQuestionCache(); chatRoute.__testing.clearProviderCooldowns(); mode = "idempotency"; draftCalls = 0;
    const body = { question: "When must wages be paid?", history: [{ role: "user", content: "same case" }], conversationId: "case-1", messageId: "agent-1" };
    const [first, second] = await Promise.all([post(body, "user-a"), post(body, "user-a")]);
    assert.strictEqual(first.status, 200);
    assert.strictEqual(second.status, 200);
    assert.strictEqual(draftCalls, 1, "duplicate in-flight requests must share one execution");
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

  await check("urgent high-risk answers are deterministically escalated with an immediate safety step", async () => {
    chatRoute.__testing.clearQuestionCache(); chatRoute.__testing.clearProviderCooldowns(); mode = "high-pass"; draftCalls = 0;
    const response = await post({ question: "The police detained and beat me", history: [] });
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.result.escalate, true);
    assert.match(response.body.result.actionsMd, /(medical|safe place|police|emergency)/i);
  });

  await check("local corpus mode is exposed in evidence and still requires verification", async () => {
    chatRoute.__testing.clearQuestionCache(); chatRoute.__testing.clearProviderCooldowns(); mode = "standard"; localCorpusMode = true; draftCalls = 0;
    const response = await post({ question: "When must wages be paid?", history: [] }, "local-user");
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.evidence.mode, "local_fallback");
    assert.strictEqual(response.body.result.citationVerification.valid, true);
    localCorpusMode = false;
  });

  await check("conflicting provisions cannot become sufficient evidence", async () => {
    chatRoute.__testing.clearQuestionCache(); chatRoute.__testing.clearProviderCooldowns(); mode = "conflicting-evidence"; draftCalls = 0;
    const response = await post({ question: "My employer has not paid me", history: [] });
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.evidence.sufficient, false);
    assert.ok(response.body.evidence.conflicts.length > 0);
    assert.strictEqual(response.body.result.escalate, true);
    assert.strictEqual(draftCalls, 0);
  });

  await check("malformed draft JSON/schema becomes provider-busy, never a legal answer", async () => {
    chatRoute.__testing.clearQuestionCache(); chatRoute.__testing.clearProviderCooldowns(); mode = "malformed-draft"; draftCalls = 0;
    const response = await post({ question: "My employer has not paid me", history: [] });
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.providersBusy, true);
    assert.strictEqual(response.body.result.sources.length, 0);
  });

  await check("invented supporting quote is converted to uncertain and escalated", async () => {
    chatRoute.__testing.clearQuestionCache(); chatRoute.__testing.clearProviderCooldowns(); mode = "invented-span"; draftCalls = 0;
    const response = await post({ question: "My employer has not paid me", history: [] });
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.critique.claimSupport[0].status, "uncertain");
    assert.strictEqual(response.body.critique.claimSupport[0].supportSpanVerified, false);
    assert.strictEqual(response.body.result.escalate, true);
  });

  await check("unsupported claim downgrades evidence and forces escalation", async () => {
    chatRoute.__testing.clearQuestionCache(); chatRoute.__testing.clearProviderCooldowns(); mode = "unsupported-claim"; draftCalls = 0;
    const response = await post({ question: "My employer has not paid me", history: [] });
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.critique.passed, false);
    assert.strictEqual(response.body.evidence.sufficient, false);
    assert.strictEqual(response.body.result.escalate, true);
  });

  await check("all provider failure on a legal incident fails closed", async () => {
    chatRoute.__testing.clearQuestionCache(); chatRoute.__testing.clearProviderCooldowns(); mode = "all-providers-fail"; draftCalls = 0;
    const response = await post({ question: "My employer fired me and has not paid my salary", history: [] });
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.evidence.sufficient, false);
    assert.strictEqual(response.body.result.escalate, true);
    assert.strictEqual(draftCalls, 0);
  });

  await check("bad question/history input is rejected before provider work", async () => {
    mode = "standard"; draftCalls = 0;
    const badQuestion = await post({ question: { text: "not a string" }, history: [] });
    const badHistory = await post({ question: "valid", history: [{ role: "system", content: "bad role" }] });
    assert.strictEqual(badQuestion.status, 400);
    assert.strictEqual(badHistory.status, 400);
    assert.strictEqual(draftCalls, 0);
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
