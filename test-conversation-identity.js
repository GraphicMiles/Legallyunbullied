/**
 * Unit tests for the conversation identity fix.
 *
 * Verifies, at the API level (with an in-memory mock Firestore), that:
 *   1. POST /api/conversations honors a client-supplied ID (one ID everywhere).
 *   2. POST /api/conversations is idempotent for the same ID.
 *   3. POST /api/conversations/migrate preserves original IDs.
 *   4. POST /api/conversations/migrate is idempotent (never duplicates).
 *   5. POST /api/conversations/cleanup keeps the newest empty conversation.
 *   6. Ownership checks return 404 for foreign users.
 *
 * Run: node test-conversation-identity.js
 */

const assert = require("assert");

// ── In-memory Firestore mock ──────────────────────────────────────────────
function makeMockFirestore() {
  const store = new Map(); // "users/{uid}/conversations/{cid}" -> data
  let autoIdCounter = 0;

  function makeDocRef(pathParts) {
    const id = pathParts[pathParts.length - 1];
    const fullPath = pathParts.join("/");
    return {
      id,
      get: async () => {
        const data = store.get(fullPath);
        return { exists: !!data, data: () => data || {} };
      },
      set: async (data) => { store.set(fullPath, { ...data }); },
      update: async (data) => { store.set(fullPath, { ...(store.get(fullPath) || {}), ...data }); },
      delete: async () => { store.delete(fullPath); },
      collection: (name) => makeCollection([...pathParts, name]),
    };
  }

  function makeCollection(pathParts) {
    return {
      doc: (id) => {
        if (id === undefined) {
          // Auto-generate a Firestore-style 20-char ID
          autoIdCounter += 1;
          const s = "auto" + String(autoIdCounter).padStart(8, "0");
          return makeDocRef([...pathParts, s]);
        }
        return makeDocRef([...pathParts, id]);
      },
      orderBy: () => makeQuery(pathParts),
      limit: () => makeQuery(pathParts),
      get: async () => makeSnapshot(await listDocs(pathParts)),
      count: () => ({
        get: async () => {
          const docs = await listDocs(pathParts);
          return { data: () => ({ count: docs.length }) };
        },
      }),
    };
  }

  function makeQuery(pathParts) {
    return { limit: () => makeQuery(pathParts), get: async () => makeSnapshot(await listDocs(pathParts)) };
  }

  async function listDocs(pathParts) {
    const prefix = pathParts.join("/");
    const docs = [];
    for (const [k, v] of store.entries()) {
      if (k.startsWith(prefix + "/")) {
        const rest = k.slice(prefix.length + 1);
        if (!rest.includes("/")) {
          const ref = makeDocRef([...pathParts, rest]);
          docs.push({ id: rest, data: () => v, ref });
        }
      }
    }
    return docs;
  }

  function makeSnapshot(docs) {
    return { docs };
  }

  return {
    _store: store,
    collection: (name) => makeCollection([name]),
    batch: () => {
      const ops = [];
      return {
        set: (ref, data) => ops.push(() => ref.set(data)),
        delete: (ref) => ops.push(() => ref.delete()),
        commit: async () => { for (const op of ops) await op(); },
      };
    },
    settings: () => {},
  };
}

// The mock Firestore uses a flat store; adapt msgRef/message paths to it via
// the same doc/collection interface, so the router code works unchanged.
// NOTE: the router stores messages in a SUBCOLLECTION of the conversation doc,
// which our mock models as paths ending in /messages/{msgId}. The flat key
// scheme above handles that naturally.

// ── Wire the mock into the router's require() calls ───────────────────────
let CURRENT_UID = "test-user";

const adminPath = require.resolve("./server/firebaseAdmin");
const authPath = require.resolve("./server/authMiddleware");
const mockDb = makeMockFirestore();

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

const express = require("express");
const conversationRoute = require("./server/conversationRoute");

// ── HTTP test harness ─────────────────────────────────────────────────────
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/conversations", conversationRoute);
  return app;
}

