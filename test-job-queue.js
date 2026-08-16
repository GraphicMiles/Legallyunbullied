/**
 * Tests for the in-process queue + Firestore job state (decision #4) and
 * restart-and-complete (decision b).
 *
 * Mocks firebaseAdmin with an in-memory Firestore (top-level background_jobs
 * collection + nested users/conversations/messages), plus LLM/corpus mocks.
 * Verifies:
 *   1. A live POST /api/chat records running → done job documents.
 *   2. The sweeper resets a STALE "running" job to "queued" and leaves a
 *      fresh "running" job alone (no racing a still-alive instance).
 *   3. The worker re-runs a queued job through runChatPipeline and persists
 *      the answer (message + job done) — restart-and-complete.
 *   4. Concurrency is limited (MAX_CONCURRENT=1): two queued jobs never
 *      overlap in the LLM call phase.
 *
 * Run: node test-job-queue.js
 */

const assert = require("assert");
const http = require("http");
const express = require("express");

// ── In-memory Firestore mock (flat path store + generic where/get) ────────
function makeMockDb() {
  const store = new Map(); // full path -> data object
  const writeLog = [];     // { path, data }

  function coll(segments) {
    return {
      doc: (id) => {
        const fullSeg = [...segments, id];
        const path = fullSeg.join("/");
        return {
          id,
          path,
          set: async (data, opts) => {
            writeLog.push({ path, data: { ...data } });
            store.set(path, { ...(store.get(path) || {}), ...data });
          },
          get: async () => ({ id, exists: store.has(path), data: () => store.get(path) || {} }),
          collection: (n) => coll([...fullSeg, n]),
        };
      },
      where: (field, op, value) => ({
        get: async () => {
          const prefix = segments.join("/") + "/";
          const docs = [];
          for (const [k, v] of store.entries()) {
            if (!k.startsWith(prefix)) continue;
            const rest = k.slice(prefix.length);
            if (rest.includes("/")) continue;
            if (op === "==" && v[field] === value) {
              docs.push({ id: rest, data: () => v, ref: coll(segments).doc(rest) });
            }
          }
          return { docs, size: docs.length };
        },
      }),
    };
  }

  return { db: { collection: (n) => coll([n]) }, store, writeLog };
}

