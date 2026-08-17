/**
 * Tests for the safety-ack token surviving a server restart (Firestore-backed).
 *
 * Mocks firebaseAdmin (in-memory Firestore), the LLM clients, and the corpus.
 * Verifies:
 *   1. A high-risk answer that fails critique returns a safetyAck with a token,
 *      and the token is persisted to Firestore (safety_acks/{token}).
 *   2. Simulating a restart (clearing the in-memory ack cache) does NOT
 *      invalidate the token — /api/chat/acknowledge still returns the cached
 *      response.
 *   3. After acknowledgment, the token is deleted from both memory and
 *      Firestore (a second acknowledge returns 404).
 *   4. The safetyAck message persisted to the conversation carries the token,
 *      so a reopened chat re-renders a working "I understand, show me" button.
 *
 * Run: node test-safety-ack-restart.js
 */

const assert = require("assert");
const http = require("http");
const express = require("express");

// ── In-memory Firestore mock (flat path store) ────────────────────────────
function makeMockDb() {
  const store = new Map();
  function coll(segments) {
    return {
      doc: (id) => {
        const path = [...segments, id].join("/");
        return {
          id, path,
          set: async (data) => { store.set(path, { ...(store.get(path) || {}), ...data }); },
          get: async () => ({ id, exists: store.has(path), data: () => store.get(path) || {}, ref: { delete: async () => { store.delete(path); } } }),
          delete: async () => { store.delete(path); },
          collection: (n) => coll([...segments, id, n]),
        };
      },
      where: () => ({ get: async () => ({ docs: [] }) }),
    };
  }
  return { db: { collection: (n) => coll([n]) }, store };
}

// ── Fake LLM client: high-risk classify + critique that FAILS safety ───────
function makeFakeClient() {
  return {
    chat: { completions: { create: async ({ messages }) => {
      const sys = (messages && messages[0] && messages[0].content) || "";
      const json = (o) => ({ choices: [{ message: { content: JSON.stringify(o) } }] });
      if (sys.includes("determine if this is a legal question or casual")) {
        return json({
          is_legal_question: true, practice_area: "criminal_offences", jurisdiction: "Federal",
          jurisdiction_status: "clear", urgency: "High", summary: "assault", keywords: ["assault"],
          key_issues: [], needs_sourcing: true, complexity: "Low", route: "simple",
          reasoning_approach: "", stakeholders: [], potential_remedies: [],
        });
      }
      if (sys.includes("legal retrieval relevance judge")) {
        return json({ relevant: [1, 2], irrelevant: [], relevance_score: 0.9, sufficient: true, conflicts: [], reason: "on point" });
      }
      if (sys.includes("quality reviewer")) {
        // Fail safety → high-risk + not passed → safety ack required.
        return json({ quality: 0.5, legal_safety: 0.5, issues: ["unverifiable"], claim_support: [{ claimId: "claim-1", status: "uncertain", reason: "unverifiable" }], passed: false });
      }
      return json({
        lawMd: "Assault is addressed by [[p1]].",
        actionsMd: "- Step 1: Report it\n- Step 2: Consult a lawyer",
        provisionIds: ["p1", "p2"],
        claims: [{ claimId: "claim-1", text: "Assault is addressed by law.", provisionIds: ["p1"] }],
        sources: [],
        escalate: false, escalateReason: "", followUps: [],
      });
    } } },
  };
}

// ── Wire mocks ─────────────────────────────────────────────────────────────
const firebaseAdminPath = require.resolve("./server/firebaseAdmin");
const groqPath = require.resolve("./server/groq");
const geminiPath = require.resolve("./server/gemini");
const openrouterPath = require.resolve("./server/openrouter");
const cerebrasPath = require.resolve("./server/cerebras");
const corpusPath = require.resolve("./server/legalCorpus");

