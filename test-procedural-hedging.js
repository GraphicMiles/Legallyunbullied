/**
 * Server tests for: procedural questions bypass the citation pipeline, and
 * hedging language downgrades confidence (never "High confidence").
 *
 * Mocks the LLM provider clients and the legal corpus so the /api/chat route
 * can be exercised end-to-end:
 *   1. "How do I note down key facts" → needs_sourcing false → answered by the
 *      procedural path with ZERO sources and noSourcing evidence (no search).
 *   2. A draft whose own text hedges ("do not directly address", "might be
 *      relevant") → evidence.sufficient flipped to false, hedged true.
 *
 * Run: node test-procedural-hedging.js
 */

const assert = require("assert");

// ── Fake LLM client: branches on the system prompt ─────────────────────────
function makeFakeClient(classifyResponse, draftResponse) {
  return {
    chat: {
      completions: {
        create: async ({ messages }) => {
          const sys = (messages && messages[0] && messages[0].content) || "";
          const json = (obj) => ({ choices: [{ message: { content: JSON.stringify(obj) } }] });

          if (sys.includes("determine if this is a legal question or casual")) return json(classifyResponse);
          if (sys.includes("PRACTICAL, PROCEDURAL")) {
            return json({
              lawMd: "Write things down while they're fresh: who, what, when, where. Keep it factual.",
              actionsMd: "- Step 1: Note the key facts\n- Step 2: Keep it factual\n- Step 3: Save a dated copy",
              sources: [],
              escalate: false,
              escalateReason: "A practical task you can handle yourself.",
              followUps: [],
            });
          }
          if (sys.includes("legal retrieval relevance judge")) {
            return json({ relevant: [1, 2], irrelevant: [], relevance_score: 0.9, sufficient: true, conflicts: [], reason: "directly on point" });
          }
          if (sys.includes("quality reviewer")) {
            return json({ quality: 0.85, legal_safety: 0.85, issues: [], claim_support: [{ claimId: "claim-1", status: "supported", reason: "directly supported" }], passed: true });
          }
          // Draft
          return json(draftResponse);
        },
      },
    },
  };
}

// ── Wire the mocks into chatRoute's require() calls ────────────────────────
const groqPath = require.resolve("./server/groq");
const geminiPath = require.resolve("./server/gemini");
const openrouterPath = require.resolve("./server/openrouter");
const cerebrasPath = require.resolve("./server/cerebras");
const corpusPath = require.resolve("./server/legalCorpus");

let fakeClient = null;
const clientExports = () => ({ getClient: () => fakeClient });
const modelNames = { CLASSIFY_MODEL: "classify-model", DRAFT_MODEL: "draft-model", DRAFT_MODEL_FALLBACK: "draft-fb" };
const geminiNames = { GEMINI_CLASSIFY_MODEL: "g-classify", GEMINI_DRAFT_MODEL: "g-draft", GEMINI_CHAT_MODEL: "g-chat" };
const openrouterNames = { OPENROUTER_CLASSIFY_MODEL: "o-classify", OPENROUTER_DRAFT_MODEL: "o-draft", OPENROUTER_CHAT_MODEL: "o-chat" };
const cerebrasNames = { CEREBRAS_CLASSIFY_MODEL: "c-classify", CEREBRAS_DRAFT_MODEL: "c-draft", CEREBRAS_CHAT_MODEL: "c-chat" };

let mockProvisions = [];
require.cache[groqPath] = { id: groqPath, filename: groqPath, loaded: true, exports: { ...clientExports(), ...modelNames } };
require.cache[geminiPath] = { id: geminiPath, filename: geminiPath, loaded: true, exports: { ...clientExports(), ...geminiNames } };
require.cache[openrouterPath] = { id: openrouterPath, filename: openrouterPath, loaded: true, exports: { ...clientExports(), ...openrouterNames } };
require.cache[cerebrasPath] = { id: cerebrasPath, filename: cerebrasPath, loaded: true, exports: { ...clientExports(), ...cerebrasNames } };
require.cache[corpusPath] = {
  id: corpusPath, filename: corpusPath, loaded: true,
  exports: {
    findProvisions: async () => mockProvisions,
    findProvisionsBroad: async () => ({ provisions: mockProvisions, categories: ["criminal_offences"] }),
    COLLECTION: "legal_provisions",
    invalidateCache: () => {},
    getCacheStats: () => ({}),
    cleanupCache: () => {},
  },
};

const express = require("express");
const http = require("http");
const chatRoute = require("./server/chatRoute");

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(chatRoute); // routes are full paths: /api/chat, /api/generate-title
  return app;
}

