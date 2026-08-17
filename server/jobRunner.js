/**
 * In-process background job runner + Firestore-backed job state (no Redis).
 *
 * Delivers "restart-and-complete" for recoverable requests:
 *
 *   - Live requests run the pipeline inline (unchanged UX) and, in parallel,
 *     record a `background_jobs/{messageId}` document with status
 *     running → done/failed/awaiting_input so the job is durable.
 *   - If the server restarts mid-pipeline, the process's in-flight work dies
 *     but the job document stays "running". A periodic sweeper resets jobs
 *     that have been "running" longer than STALE_RUNNING_MS back to "queued".
 *   - A concurrency-limited in-process worker picks up "queued" jobs and re-runs
 *     the SAME pipeline (chatRoute.runChatPipeline) — restart-and-complete.
 *
 * Single-instance by design (matches the Render free-tier deployment). No
 * Redis/BullMQ: the queue is in-memory, the durable state is Firestore.
 * `background_jobs` is a top-level collection queried only via the Admin SDK
 * (client access is denied by the existing catch-all security rule).
 */

const { getFirestore } = require("./firebaseAdmin");

const STALE_RUNNING_MS = 5 * 60 * 1000; // a pipeline never legitimately runs this long (client timeout is 180s)
const SWEEP_INTERVAL_MS = 60 * 1000;
const MAX_CONCURRENT = Math.max(1, parseInt(process.env.JOB_CONCURRENCY, 10) || 1);

const queue = [];
const enqueuedIds = new Set();
let active = 0;
let started = false;

function db() {
  return getFirestore();
}

function deriveTerminalStatus(result) {
  const payload = (result && result.body) || {};
  if (!result || result.status >= 400) return "failed";
  if (payload.needsInput) return "awaiting_input";
  if (payload.providersBusy) return "failed";
  return "done";
}

// ── Job record lifecycle (called by the live HTTP handler) ────────────────
// Fully defensive: never throws (older clients / non-Firestore environments).
function recordJobStart(req) {
  try {
    const uid = req && req.uid;
    const body = (req && req.body) || {};
    const conversationId = typeof body.conversationId === "string" && body.conversationId ? body.conversationId : null;
    const messageId = typeof body.messageId === "string" && body.messageId ? body.messageId : null;
    if (!uid || !conversationId || !messageId) return Promise.resolve();
    const d = db();
    if (!d) return Promise.resolve();
    return d.collection("background_jobs").doc(messageId).set({
      uid,
      conversationId,
      messageId,
      question: body.question || "",
      history: Array.isArray(body.history) ? body.history : [],
      status: "running",
      startedAt: Date.now(),
      createdAt: Date.now(),
    }, { merge: true }).catch((err) => console.warn("[jobs] recordJobStart failed:", err.message));
  } catch (err) {
    console.warn("[jobs] recordJobStart failed:", err.message);
    return Promise.resolve();
  }
}

function recordJobEnd(req, result) {
  try {
    const uid = req && req.uid;
    const body = (req && req.body) || {};
    const conversationId = typeof body.conversationId === "string" && body.conversationId ? body.conversationId : null;
    const messageId = typeof body.messageId === "string" && body.messageId ? body.messageId : null;
    if (!uid || !conversationId || !messageId) return Promise.resolve();
    const d = db();
    if (!d) return Promise.resolve();
    return d.collection("background_jobs").doc(messageId).set({
      status: deriveTerminalStatus(result),
      updatedAt: Date.now(),
    }, { merge: true }).catch((err) => console.warn("[jobs] recordJobEnd failed:", err.message));
  } catch (err) {
    console.warn("[jobs] recordJobEnd failed:", err.message);
    return Promise.resolve();
  }
}

