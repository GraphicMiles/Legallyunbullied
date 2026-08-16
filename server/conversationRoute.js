/**
 * Conversation persistence API — Firestore-backed.
 *
 * All endpoints require Firebase auth (req.uid set by requireAuth middleware).
 * Data is scoped to users/{uid}/conversations/... so each user only sees their own.
 *
 * Endpoints:
 *   GET    /api/conversations              — list (summary, no messages)
 *   POST   /api/conversations              — create new
 *   GET    /api/conversations/:id          — fetch with full messages + steps
 *   PUT    /api/conversations/:id          — update title/updatedAt
 *   DELETE /api/conversations/:id          — delete conversation + all messages
 *   PUT    /api/conversations/:id/messages/:msgId — upsert a message
 *   DELETE /api/conversations/:id/messages — clear all messages in a conversation
 *   POST   /api/conversations/migrate      — bulk import from localStorage
 */

const express = require("express");
const router = express.Router();
const { getFirestore } = require("./firebaseAdmin");
const { requireAuth } = require("./authMiddleware");

// All routes require auth
router.use(requireAuth);

function db() {
  const instance = getFirestore();
  if (!instance) {
    throw new Error("Firestore is not configured on the server.");
  }
  return instance;
}

function convoRef(uid, convoId) {
  return db().collection("users").doc(uid).collection("conversations").doc(convoId);
}

function convoCollection(uid) {
  return db().collection("users").doc(uid).collection("conversations");
}

function msgRef(uid, convoId, msgId) {
  return convoRef(uid, convoId).collection("messages").doc(msgId);
}

function msgCollection(uid, convoId) {
  return convoRef(uid, convoId).collection("messages");
}

// ── Canonical conversation identity ────────────────────────────────────────
// The conversation ID is the single source of truth everywhere:
//   client conversation.id  =  Firestore document ID  =  URL :chatId
// A valid ID is URL-safe, bounded in length, and not a reserved route name
// (a client could otherwise shadow /migrate or /cleanup). Both UUID v4 strings
// (client-generated) and Firestore auto-IDs (legacy data) satisfy this.
const RESERVED_CONVO_IDS = new Set(["migrate", "cleanup"]);

function isValidConvoId(id) {
  return (
    typeof id === "string" &&
    id.length > 0 &&
    id.length <= 128 &&
    /^[A-Za-z0-9._~-]+$/.test(id) &&
    !RESERVED_CONVO_IDS.has(id.toLowerCase())
  );
}

// ── GET /api/conversations — list summaries or full conversations ──────────
// ?full=true returns conversations with all messages inline (avoids N+1 queries)
// Without ?full, returns summaries only (lightweight for sidebar)
router.get("/", async (req, res) => {
  try {
    const includeFull = req.query.full === "true";
    const snapshot = await convoCollection(req.uid)
      .orderBy("updatedAt", "desc")
      .limit(100)
      .get();

    const conversations = [];
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const base = {
        id: doc.id,
        title: data.title || "New question",
        createdAt: data.createdAt?._seconds ? data.createdAt._seconds * 1000 : data.createdAt || Date.now(),
        updatedAt: data.updatedAt?._seconds ? data.updatedAt._seconds * 1000 : data.updatedAt || Date.now(),
      };

      if (includeFull) {
        // Fetch all messages for this conversation inline
        const msgSnapshot = await convoRef(req.uid, doc.id)
          .collection("messages")
          .orderBy("createdAt", "asc")
          .get();
        base.messages = msgSnapshot.docs.map(d => {
          const msgData = d.data();
          const { userId, ...rest } = msgData;
          return { id: d.id, ...rest };
        });
      } else {
        // Lightweight: just message count
        const msgSnapshot = await convoRef(req.uid, doc.id).collection("messages").count().get();
        base.messageCount = msgSnapshot.data().count;
      }

      conversations.push(base);
    }

    res.json({ conversations });
  } catch (err) {
    console.error("[conversations] GET list failed:", err.message);
    res.status(500).json({ error: "fetch_failed", message: err.message });
  }
});

// ── POST /api/conversations — create new ───────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const { title, id } = req.body || {};
    const now = Date.now();

    // Canonical identity: honor the client-supplied ID so the conversation is
    // persisted under the exact document ID the client generated. A new ID is
    // only minted here when the client did not provide a valid one.
    const ref = isValidConvoId(id)
      ? convoCollection(req.uid).doc(id)
      : convoCollection(req.uid).doc();

    // Idempotent create: if this exact ID already exists, return it unchanged
    // instead of overwriting it (protects against sync retries re-creating or
    // clobbering an existing conversation).
    if (isValidConvoId(id)) {
      const existing = await ref.get();
      if (existing.exists) {
        const data = existing.data();
        return res.status(200).json({
          id: ref.id,
          title: data.title || "New question",
          createdAt: data.createdAt || now,
          updatedAt: data.updatedAt || now,
        });
      }
    }

    await ref.set({
      userId: req.uid,
      title: title || "New question",
      createdAt: now,
      updatedAt: now,
    });

    res.status(201).json({
      id: ref.id,
      title: title || "New question",
      createdAt: now,
      updatedAt: now,
    });
  } catch (err) {
    console.error("[conversations] POST create failed:", err.message);
    res.status(500).json({ error: "create_failed", message: err.message });
  }
});

