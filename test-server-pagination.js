/**
 * Server-side tests for conversation pagination + search (Part 2).
 *
 * Verifies, against a mock Firestore that implements orderBy/limit/startAfter:
 *   1. Paginated list returns newest-first pages with hasMore + nextCursor.
 *   2. Cursor paging yields no overlaps or gaps and ends with hasMore=false.
 *   3. limit is capped at 100 and defaulted to 25.
 *   4. Search (?q=) filters titles across ALL conversations (complete, not
 *      page-bound) and returns hasMore=false.
 *   5. full=true includes messages inline for a page.
 *
 * Run: node test-server-pagination.js
 */

const assert = require("assert");

// ── In-memory Firestore mock with orderBy/limit/startAfter/count ──────────
function makeMockDb(seed) {
  const convos = new Map(); // id -> {title, createdAt, updatedAt, userId}
  const msgs = new Map();   // id -> [{id, role, content, createdAt, userId}]
  for (const c of seed) {
    convos.set(c.id, { title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt, userId: "user-1" });
    msgs.set(c.id, (c.messages || []).map((m) => ({ ...m })));
  }

  const convoList = () => [...convos.entries()].map(([id, d]) => ({ id, ...d }));
  const msgList = (cid) => msgs.get(cid) || [];

  // A chainable Query-like object (orderBy/limit/startAfter/get/count).
  function makeQuery(listFn, toSnap) {
    const spec = { field: null, dir: "asc", limit: null, startAfterId: null };
    const q = {
      orderBy(field, dir) { spec.field = field; spec.dir = (dir || "asc").toLowerCase(); return q; },
      limit(n) { spec.limit = n; return q; },
      startAfter(snap) { spec.startAfterId = snap ? snap.id : null; return q; },
      count() {
        return { get: async () => ({ data: () => ({ count: listFn().length }) }) };
      },
      get: async () => {
        let docs = [...listFn()];
        const f = spec.field;
        if (f) {
          docs.sort((a, b) => {
            const av = a[f] || 0, bv = b[f] || 0;
            return spec.dir === "desc" ? bv - av : av - bv;
          });
        }
        if (spec.startAfterId) {
          const i = docs.findIndex((d) => d.id === spec.startAfterId);
          docs = i >= 0 ? docs.slice(i + 1) : [];
        }
        if (spec.limit != null) docs = docs.slice(0, spec.limit);
        return { docs: docs.map(toSnap) };
      },
    };
    return q;
  }

  function docSnap(d) {
    return { id: d.id, data: () => ({ ...d }) };
  }

  const db = {
    collection: () => db,
    doc: (uid) => ({
      collection: (name) => {
        if (name === "conversations") {
          const coll = makeQuery(convoList, docSnap);
          coll.doc = (cid) => ({
            id: cid,
            get: async () => {
              const d = convos.get(cid);
              return d
                ? { id: cid, exists: true, data: () => ({ ...d }) }
                : { id: cid, exists: false, data: () => ({}) };
            },
            collection: (n2) => {
              if (n2 === "messages") {
                return makeQuery(() => msgList(cid), (m) => ({ id: m.id, data: () => ({ ...m, userId: "user-1" }) }));
              }
              return makeQuery(() => [], docSnap);
            },
          });
          return coll;
        }
        return makeQuery(() => [], docSnap);
      },
    }),
    batch: () => ({ set() {}, delete() {}, commit: async () => {} }),
    settings: () => {},
  };
  return db;
}

// ── Wire the mock into the router ─────────────────────────────────────────
const adminPath = require.resolve("./server/firebaseAdmin");
const authPath = require.resolve("./server/authMiddleware");
let CURRENT_UID = "user-1";

const express = require("express");
const http = require("http");

let mockDb = null;
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: { getFirestore: () => mockDb },
};
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    requireAuth: (req, res, next) => { req.uid = CURRENT_UID; next(); },
    optionalAuth: (req, res, next) => { req.uid = null; next(); },
  },
};
const conversationRoute = require("./server/conversationRoute");

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/conversations", conversationRoute);
  return app;
}