function request(app, method, url, body) {
  return new Promise((resolve) => {
    const { Server } = require("http");
    const server = Server(app);
    server.listen(0, () => {
      const port = server.address().port;
      const data = body ? JSON.stringify(body) : undefined;
      const req = require("http").request(
        { host: "127.0.0.1", port, path: url, method, headers: data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {} },
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
      if (data) req.write(data);
      req.end();
    });
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────
let failures = 0;
function check(name, fn) {
  return fn().then(() => {
    console.log(`  PASS  ${name}`);
  }).catch((err) => {
    failures += 1;
    console.log(`  FAIL  ${name}\n        ${err.message}`);
  });
}

async function main() {
  console.log("\n=== Conversation identity tests ===\n");

  await check("create honors client-supplied ID", async () => {
    const app = makeApp();
    const res = await request(app, "POST", "/api/conversations", { id: "abc-123", title: "Hello" });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.json.id, "abc-123", `expected echo of client id, got ${res.json && res.json.id}`);
    // Verify the persisted document ID matches
    const stored = mockDb._store.get("users/test-user/conversations/abc-123");
    assert.ok(stored, "conversation doc should exist under the client-supplied ID");
    assert.strictEqual(stored.userId, "test-user");
  });

  await check("create without id still generates one", async () => {
    const app = makeApp();
    const res = await request(app, "POST", "/api/conversations", { title: "x" });
    assert.strictEqual(res.status, 201);
    assert.ok(res.json.id && res.json.id.length > 0, "server should generate an id");
  });

  await check("create with same id is idempotent (no overwrite)", async () => {
    const app = makeApp();
    await request(app, "POST", "/api/conversations", { id: "dup-1", title: "First" });
    const res2 = await request(app, "POST", "/api/conversations", { id: "dup-1", title: "Second" });
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.json.id, "dup-1");
    const stored = mockDb._store.get("users/test-user/conversations/dup-1");
    assert.strictEqual(stored.title, "First", "title must not be clobbered by an idempotent re-create");
  });

  await check("migrate preserves original conversation IDs", async () => {
    const app = makeApp();
    const res = await request(app, "POST", "/api/conversations/migrate", {
      conversations: [
        { id: "u1", title: "Chat one", createdAt: 1000, messages: [{ id: "m1", role: "user", content: "hi", createdAt: 1000 }] },
        { id: "u2", title: "Chat two", createdAt: 2000, messages: [] },
      ],
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.migrated, 2);
    assert.strictEqual(res.json.idMap["u1"], "u1", "migration must NOT remap a valid client ID");
    assert.strictEqual(res.json.idMap["u2"], "u2");
    assert.ok(mockDb._store.get("users/test-user/conversations/u1"), "doc should exist under original ID u1");
    assert.ok(mockDb._store.get("users/test-user/conversations/u2"));
  });

  await check("migrate is idempotent (re-run creates no duplicates)", async () => {
    const app = makeApp();
    const res = await request(app, "POST", "/api/conversations/migrate", {
      conversations: [{ id: "u1", title: "Chat one", createdAt: 1000, messages: [] }],
    });
    assert.strictEqual(res.json.migrated, 0, "second migration of existing ID must not re-create");
    assert.strictEqual(res.json.skipped, 1);
    const keys = [...mockDb._store.keys()].filter((k) => k.endsWith("/u1"));
    assert.strictEqual(keys.length, 1, `expected exactly 1 doc for u1, found ${keys.length}`);
  });

  await check("migrate with invalid ID generates a new one", async () => {
    const app = makeApp();
    const res = await request(app, "POST", "/api/conversations/migrate", {
      conversations: [{ id: "not a valid id!", title: "weird", messages: [] }],
    });
    assert.strictEqual(res.json.migrated, 1);
    const mapped = res.json.idMap["not a valid id!"];
    assert.ok(mapped && mapped !== "not a valid id!", "invalid ID should be remapped to a generated ID");
  });

  await check("cleanup keeps the newest empty conversation", async () => {
    // Reset uid-specific store by using a fresh uid
    CURRENT_UID = "cleanup-user";
    const app = makeApp();
    await request(app, "POST", "/api/conversations", { id: "old-1", title: "New question" });
    await request(app, "POST", "/api/conversations", { id: "old-2", title: "New question" });
    await request(app, "POST", "/api/conversations", { id: "newest", title: "New question" });
    // Simulate differing updatedAt
    mockDb._store.get("users/cleanup-user/conversations/old-1").updatedAt = 1000;
    mockDb._store.get("users/cleanup-user/conversations/old-2").updatedAt = 2000;
    mockDb._store.get("users/cleanup-user/conversations/newest").updatedAt = 3000;

    const res = await request(app, "POST", "/api/conversations/cleanup", {});
    assert.strictEqual(res.json.deleted, 2);
    assert.ok(!mockDb._store.get("users/cleanup-user/conversations/old-1"), "old-1 should be deleted");
    assert.ok(!mockDb._store.get("users/cleanup-user/conversations/old-2"), "old-2 should be deleted");
    assert.ok(mockDb._store.get("users/cleanup-user/conversations/newest"), "newest empty chat must survive");
  });

  await check("cleanup with a single empty conversation deletes nothing", async () => {
    CURRENT_UID = "cleanup-solo-user";
    const app = makeApp();
    await request(app, "POST", "/api/conversations", { id: "solo", title: "New question" });
    const res = await request(app, "POST", "/api/conversations/cleanup", {});
    assert.strictEqual(res.json.deleted, 0);
    assert.ok(mockDb._store.get("users/cleanup-solo-user/conversations/solo"), "solo empty chat must survive");
  });

  await check("ownership: foreign user gets 404 (not the data)", async () => {
    CURRENT_UID = "owner-user";
    let app = makeApp();
    await request(app, "POST", "/api/conversations", { id: "private-1", title: "Secret" });

    CURRENT_UID = "intruder-user";
    app = makeApp();
    const res = await request(app, "GET", "/api/conversations/private-1");
    assert.strictEqual(res.status, 404);
  });

  await check("GET list returns the persisted document ID as conversation id", async () => {
    CURRENT_UID = "list-user";
    const app = makeApp();
    await request(app, "POST", "/api/conversations", { id: "list-1", title: "One" });
    const res = await request(app, "GET", "/api/conversations");
    assert.strictEqual(res.status, 200);
    const ids = res.json.conversations.map((c) => c.id);
    assert.ok(ids.includes("list-1"), `list should include persisted id list-1, got ${ids}`);
    assert.ok(ids.every((id) => id === "list-1"), "no unexpected extra conversations");
  });

  console.log(failures === 0
    ? `\nALL TESTS PASSED`
    : `\n${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