// ── GET /api/conversations/:id — fetch with full messages ──────────────────
router.get("/:id", async (req, res) => {
  try {
    const ref = convoRef(req.uid, req.params.id);
    const doc = await ref.get();

    if (!doc.exists) {
      return res.status(404).json({ error: "not_found", message: "Conversation not found." });
    }

    const data = doc.data();

    // Verify ownership
    if (data.userId !== req.uid) {
      return res.status(404).json({ error: "not_found", message: "Conversation not found." });
    }

    // Fetch all messages ordered by creation time
    const msgSnapshot = await ref.collection("messages")
      .orderBy("createdAt", "asc")
      .get();

    const messages = msgSnapshot.docs.map(d => {
      const msgData = d.data();
      return { id: d.id, ...msgData };
    });

    res.json({
      id: doc.id,
      title: data.title || "New question",
      createdAt: data.createdAt || Date.now(),
      updatedAt: data.updatedAt || Date.now(),
      messages,
    });
  } catch (err) {
    console.error("[conversations] GET single failed:", err.message);
    res.status(500).json({ error: "fetch_failed", message: err.message });
  }
});

// ── PUT /api/conversations/:id — update title ──────────────────────────────
router.put("/:id", async (req, res) => {
  try {
    const ref = convoRef(req.uid, req.params.id);
    const doc = await ref.get();

    if (!doc.exists) {
      return res.status(404).json({ error: "not_found", message: "Conversation not found." });
    }

    const data = doc.data();
    if (data.userId !== req.uid) {
      return res.status(404).json({ error: "not_found", message: "Conversation not found." });
    }

    const updates = { updatedAt: Date.now() };
    if (req.body.title !== undefined) updates.title = req.body.title;

    await ref.update(updates);
    res.json({ success: true });
  } catch (err) {
    console.error("[conversations] PUT update failed:", err.message);
    res.status(500).json({ error: "update_failed", message: err.message });
  }
});

// ── DELETE /api/conversations/:id ──────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    const ref = convoRef(req.uid, req.params.id);
    const doc = await ref.get();

    if (!doc.exists) {
      return res.status(404).json({ error: "not_found", message: "Conversation not found." });
    }

    const data = doc.data();
    if (data.userId !== req.uid) {
      return res.status(404).json({ error: "not_found", message: "Conversation not found." });
    }

    // Delete all messages first (subcollection), then the conversation doc
    const msgSnapshot = await ref.collection("messages").get();
    const batch = db().batch();
    msgSnapshot.docs.forEach(d => batch.delete(d.ref));
    batch.delete(ref);
    await batch.commit();

    res.json({ success: true });
  } catch (err) {
    console.error("[conversations] DELETE failed:", err.message);
    res.status(500).json({ error: "delete_failed", message: err.message });
  }
});

// ── PUT /api/conversations/:id/messages/:msgId — upsert a message ──────────
router.put("/:id/messages/:msgId", async (req, res) => {
  try {
    const convoDoc = await convoRef(req.uid, req.params.id).get();
    if (!convoDoc.exists) {
      return res.status(404).json({ error: "not_found", message: "Conversation not found." });
    }
    if (convoDoc.data().userId !== req.uid) {
      return res.status(404).json({ error: "not_found", message: "Conversation not found." });
    }

    const messageData = req.body;
    // Ensure userId is set correctly
    messageData.userId = req.uid;

    await msgRef(req.uid, req.params.id, req.params.msgId).set(messageData, { merge: true });

    // Touch the conversation's updatedAt
    await convoRef(req.uid, req.params.id).update({ updatedAt: Date.now() });

    res.json({ success: true });
  } catch (err) {
    console.error("[conversations] PUT message failed:", err.message);
    res.status(500).json({ error: "save_message_failed", message: err.message });
  }
});

// ── DELETE /api/conversations/:id/messages — clear all messages ────────────
router.delete("/:id/messages", async (req, res) => {
  try {
    const convoDoc = await convoRef(req.uid, req.params.id).get();
    if (!convoDoc.exists) {
      return res.status(404).json({ error: "not_found" });
    }
    if (convoDoc.data().userId !== req.uid) {
      return res.status(404).json({ error: "not_found", message: "Conversation not found." });
    }

    const msgSnapshot = await msgCollection(req.uid, req.params.id).get();
    const batch = db().batch();
    msgSnapshot.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();

    // Update the conversation timestamp
    await convoRef(req.uid, req.params.id).update({ updatedAt: Date.now() });

    res.json({ success: true });
  } catch (err) {
    console.error("[conversations] DELETE messages failed:", err.message);
    res.status(500).json({ error: "clear_messages_failed", message: err.message });
  }
});

