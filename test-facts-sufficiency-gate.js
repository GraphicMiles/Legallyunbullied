/**
 * Facts-sufficiency gate — the "weak response" complaint.
 *
 * Before this, a question that genuinely forks on a missing fact
 * ("register a company" without saying sole proprietorship vs LTD, for
 * example) was answered anyway — generic checklist, no law, weak.
 * The classifier can now emit facts_sufficient:false + clarifying_question,
 * and the route MUST return needsInput without burning a draft.
 *
 * Also asserts the opposite: when facts are sufficient, no clarification
 * gate fires and the full pipeline runs.
 *
 * Run: node test-facts-sufficiency-gate.js
 */
const assert = require("assert");
const http = require("http");
const express = require("express");

const writes = [];
const mockDb = {
  collection: (n1) => ({
    doc: (u1) => ({
      collection: (n2) => ({
        doc: (c1) => ({
          collection: (n3) => ({
            doc: (m1) => ({ set: async (d) => { writes.push({ uid: u1, convoId: c1, msgId: m1, fields: d }); } }),
          }),
          set: async () => {},
        }),
      }),
    }),
  }),
  batch: () => ({ set() {}, delete() {}, commit: async () => {} }),
  settings: () => {},
};

let fakeClassify = null;
let draftCalls = 0;
let proceduralClient = false; // case 3: judge answers insufficient so the rescue path must fire
const fakeClient = {
  chat: { completions: { create: async ({ messages }) => {
    const sys = (messages && messages[0] && messages[0].content) || "";
    const json = (o) => ({ choices: [{ message: { content: JSON.stringify(o) } }] });
    if (sys.includes("determine if this is a legal question or casual")) return json(fakeClassify);
    if (sys.includes("legal retrieval relevance judge")) {
      if (proceduralClient) return json({ relevant: [], irrelevant: [1], relevance_score: 0.05, sufficient: false, conflicts: [], reason: "tangential keyword overlap only" });
      return json({ relevant: [1], irrelevant: [], relevance_score: 0.9, sufficient: true, conflicts: [], reason: "" });
    }
    if (sys.includes("quality reviewer")) return json({ quality: 0.9, legal_safety: 0.9, issues: [], claim_support: [{ claimId: "claim-1", status: "supported", supportingQuote: "x", reason: "" }], passed: true });
    draftCalls++;
    return json({
      lawMd: "Registration of a company is handled by CAC under [[p1]].",
      actionsMd: "- Step 1: Choose a name\n- Step 2: Reserve the name with CAC",
      provisionIds: ["p1"], claims: [{ claimId: "claim-1", text: "CAC registers companies.", provisionIds: ["p1"] }],
      sources: [], escalate: false, escalateReason: "", followUps: [],
    });
  } } },
};

const fa = require.resolve("./server/firebaseAdmin");
const gr = require.resolve("./server/groq");
const ge = require.resolve("./server/gemini");
const op = require.resolve("./server/openrouter");
const ce = require.resolve("./server/cerebras");
const co = require.resolve("./server/legalCorpus");
const ce2 = () => ({ getClient: () => fakeClient });
require.cache[fa] = { id: fa, filename: fa, loaded: true, exports: { getFirestore: () => mockDb } };
require.cache[gr] = { id: gr, filename: gr, loaded: true, exports: { ...ce2(), CLASSIFY_MODEL: "c", DRAFT_MODEL: "d", DRAFT_MODEL_FALLBACK: "df" } };
require.cache[ge] = { id: ge, filename: ge, loaded: true, exports: { ...ce2(), GEMINI_CLASSIFY_MODEL: "c", GEMINI_DRAFT_MODEL: "d", GEMINI_CHAT_MODEL: "c" } };
require.cache[op] = { id: op, filename: op, loaded: true, exports: { ...ce2(), OPENROUTER_CLASSIFY_MODEL: "c", OPENROUTER_DRAFT_MODEL: "d", OPENROUTER_CHAT_MODEL: "c" } };
require.cache[ce] = { id: ce, filename: ce, loaded: true, exports: { ...ce2(), CEREBRAS_CLASSIFY_MODEL: "c", CEREBRAS_DRAFT_MODEL: "d", CEREBRAS_CHAT_MODEL: "c" } };
require.cache[co] = { id: co, filename: co, loaded: true, exports: {
  findProvisions: async () => [{ id: "p1", act: "CAMA", section: "36", text: "the commission shall register…", jurisdiction: "Federal" }],
  findProvisionsBroad: async () => ({ provisions: [{ id: "p1", act: "CAMA", section: "36", text: "…" }], categories: ["company_business"] }),
  COLLECTION: "legal_provisions", invalidateCache: () => {}, getCacheStats: () => ({}), cleanupCache: () => {},
} };

