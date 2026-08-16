/**
 * Server tests for recoverable requests (A): the pipeline result is persisted
 * server-side even when the client disconnects.
 *
 * Mocks firebaseAdmin (captures Firestore writes), the LLM clients, and the
 * corpus. Verifies:
 *   1. A successful /api/chat with conversationId+messageId writes
 *      { status:"done", result, pipelineStatus:"done", unread:true } to the
 *      message document.
 *   2. Simulated client disconnect (request socket destroyed before the LLM
 *      resolves) still results in the answer being persisted — the handler
 *      keeps running after the client leaves.
 *   3. A HITL needsInput response is persisted with status "needsInput" +
 *      pipelineStatus "awaiting_input".
 *
 * Run: node test-recoverable-request.js
 */

const assert = require("assert");
const http = require("http");
const express = require("express");

// ── Mock Firestore: records message writes ────────────────────────────────
const writes = []; // { uid, convoId, msgId, fields }
const mockDb = {
  collection: (name) => ({
    doc: (uid) => ({
      collection: (name2) => ({
        doc: (cid) => ({
          collection: (name3) => ({
            doc: (mid) => ({
              set: async (data) => { writes.push({ uid, convoId: cid, msgId: mid, fields: data }); },
            }),
          }),
        }),
      }),
    }),
  }),
  batch: () => ({ set() {}, delete() {}, commit: async () => {} }),
  settings: () => {},
};

// ── Fake LLM client: controllable delay + branching on system prompt ───────
function makeFakeClient({ delayMs = 0, classify, draft } = {}) {
  return {
    chat: { completions: { create: async ({ messages }) => {
      const sys = (messages && messages[0] && messages[0].content) || "";
      const json = (o) => ({ choices: [{ message: { content: JSON.stringify(o) } }] });
      if (sys.includes("determine if this is a legal question or casual")) {
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        return json(classify);
      }
      if (sys.includes("legal retrieval relevance judge")) {
        return json({ relevant: [1, 2], irrelevant: [], relevance_score: 0.9, sufficient: true, reason: "on point" });
      }
      if (sys.includes("quality reviewer")) {
        return json({ quality: 0.85, legal_safety: 0.85, issues: [], passed: true });
      }
      return json(draft);
    } } },
  };
}

// ── Wire mocks into require() targets used by chatRoute ────────────────────
const firebaseAdminPath = require.resolve("./server/firebaseAdmin");
const groqPath = require.resolve("./server/groq");
const geminiPath = require.resolve("./server/gemini");
const openrouterPath = require.resolve("./server/openrouter");
const cerebrasPath = require.resolve("./server/cerebras");
const corpusPath = require.resolve("./server/legalCorpus");

let fakeClient = null;
const clientExports = () => ({ getClient: () => fakeClient });
require.cache[firebaseAdminPath] = { id: firebaseAdminPath, filename: firebaseAdminPath, loaded: true, exports: { getFirestore: () => mockDb } };
require.cache[groqPath] = { id: groqPath, filename: groqPath, loaded: true, exports: { ...clientExports(), CLASSIFY_MODEL: "c", DRAFT_MODEL: "d", DRAFT_MODEL_FALLBACK: "df" } };
require.cache[geminiPath] = { id: geminiPath, filename: geminiPath, loaded: true, exports: { ...clientExports(), GEMINI_CLASSIFY_MODEL: "gc", GEMINI_DRAFT_MODEL: "gd", GEMINI_CHAT_MODEL: "gc2" } };
require.cache[openrouterPath] = { id: openrouterPath, filename: openrouterPath, loaded: true, exports: { ...clientExports(), OPENROUTER_CLASSIFY_MODEL: "oc", OPENROUTER_DRAFT_MODEL: "od", OPENROUTER_CHAT_MODEL: "oc2" } };
require.cache[cerebrasPath] = { id: cerebrasPath, filename: cerebrasPath, loaded: true, exports: { ...clientExports(), CEREBRAS_CLASSIFY_MODEL: "cc", CEREBRAS_DRAFT_MODEL: "cd", CEREBRAS_CHAT_MODEL: "cc2" } };
require.cache[corpusPath] = {
  id: corpusPath, filename: corpusPath, loaded: true,
  exports: {
    findProvisions: async () => [
      { id: "p1", act: "Criminal Code Act", section: "252", text: "assault is a crime...", jurisdiction: "Federal" },
      { id: "p2", act: "Criminal Code Act", section: "253", text: "punishment for assault...", jurisdiction: "Federal" },
    ],
    findProvisionsBroad: async () => ({ provisions: [
      { id: "p1", act: "Criminal Code Act", section: "252", text: "assault is a crime...", jurisdiction: "Federal" },
      { id: "p2", act: "Criminal Code Act", section: "253", text: "punishment for assault...", jurisdiction: "Federal" },
    ], categories: ["criminal_offences"] }),
    COLLECTION: "legal_provisions",
    invalidateCache: () => {}, getCacheStats: () => ({}), cleanupCache: () => {},
  },
};