function postChat(question) {
  return new Promise((resolve) => {
    const app = makeApp();
    const server = http.Server(app);
    server.listen(0, () => {
      const port = server.address().port;
      const body = JSON.stringify({ question });
      const req = http.request(
        { host: "127.0.0.1", port, path: "/api/chat", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
        (res) => {
          let buf = "";
          res.on("data", (c) => (buf += c));
          res.on("end", () => {
            server.close();
            let json = null;
            try { json = JSON.parse(buf); } catch {}
            resolve({ status: res.statusCode, json });
          });
        }
      );
      req.on("error", () => { server.close(); resolve({ status: 0, json: null }); });
      req.write(body);
      req.end();
    });
  });
}

let failures = 0;
function check(name, fn) {
  return fn().then(() => console.log(`  PASS  ${name}`)).catch((err) => {
    failures += 1;
    console.log(`  FAIL  ${name}\n        ${err.message}`);
  });
}

const LEGAL_CLASSIFY = {
  is_legal_question: true,
  practice_area: "criminal_offences",
  jurisdiction: "Federal",
  jurisdiction_status: "clear",
  urgency: "Medium",
  summary: "witness documentation",
  keywords: ["witness", "facts"],
  key_issues: [],
  needs_sourcing: true,
  complexity: "Low",
  route: "simple",
  reasoning_approach: "",
  stakeholders: [],
  potential_remedies: [],
};

async function main() {
  console.log("\n=== Procedural + hedging tests ===\n");

  // ── Test 1: procedural question bypasses the citation pipeline ──────────
  mockProvisions = [
    { id: "p1", act: "Prevention of Crimes Act", section: "2", text: "defines crime...", jurisdiction: "Federal" },
    { id: "p2", act: "Harmful Waste (Special Criminal Provisions) Act", section: "2", text: "parties to a crime...", jurisdiction: "Federal" },
  ];
  fakeClient = makeFakeClient(
    { ...LEGAL_CLASSIFY, needs_sourcing: false },
    { lawMd: "", actionsMd: "", sources: [], escalate: false, escalateReason: "", followUps: [] }
  );

  await check("procedural question → noSourcing, zero sources, no citation search", async () => {
    const { status, json } = await postChat("How do I note down the key facts after witnessing something?");
    assert.strictEqual(status, 200, `expected 200, got ${status}`);
    assert.strictEqual(json.evidence.noSourcing, true, "must be flagged noSourcing");
    assert.strictEqual(json.evidence.sourceCount, 0, "no sources must be counted");
    assert.ok(json.result, "must have a result");
    assert.strictEqual((json.result.sources || []).length, 0, "sources must be empty");
    assert.ok(json.result.lawMd && json.result.lawMd.length > 0, "must have direct practical guidance");
    assert.ok(!json.result.lawMd.includes("Prevention of Crimes"), "must NOT cite the irrelevant statute");
  });

  // ── Test 2: hedging text → sufficient flipped false + hedged true ───────
  mockProvisions = [
    { id: "p1", act: "Prevention of Crimes Act", section: "2", text: "defines crime...", jurisdiction: "Federal" },
    { id: "p2", act: "Harmful Waste (Special Criminal Provisions) Act", section: "2", text: "parties to a crime...", jurisdiction: "Federal" },
  ];
  fakeClient = makeFakeClient(
    { ...LEGAL_CLASSIFY, needs_sourcing: true },
    {
      lawMd: "The retrieved excerpts do not directly address how to note down key facts. One provision might be relevant when describing roles [[p1]].",
      actionsMd: "- Step 1: Document it\n- Step 2: Report it",
      provisionIds: ["p1", "p2"],
      claims: [{ claimId: "claim-1", text: "The cited excerpts do not directly answer the practical question.", provisionIds: ["p1", "p2"] }],
      sources: [],
      escalate: false,
      escalateReason: "",
      followUps: [],
    }
  );

  await check("hedging in the draft → evidence.sufficient=false, hedged=true", async () => {
    const { status, json } = await postChat("I witnessed a crime, how do I note down the facts?");
    assert.strictEqual(status, 200, `expected 200, got ${status}`);
    assert.strictEqual(json.evidence.hedged, true, "must be flagged hedged");
    assert.strictEqual(json.evidence.sufficient, false, "sufficient must be downgraded to false");
    assert.ok(Array.isArray(json.evidence.hedgeMatches) && json.evidence.hedgeMatches.length > 0, "must record the matched hedge patterns");
    assert.strictEqual(json.result.evidence.sufficient, false, "evidence inside result must also be downgraded");
  });

  // ── Test 3: clean (non-hedging), actually retrieved citations stay sufficient ──
  mockProvisions = [
    { id: "cc-252", act: "Criminal Code Act", section: "252", text: "assault is unlawfully striking another person", jurisdiction: "Federal" },
    { id: "cc-253", act: "Criminal Code Act", section: "253", text: "punishment for assault", jurisdiction: "Federal" },
  ];
  fakeClient = makeFakeClient(
    { ...LEGAL_CLASSIFY, needs_sourcing: true },
    {
      lawMd: "Under section 252 of the Criminal Code Act, assault is a crime punishable by law. The section establishes the elements of assault.",
      actionsMd: "- Step 1: Report to the police\n- Step 2: Consult a lawyer",
      provisionIds: ["cc-252", "cc-253"],
      claims: [{ claimId: "claim-1", text: "Assault is addressed by the Criminal Code.", provisionIds: ["cc-252", "cc-253"] }],
      sources: [],
      escalate: false,
      escalateReason: "",
      followUps: [],
    }
  );

  await check("clean draft (no hedging) is not downgraded", async () => {
    const { status, json } = await postChat("Someone slapped me");
    assert.strictEqual(status, 200);
    assert.strictEqual(json.evidence.hedged, undefined, "clean draft must not be flagged hedged");
    assert.strictEqual(json.evidence.sufficient, true, "sufficient must remain true");
    assert.ok(json.evidence.sourceCount >= 2, "source count preserved");
  });

  console.log(failures === 0 ? "\nALL PROCEDURAL/HEDGING TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
