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

// ── GET /api/conversations — list summaries ────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const snapshot = await convoCollection(req.uid)
      .orderBy("updatedAt", "desc")
      .limit(100)
      .get();

    const conversations = [];
    for (const doc of snapshot.docs) {
      const data = doc.data();
      // Get message count for each conversation
      const msgSnapshot = await convoRef(req.uid, doc.id).collection("messages").count().get();
      const messageCount = msgSnapshot.data().count;

      conversations.push({
        id: doc.id,
        title: data.title || "New question",
        createdAt: data.createdAt?._seconds ? data.createdAt._seconds * 1000 : data.createdAt || Date.now(),
        updatedAt: data.updatedAt?._seconds ? data.updatedAt._seconds * 1000 : data.updatedAt || Date.now(),
        messageCount,
      });
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
    const { title } = req.body || {};
    const now = Date.now();
    const ref = convoCollection(req.uid).doc();

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
// Creates them in Firestore, returns the new IDs mapping.
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

    const idMap = {}; // oldId -> newId

    for (const convo of conversations) {
      const newConvoRef = convoCollection(req.uid).doc();
      const now = Date.now();

      await newConvoRef.set({
        userId: req.uid,
        title: convo.title || "New question",
        createdAt: convo.createdAt || now,
        updatedAt: convo.updatedAt || convo.createdAt || now,
      });

      idMap[convo.id] = newConvoRef.id;

      // Write messages in batches of 400 (Firestore batch limit is 500)
      if (convo.messages && convo.messages.length > 0) {
        const messages = convo.messages;
        for (let i = 0; i < messages.length; i += 400) {
          const batch = db().batch();
          const chunk = messages.slice(i, i + 400);
          for (const msg of chunk) {
            const msgId = msg.id || msgCollection(req.uid, newConvoRef.id).doc().id;
            const msgData = { ...msg, userId: req.uid };
            batch.set(msgRef(req.uid, newConvoRef.id, msgId), msgData);
          }
          await batch.commit();
        }
      }
    }

    console.log(`[conversations] Migrated ${conversations.length} conversations for user ${req.uid}`);
    res.json({ success: true, idMap });
  } catch (err) {
    console.error("[conversations] Migration failed:", err.message);
    res.status(500).json({ error: "migration_failed", message: err.message });
  }
});

module.exports = router;