// ── Fake LLM client with a shared concurrency tracker ──────────────────────
function makeFakeClient(classify, draft, tracker) {
  return {
    chat: { completions: { create: async ({ messages }) => {
      const sys = (messages && messages[0] && messages[0].content) || "";
      const json = (o) => ({ choices: [{ message: { content: JSON.stringify(o) } }] });
      if (sys.includes("determine if this is a legal question or casual")) {
        tracker.active++;
        tracker.max = Math.max(tracker.max, tracker.active);
        await new Promise((r) => setTimeout(r, 150));
        tracker.active--;
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

// ── Wire mocks ─────────────────────────────────────────────────────────────
const firebaseAdminPath = require.resolve("./server/firebaseAdmin");
const groqPath = require.resolve("./server/groq");
const geminiPath = require.resolve("./server/gemini");
const openrouterPath = require.resolve("./server/openrouter");
const cerebrasPath = require.resolve("./server/cerebras");
const corpusPath = require.resolve("./server/legalCorpus");

let fakeClient = null;
let mockDb = makeMockDb();
const clientExports = () => ({ getClient: () => fakeClient });
require.cache[firebaseAdminPath] = { id: firebaseAdminPath, filename: firebaseAdminPath, loaded: true, exports: { getFirestore: () => mockDb.db } };
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
const jobRunner = require("./server/jobRunner");

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
  // Simulate the server.js requireAuth middleware (sets req.uid).
  app.use((req, res, next) => { req.uid = "u1"; next(); });
  app.use(chatRoute);
  return app;
}

function postChat(body) {
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
      req.on("error", () => { server.close(); resolve({ status: 0, json: null }); });
      req.write(payload);
      req.end();
    });
  });
}

function jobDoc(id) {
  return mockDb.store.get(`background_jobs/${id}`) || null;
}
function messageDoc(cid, mid) {
  return mockDb.store.get(`users/u1/conversations/${cid}/messages/${mid}`) || null;
}

async function waitFor(fn, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("waitFor timeout");
}

let failures = 0;
function check(name, fn) {
  return fn().then(() => console.log(`  PASS  ${name}`)).catch((err) => {
    failures += 1;
    console.log(`  FAIL  ${name}\n        ${err.message}`);
  });
}

async function main() {
  console.log("\n=== Job queue / restart-and-complete tests ===\n");
  jobRunner.__reset();

  const tracker = { active: 0, max: 0 };
  fakeClient = makeFakeClient(LEGAL_CLASSIFY, DRAFT, tracker);

  await check("live request records running → done job documents", async () => {
    mockDb = makeMockDb();
    require.cache[firebaseAdminPath].exports.getFirestore = () => mockDb.db;
    const { status } = await postChat({ question: "Someone slapped me", conversationId: "c1", messageId: "m1" });
    assert.strictEqual(status, 200);
    const doc = jobDoc("m1");
    assert.ok(doc, "job document must exist");
    assert.strictEqual(doc.status, "done");
    assert.strictEqual(doc.uid, "u1");
    assert.strictEqual(doc.question, "Someone slapped me");
    // the message was also persisted by runChatPipeline
    const msg = messageDoc("c1", "m1");
    assert.ok(msg && msg.status === "done" && msg.result, "message must be persisted done+result");
  });

  await check("sweeper resets stale running job → worker replays it; fresh job untouched", async () => {
    mockDb = makeMockDb();
    require.cache[firebaseAdminPath].exports.getFirestore = () => mockDb.db;
    jobRunner.__reset();
    // stale: started 10 min ago (orphaned by a crash)
    await mockDb.db.collection("background_jobs").doc("stale1").set({
      uid: "u1", conversationId: "c1", messageId: "m-stale", question: "Someone slapped me", history: [], status: "running", startedAt: Date.now() - 10 * 60 * 1000,
    });
    // fresh: started now (a still-alive instance's in-flight job — must NOT reset)
    await mockDb.db.collection("background_jobs").doc("fresh1").set({
      uid: "u1", conversationId: "c1", messageId: "m-fresh", question: "Another question", history: [], status: "running", startedAt: Date.now(),
    });
    await jobRunner.sweepOnce();
    // The stale job is reset → queued → immediately replayed by the worker.
    await waitFor(() => jobDoc("stale1") && jobDoc("stale1").status === "done");
    assert.strictEqual(jobDoc("fresh1").status, "running", "fresh running job must be left alone");
    const msg = messageDoc("c1", "m-stale");
    assert.ok(msg && msg.status === "done" && msg.result, "replayed job must persist the answer");
  });

  await check("worker re-runs a queued job → answer persisted (restart-and-complete)", async () => {
    mockDb = makeMockDb();
    require.cache[firebaseAdminPath].exports.getFirestore = () => mockDb.db;
    jobRunner.__reset();
    // Seed a queued job (as the sweeper would after a crash).
    await mockDb.db.collection("background_jobs").doc("orphan1").set({
      uid: "u1", conversationId: "c1", messageId: "m-orphan", question: "Someone slapped me", history: [], status: "queued",
    });
    await jobRunner.sweepOnce(); // enqueues orphan1 and drains
    await waitFor(() => jobDoc("orphan1") && jobDoc("orphan1").status === "done");
    const msg = messageDoc("c1", "m-orphan");
    assert.ok(msg, "worker must persist the message");
    assert.strictEqual(msg.status, "done");
    assert.ok(msg.result && msg.result.lawMd, "worker must persist the full answer");
    assert.strictEqual(jobDoc("orphan1").status, "done");
  });

  await check("worker concurrency is limited (serial execution)", async () => {
    mockDb = makeMockDb();
    require.cache[firebaseAdminPath].exports.getFirestore = () => mockDb.db;
    jobRunner.__reset();
    tracker.max = 0;
    tracker.active = 0;
    await mockDb.db.collection("background_jobs").doc("j1").set({ uid: "u1", conversationId: "c1", messageId: "m1", question: "Q1", history: [], status: "queued" });
    await mockDb.db.collection("background_jobs").doc("j2").set({ uid: "u1", conversationId: "c1", messageId: "m2", question: "Q2", history: [], status: "queued" });
    await jobRunner.sweepOnce();
    await waitFor(() => jobDoc("j1").status === "done" && jobDoc("j2").status === "done");
    assert.strictEqual(tracker.max, 1, `pipeline runs must not overlap (observed max concurrency ${tracker.max})`);
  });

  console.log(failures === 0 ? "\nALL JOB-QUEUE TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