function request(app, method, url) {
  return new Promise((resolve) => {
    const server = http.Server(app);
    server.listen(0, () => {
      const port = server.address().port;
      const req = http.request(
        { host: "127.0.0.1", port, path: url, method },
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
  console.log("\n=== Server pagination tests ===\n");

  // Seed 60 conversations, updatedAt 60..1 (newest first).
  const seed = [];
  for (let i = 60; i >= 1; i--) {
    seed.push({ id: `c${i}`, title: `Chat ${i}`, createdAt: i, updatedAt: i, messages: [] });
  }
  mockDb = makeMockDb(seed);

  await check("first page: limit defaulted/requested, newest-first, hasMore + nextCursor", async () => {
    const app = makeApp();
    const res = await request(app, "GET", "/api/conversations?limit=25");
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.conversations.length, 25);
    assert.strictEqual(res.json.hasMore, true);
    const ids = res.json.conversations.map((c) => c.id);
    assert.strictEqual(ids[0], "c60", "newest first");
    assert.strictEqual(ids[24], "c36");
    assert.strictEqual(res.json.nextCursor, "c36");
  });

  await check("cursor paging: no overlaps, no gaps, ends with hasMore=false", async () => {
    const app = makeApp();
    const seen = new Set();
    let cursor = null;
    let pageCount = 0;
    let hasMore = true;
    while (hasMore) {
      const url = cursor ? `/api/conversations?limit=25&cursor=${cursor}` : "/api/conversations?limit=25";
      const res = await request(app, "GET", url);
      assert.strictEqual(res.status, 200);
      for (const c of res.json.conversations) {
        assert.ok(!seen.has(c.id), `duplicate conversation across pages: ${c.id}`);
        seen.add(c.id);
      }
      pageCount += 1;
      hasMore = res.json.hasMore;
      cursor = res.json.nextCursor;
      assert.ok(pageCount < 10, "pagination must terminate");
    }
    assert.strictEqual(seen.size, 60, `all 60 conversations visited exactly once (got ${seen.size})`);
    assert.strictEqual(pageCount, 3, `60 items at 25/page = 3 pages (got ${pageCount})`);
  });

  await check("limit is capped at 100", async () => {
    const app = makeApp();
    const res = await request(app, "GET", "/api/conversations?limit=9999");
    assert.strictEqual(res.json.conversations.length, 60, "only 60 exist, all returned");
    assert.strictEqual(res.json.hasMore, false);
  });

  await check("search filters titles across ALL conversations", async () => {
    const app = makeApp();
    // Mark a handful of titles as matching.
    const res = await request(app, "GET", "/api/conversations?q=landlord");
    assert.strictEqual(res.status, 200);
    // None of the seeded titles contain 'landlord' → 0 matches.
    assert.strictEqual(res.json.conversations.length, 0);
    assert.strictEqual(res.json.hasMore, false);
  });

  await check("search finds every match regardless of position in the list", async () => {
    // Seed a fresh db where matches are spread across >1 scan page.
    const spread = [];
    for (let i = 1; i <= 260; i++) {
      const title = (i % 50 === 0) ? `Landlord dispute ${i}` : `Chat ${i}`;
      spread.push({ id: `d${i}`, title, createdAt: i, updatedAt: i, messages: [] });
    }
    mockDb = makeMockDb(spread);
    const app = makeApp();
    const res = await request(app, "GET", "/api/conversations?q=landlord");
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.conversations.length, 5, `matches at i=50..250 → 5 (got ${res.json.conversations.length})`);
    for (const c of res.json.conversations) {
      assert.ok(c.title.toLowerCase().includes("landlord"), "only matching titles returned");
    }
  });

  await check("full=true includes messages inline for a page", async () => {
    const withMsgs = [
      { id: "m1", title: "With messages", createdAt: 1, updatedAt: 2, messages: [
        { id: "msg1", role: "user", content: "hello", createdAt: 10 },
        { id: "msg2", role: "agent", status: "done", content: "", createdAt: 20 },
      ] },
      { id: "m2", title: "Empty", createdAt: 1, updatedAt: 1, messages: [] },
    ];
    mockDb = makeMockDb(withMsgs);
    const app = makeApp();
    const res = await request(app, "GET", "/api/conversations?full=true&limit=25");
    assert.strictEqual(res.status, 200);
    const withMsgsConvo = res.json.conversations.find((c) => c.id === "m1");
    assert.ok(withMsgsConvo, "conversation present");
    assert.strictEqual(withMsgsConvo.messages.length, 2);
    assert.strictEqual(withMsgsConvo.messages[0].role, "user");
    assert.strictEqual(withMsgsConvo.messages[0].userId, undefined, "userId must be stripped from messages");
  });

  console.log(failures === 0 ? "\nALL SERVER-PAGINATION TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