// ── Worker ─────────────────────────────────────────────────────────────────
async function runJob(job) {
  const { jobId, uid, conversationId, messageId, question, history, checkpoints } = job;
  const d = db();
  if (d) {
    await d.collection("background_jobs").doc(jobId).set({ status: "running", startedAt: Date.now() }, { merge: true })
      .catch((err) => console.warn("[jobs] mark running failed:", err.message));
  }

  // Lazy require avoids a load-order cycle (chatRoute requires jobRunner).
  const chatRoute = require("./chatRoute");
  const fakeReq = {
    uid,
    body: { question, history: history || [], conversationId, messageId },
    // Checkpoint resume: pass saved step outputs and a callback that persists
    // new ones, so a re-run continues from the last completed step.
    checkpoints: checkpoints || {},
    saveCheckpoint: async (field, value) => {
      const dd = db();
      if (!dd) return;
      try {
        const snap = await dd.collection("background_jobs").doc(jobId).get();
        const existing = (snap.exists && snap.data() && snap.data().checkpoints) || {};
        existing[field] = value;
        await dd.collection("background_jobs").doc(jobId).set({ checkpoints: existing }, { merge: true });
      } catch (err) {
        console.warn("[jobs] saveCheckpoint failed:", err.message);
      }
    },
  };

  let result;
  try {
    result = await chatRoute.runChatPipeline(fakeReq);
  } catch (err) {
    console.error("[jobs] runChatPipeline threw:", err && err.stack ? err.stack : err);
    result = { status: 500, body: { error: "internal_error", message: "Background processing failed." } };
  }

  if (d) {
    await d.collection("background_jobs").doc(jobId).set({
      status: deriveTerminalStatus(result),
      updatedAt: Date.now(),
    }, { merge: true }).catch((err) => console.warn("[jobs] mark terminal failed:", err.message));
  }
}

function enqueue(job) {
  if (!job || !job.jobId || enqueuedIds.has(job.jobId)) return;
  enqueuedIds.add(job.jobId);
  queue.push(job);
  drain();
}

function drain() {
  while (active < MAX_CONCURRENT && queue.length) {
    const job = queue.shift();
    active++;
    runJob(job)
      .catch((err) => console.error("[jobs] job crashed:", err && err.stack ? err.stack : err))
      .finally(() => {
        active--;
        enqueuedIds.delete(job.jobId);
        drain();
      });
  }
}

// ── Sweeper (restart-and-complete) ────────────────────────────────────────
async function sweepOnce() {
  const d = db();
  if (!d) return;

  // Reset genuinely-stale "running" jobs back to "queued".
  try {
    const running = await d.collection("background_jobs").where("status", "==", "running").get();
    let reset = 0;
    for (const doc of running.docs) {
      const data = doc.data() || {};
      const startedAt = data.startedAt || 0;
      if (Date.now() - startedAt > STALE_RUNNING_MS) {
        await doc.ref.set({ status: "queued" }, { merge: true }).catch(() => {});
        reset++;
      }
    }
    if (reset) console.log(`[jobs] Reset ${reset} stale running job(s) to queued`);
  } catch (err) {
    console.warn("[jobs] sweep(running) failed:", err.message);
  }

  // Enqueue everything currently queued.
  try {
    const queued = await d.collection("background_jobs").where("status", "==", "queued").get();
    let added = 0;
    for (const doc of queued.docs) {
      const data = doc.data() || {};
      if (data.uid && data.messageId && data.question) {
        enqueue({
          jobId: doc.id,
          uid: data.uid,
          conversationId: data.conversationId,
          messageId: data.messageId,
          question: data.question,
          history: data.history || [],
          checkpoints: data.checkpoints || {},
        });
        added++;
      }
    }
    if (added) console.log(`[jobs] Enqueued ${added} queued job(s)`);
  } catch (err) {
    console.warn("[jobs] sweep(queued) failed:", err.message);
  }
}

function sweepAndStart() {
  if (started) return;
  started = true;
  const d = db();
  if (!d) {
    console.log("[jobs] Firestore not configured — background worker disabled.");
    return;
  }
  sweepOnce().catch(() => {});
  setInterval(() => sweepOnce().catch(() => {}), SWEEP_INTERVAL_MS).unref();
}

// Test-only hooks.
function __reset() {
  queue.length = 0;
  enqueuedIds.clear();
  active = 0;
  started = false;
}

module.exports = {
  recordJobStart,
  recordJobEnd,
  sweepAndStart,
  sweepOnce,
  enqueue,
  runJob,
  deriveTerminalStatus,
  getQueueStats: () => ({ queued: queue.length, active }),
  __reset,
};