let mockDb = makeMockDb();
require.cache[firebaseAdminPath] = { id: firebaseAdminPath, filename: firebaseAdminPath, loaded: true, exports: { getFirestore: () => mockDb.db } };
const fake = () => ({ getClient: () => makeFakeClient() });
require.cache[groqPath] = { id: groqPath, filename: groqPath, loaded: true, exports: { ...fake(), CLASSIFY_MODEL: "c", DRAFT_MODEL: "d", DRAFT_MODEL_FALLBACK: "df" } };
require.cache[geminiPath] = { id: geminiPath, filename: geminiPath, loaded: true, exports: { ...fake(), GEMINI_CLASSIFY_MODEL: "gc", GEMINI_DRAFT_MODEL: "gd", GEMINI_CHAT_MODEL: "gc2" } };
require.cache[openrouterPath] = { id: openrouterPath, filename: openrouterPath, loaded: true, exports: { ...fake(), OPENROUTER_CLASSIFY_MODEL: "oc", OPENROUTER_DRAFT_MODEL: "od", OPENROUTER_CHAT_MODEL: "oc2" } };
require.cache[cerebrasPath] = { id: cerebrasPath, filename: cerebrasPath, loaded: true, exports: { ...fake(), CEREBRAS_CLASSIFY_MODEL: "cc", CEREBRAS_DRAFT_MODEL: "cd", CEREBRAS_CHAT_MODEL: "cc2" } };
require.cache[corpusPath] = {
  id: corpusPath, filename: corpusPath, loaded: true,
  exports: {
    findProvisions: async () => [
      { id: "p1", act: "Criminal Code Act", section: "252", text: "assault...", jurisdiction: "Federal" },
      { id: "p2", act: "Criminal Code Act", section: "253", text: "punishment...", jurisdiction: "Federal" },
    ],
    findProvisionsBroad: async () => ({ provisions: [
      { id: "p1", act: "Criminal Code Act", section: "252", text: "assault...", jurisdiction: "Federal" },
      { id: "p2", act: "Criminal Code Act", section: "253", text: "punishment...", jurisdiction: "Federal" },
    ], categories: ["criminal_offences"] }),
    COLLECTION: "legal_provisions",
    invalidateCache: () => {}, getCacheStats: () => ({}), cleanupCache: () => {},
  },
};

const chatRoute = require("./server/chatRoute");

function makeApp(uid = "u1") {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.uid = uid; next(); });
  app.use(chatRoute);
  return app;
}

function request(app, method, path, body) {
  return new Promise((resolve) => {
    const server = http.Server(app);
    server.listen(0, () => {
      const port = server.address().port;
      const payload = body ? JSON.stringify(body) : undefined;
      const req = http.request(
        { host: "127.0.0.1", port, path, method, headers: payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {} },
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
      if (payload) req.write(payload);
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
  console.log("\n=== Safety-ack restart tests ===\n");

  await check("high-risk answer returns safetyAck and persists the token to Firestore", async () => {
    mockDb = makeMockDb();
    require.cache[firebaseAdminPath].exports.getFirestore = () => mockDb.db;
    const app = makeApp();
    const { status, json } = await request(app, "POST", "/api/chat", { question: "I was attacked", conversationId: "c1", messageId: "m1" });
    assert.strictEqual(status, 200);
    assert.strictEqual(json.safetyAck, true, "expected safetyAck response");
    assert.ok(json.ackToken, "expected an ackToken");
    // Token persisted to Firestore.
    assert.ok(mockDb.store.get(`safety_acks/${json.ackToken}`), "token must be persisted to Firestore");
    // Message persisted WITH the token, so reload re-renders a working button.
    const msg = mockDb.store.get("users/u1/conversations/c1/messages/m1");
    assert.ok(msg, "message must be persisted");
    assert.strictEqual(msg.safetyAckToken, json.ackToken, "message must carry the durable token");
    global.__lastAckToken = json.ackToken;
  });

  await check("another user cannot acknowledge the token", async () => {
    const app = makeApp("u2");
    const { status } = await request(app, "POST", "/api/chat/acknowledge", { ackToken: global.__lastAckToken, acknowledged: true });
    assert.strictEqual(status, 404, "cross-user token access must look not found");
    assert.ok(mockDb.store.get(`safety_acks/${global.__lastAckToken}`), "unauthorized attempt must not consume the token");
  });

  await check("token survives a simulated restart (in-memory cache cleared)", async () => {
    const app = makeApp();
    chatRoute.__testing.clearAckCache(); // the "restart" — memory wiped
    const { status, json } = await request(app, "POST", "/api/chat/acknowledge", { ackToken: global.__lastAckToken, acknowledged: true });
    assert.strictEqual(status, 200, `acknowledge should still work after restart (got ${status})`);
    assert.strictEqual(json.acknowledged, true);
    assert.ok(json.result && json.result.lawMd, "cached response must be returned");
  });

  await check("after acknowledgment the token is gone (second ack → 404)", async () => {
    const app = makeApp();
    const { status } = await request(app, "POST", "/api/chat/acknowledge", { ackToken: global.__lastAckToken, acknowledged: true });
    assert.strictEqual(status, 404, "token must be deleted after use");
    assert.ok(!mockDb.store.get(`safety_acks/${global.__lastAckToken}`), "token must be removed from Firestore");
  });

  console.log(failures === 0 ? "\nALL SAFETY-ACK-RESTART TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