// ── POST /api/conversations/migrate — bulk import from localStorage ────────
// Accepts an array of conversations with their messages.
// Preserves the client's conversation ID as the Firestore document ID so the
// identity survives migration. Idempotent: re-running it never duplicates a
// conversation — if the ID already exists it is skipped.
router.post("/migrate", async (req, res) => {
  try {
    const { conversations } = req.body;
    if (!Array.isArray(conversations) || conversations.length === 0) {
      return res.status(400).json({ error: "bad_request", message: "Expected { conversations: [...] }" });
    }

    // Limit migration batch size
    if (conversations.length > 50) {
      return res.status(400).json({ error: "too_many", message: "Maximum 50 conversations per migration batch." });
    }

    const idMap = {}; // oldId -> canonicalId (identity unless oldId was invalid)
    let migrated = 0;
    let skipped = 0;

    for (const convo of conversations) {
      try {
        // Preserve the original ID. A new ID is only generated when the
        // incoming ID is missing or invalid — never during normal migration.
        const docId = isValidConvoId(convo.id)
          ? convo.id
          : convoCollection(req.uid).doc().id;
        idMap[convo.id] = docId;

        const newConvoRef = convoCollection(req.uid).doc(docId);
        const now = Date.now();

        // Idempotency: if this conversation already exists on the server,
        // skip it — re-running migration must never create a duplicate.
        const existing = await newConvoRef.get();
        if (existing.exists) {
          skipped++;
          continue;
        }

        await newConvoRef.set({
          userId: req.uid,
          title: (convo.title || "New question").slice(0, 200),
          createdAt: convo.createdAt || now,
          updatedAt: convo.updatedAt || convo.createdAt || now,
        });

        // Write messages in batches of 400 (Firestore batch limit is 500)
        if (convo.messages && convo.messages.length > 0) {
          const messages = convo.messages;
          for (let i = 0; i < messages.length; i += 400) {
            const batch = db().batch();
            const chunk = messages.slice(i, i + 400);
            for (const msg of chunk) {
              const msgId = msg.id || msgCollection(req.uid, docId).doc().id;
              // Clean msg data — strip any internal flags, limit field sizes
              const { _synced, ...cleanMsg } = msg;
              const msgData = {
                ...cleanMsg,
                userId: req.uid,
                content: (cleanMsg.content || "").slice(0, 10000),
                casualReply: (cleanMsg.casualReply || "").slice(0, 5000),
              };
              batch.set(msgRef(req.uid, docId, msgId), msgData);
            }
            await batch.commit();
          }
        }
        migrated++;
      } catch (err) {
        // Skip this conversation, continue with the rest
        console.warn(`[conversations] Migration: skipped "${convo.id}": ${err.message}`);
        skipped++;
      }
    }

    console.log(`[conversations] Migrated ${migrated} conversations for user ${req.uid} (${skipped} skipped; original IDs preserved)`);
    res.json({ success: true, idMap, migrated, skipped });
  } catch (err) {
    console.error("[conversations] Migration failed:", err.message);
    res.status(500).json({ error: "migration_failed", message: err.message });
  }
});

// ── POST /api/conversations/cleanup — delete duplicate empty conversations ──
// Removes redundant empty conversations left over from the old sync-loop bug.
// Keeps the most recently updated empty conversation (a user's current,
// just-created "New question" chat is legitimate and must never be wiped).
// Conversations with messages are always kept.
router.post("/cleanup", async (req, res) => {
  try {
    const snapshot = await convoCollection(req.uid).get();

    // Collect empty conversations (no messages) with their timestamps.
    const empties = [];
    for (const doc of snapshot.docs) {
      const msgCount = await convoRef(req.uid, doc.id)
        .collection("messages").count().get();
      if (msgCount.data().count === 0) {
        const data = doc.data();
        const updatedAt = data.updatedAt?._seconds
          ? data.updatedAt._seconds * 1000
          : (data.updatedAt || 0);
        empties.push({ ref: doc.ref, updatedAt });
      }
    }

    // Nothing to clean up: 0 or 1 empty conversation is a valid state.
    if (empties.length <= 1) {
      return res.json({ success: true, deleted: 0, message: "Nothing to clean up" });
    }

    // Keep the newest empty conversation; delete the older duplicates.
    empties.sort((a, b) => b.updatedAt - a.updatedAt);
    const toDelete = empties.slice(1).map((e) => e.ref);

    // Delete in batches of 400 (Firestore limit is 500)
    for (let i = 0; i < toDelete.length; i += 400) {
      const batch = db().batch();
      const chunk = toDelete.slice(i, i + 400);
      chunk.forEach(ref => batch.delete(ref));
      await batch.commit();
    }

    console.log(`[conversations] Cleanup: deleted ${toDelete.length} duplicate empty conversations for user ${req.uid}`);
    res.json({ success: true, deleted: toDelete.length });
  } catch (err) {
    console.error("[conversations] Cleanup failed:", err.message);
    res.status(500).json({ error: "cleanup_failed", message: err.message });
  }
});

module.exports = router;