const chatRoute = require("./server/chatRoute");

const LEGAL_CLASSIFY = {
  is_legal_question: true, practice_area: "criminal_offences", jurisdiction: "Federal",
  jurisdiction_status: "clear", urgency: "Medium", summary: "assault", keywords: ["assault"],
  key_issues: [], needs_sourcing: true, complexity: "Low", route: "simple",
  reasoning_approach: "", stakeholders: [], potential_remedies: [],
};
const DRAFT = {
  lawMd: "Under section 252 of the Criminal Code Act, assault is a crime.",
  actionsMd: "- Step 1: Report to the police\n- Step 2: Consult a lawyer",
  sources: [{ label: "Criminal Code Act, s.252", excerpt: "..." }],
  escalate: false, escalateReason: "", followUps: [],
};

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(chatRoute);
  return app;
}

function postChat(body, { destroyAfterMs = null } = {}) {
  return new Promise((resolve) => {
    const app = makeApp();
    const server = http.Server(app);
    server.listen(0, () => {
      const port = server.address().port;
      const payload = JSON.stringify(body);
      const req = http.request(
        { host: "127.0.0.1", port, path: "/api/chat", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } },
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
      req.on("error", (e) => { server.close(); resolve({ status: 0, json: null, error: e.message }); });
      req.write(payload);
      if (destroyAfterMs != null) {
        // Simulate the user closing the tab: tear down the client socket.
        setTimeout(() => req.destroy(), destroyAfterMs);
      }
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

async function main() {
  console.log("\n=== Recoverable-request tests ===\n");

  fakeClient = makeFakeClient({ classify: LEGAL_CLASSIFY, draft: DRAFT });

  await check("successful request persists result to the message document", async () => {
    writes.length = 0;
    const { status } = await postChat({ question: "Someone slapped me", conversationId: "c1", messageId: "m1" });
    assert.strictEqual(status, 200);
    const done = writes.find((w) => w.msgId === "m1" && w.fields.status === "done");
    assert.ok(done, "must persist a done message");
    assert.ok(done.fields.result && done.fields.result.lawMd, "result must be persisted");
    assert.strictEqual(done.fields.pipelineStatus, "done");
    assert.strictEqual(done.fields.unread, true, "a server-persisted answer must be marked unread");
    const running = writes.find((w) => w.msgId === "m1" && w.fields.pipelineStatus === "running");
    assert.ok(running, "must persist a running marker at pipeline start");
  });

  await check("client disconnect mid-pipeline still persists the answer", async () => {
    writes.length = 0;
    // Slow classify so the client disconnects before the pipeline completes.
    fakeClient = makeFakeClient({ delayMs: 400, classify: LEGAL_CLASSIFY, draft: DRAFT });
    const res = await postChat({ question: "Someone slapped me", conversationId: "c1", messageId: "m1" }, { destroyAfterMs: 50 });
    // Give the still-running handler time to finish and write the result.
    await new Promise((r) => setTimeout(r, 800));
    const done = writes.find((w) => w.msgId === "m1" && w.fields.status === "done");
    assert.ok(done, "answer must be persisted even though the client disconnected");
    assert.ok(done.fields.result, "persisted message must carry the result");
  });

  await check("HITL needsInput is persisted as awaiting_input", async () => {
    writes.length = 0;
    fakeClient = makeFakeClient({ classify: { ...LEGAL_CLASSIFY, jurisdiction_status: "unclear" }, draft: DRAFT });
    const { status, json } = await postChat({ question: "My landlord evicted me", conversationId: "c1", messageId: "m1" });
    assert.strictEqual(status, 200);
    assert.strictEqual(json.needsInput, true);
    const awaiting = writes.find((w) => w.msgId === "m1" && w.fields.pipelineStatus === "awaiting_input");
    assert.ok(awaiting, "must persist awaiting_input for the clarifying question");
    assert.strictEqual(awaiting.fields.status, "needsInput");
    assert.ok(awaiting.fields.needsInputQuestion, "clarifying question text must be persisted");
  });

  await check("request without conversationId/messageId writes nothing (back-compat)", async () => {
    writes.length = 0;
    fakeClient = makeFakeClient({ classify: LEGAL_CLASSIFY, draft: DRAFT });
    const { status } = await postChat({ question: "Someone slapped me" });
    assert.strictEqual(status, 200);
    assert.strictEqual(writes.length, 0, "no persistence when the client didn't send ids");
  });

  console.log(failures === 0 ? "\nALL RECOVERABLE-REQUEST TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