const chatRoute = require("./server/chatRoute");

function postChat(body) {
  return new Promise((resolve) => {
    const app = express();
    app.use(express.json());
    app.use(chatRoute);
    const server = http.Server(app);
    server.listen(0, () => {
      const port = server.address().port;
      const payload = JSON.stringify(body);
      const req = http.request(
        { host: "127.0.0.1", port, path: "/api/chat", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } },
        (res) => {
          let buf = "";
          res.on("data", (c) => (buf += c));
          res.on("end", () => { server.close(); let j; try { j = JSON.parse(buf); } catch {} resolve({ status: res.statusCode, json: j }); });
        }
      );
      req.write(payload); req.end();
    });
  });
}

const BASE_CLASSIFY = {
  is_legal_question: true, practice_area: "company_business", jurisdiction: "Federal",
  jurisdiction_status: "clear", urgency: "Low", summary: "company registration",
  keywords: ["register", "company"], key_issues: [], needs_sourcing: true,
  complexity: "Low", route: "simple", reasoning_approach: "", stakeholders: [], potential_remedies: [],
};

(async () => {
  console.log("facts-sufficiency gate:");

  // Case 1: facts missing → must ask, not answer
  fakeClassify = { ...BASE_CLASSIFY, facts_sufficient: false, clarifying_question: "Is this a business name, a private limited company, or an NGO?" };
  const r1 = await postChat({ question: "how do I register something", jurisdiction: "Federal", conversationId: "c1", messageId: "m1" });
  assert.strictEqual(r1.status, 200, `needsInput path must return 200, got ${r1.status}`);
  assert.strictEqual(r1.json.needsInput, true, "needsInput must be true");
  assert.strictEqual(r1.json.question, "Is this a business name, a private limited company, or an NGO?", "clarifying question passes through verbatim");
  assert.strictEqual(r1.json.field, "facts");
  assert.strictEqual(draftCalls, 0, `draft model must NOT run (${draftCalls} ran)`);
  const w1 = [...writes].reverse().find(w => w.msgId === "m1" && w.fields.status !== "thinking");
  assert.ok(w1, "server must persist the HITL question (writes: " + JSON.stringify(writes.map(w => w.fields.status)) + ")");
  assert.strictEqual(w1.fields.status, "needsInput");
  assert.strictEqual(w1.fields.pipelineStatus, "awaiting_input");
  console.log("  ok  facts missing → needsInput, no draft ran, HITL persisted");

  // Case 2: facts sufficient/absent → no gate, full pipeline runs
  fakeClassify = { ...BASE_CLASSIFY };
  const r2 = await postChat({ question: "what does CAMA say about company registration", jurisdiction: "Federal" });
  assert.strictEqual(r2.status === 200 && r2.json.needsInput !== true, true, `expected full answer, got ${r2.status} ${JSON.stringify(r2.json).slice(0,120)}`);
  assert.ok(draftCalls >= 1, "draft must run for sufficient-facts question");
  console.log("  ok  facts sufficient → full pipeline, draft ran");

  // Case 3: procedural/admin how-to where the evidence gate rejects whatever
  // the corpus returned — must land on the practical answer, never the
  // "insufficient evidence" dead-end. (Registration classifier now routes
  // sourced, but the broadened gate can still say insufficient when its
  // judge misfires.)
  fakeClassify = { ...BASE_CLASSIFY, needs_sourcing: true };
  proceduralClient = true;
  const r3 = await postChat({ question: "how do i register a company with cac", jurisdiction: "Federal", conversationId: "c3", messageId: "m3" });
  proceduralClient = false;
  assert.strictEqual(r3.status, 200);
  const ev3 = r3.json.evidence || {};
  assert.ok(ev3.proceduralRescue === true, "procedural rescue must be flagged, got " + JSON.stringify(ev3).slice(0, 200));
  assert.ok(ev3.noSourcing === true, "rescued answer must be marked noSourcing");
  assert.ok(!/insufficient|could not verify|couldn't verify/i.test(JSON.stringify(r3.json.result || {})), "must not emit an insufficient-evidence template");
  console.log("  ok  gate-insufficient procedural question → practical answer, not dead-end");

  console.log("\nfacts-sufficiency-gate PASS");
})().catch((e) => { console.error(e); process.exit(1); });
