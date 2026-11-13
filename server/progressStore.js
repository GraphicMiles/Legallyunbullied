/**
 * Live progress for one chat run, so the client can show the steps the agent
 * actually took instead of a timed animation.
 *
 * In-process and per-instance (the service runs as one Render instance). Each
 * run is keyed by the requester (uid, or "anon" for guests) plus the message
 * id the client generated. The entry holds stage labels and short details
 * only, never the question, the answer or any evidence text. Entries expire
 * after TTL_MS and are swept on each new run.
 */

const TTL_MS = 15 * 60 * 1000;
const MAX_STEPS = 12;
const MAX_TEXT = 160;
const RUN_ID = /^[A-Za-z0-9._~-]{1,128}$/;

const runs = new Map();

function keyFor(uid, messageId) {
  return `${uid || "anon"}:${messageId}`;
}

function sweep(now) {
  for (const [key, run] of runs) {
    if (now - run.updatedAt > TTL_MS) runs.delete(key);
  }
}

function clip(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
}

function begin(ref) {
  if (!ref || !RUN_ID.test(ref.messageId || "")) return;
  const now = Date.now();
  sweep(now);
  runs.set(keyFor(ref.uid, ref.messageId), { status: "running", startedAt: now, updatedAt: now, steps: [] });
}

/**
 * state: "active" starts a step, "done" completes it. A step that was never
 * started is added as done, so a stage can be reported in one call.
 */
function report(ref, step) {
  if (!ref || !RUN_ID.test(ref.messageId || "") || !step || !step.key) return;
  const run = runs.get(keyFor(ref.uid, ref.messageId));
  if (!run) return;
  const now = Date.now();
  run.updatedAt = now;
  let entry = run.steps.find((s) => s.key === step.key);
  if (!entry) {
    if (run.steps.length >= MAX_STEPS) return;
    entry = { key: clip(step.key), title: "", detail: "", state: "active", startedAt: now, elapsedMs: 0 };
    run.steps.push(entry);
  }
  if (step.title) entry.title = clip(step.title);
  if (step.detail !== undefined) entry.detail = clip(step.detail);
  if (step.state === "done" && entry.state !== "done") {
    entry.state = "done";
    entry.elapsedMs = Math.max(0, now - entry.startedAt);
  }
}

function finish(ref, status) {
  if (!ref || !RUN_ID.test(ref.messageId || "")) return;
  const run = runs.get(keyFor(ref.uid, ref.messageId));
  if (!run) return;
  const now = Date.now();
  run.status = status || "done";
  run.updatedAt = now;
  // A step that was still running when the run ended did not complete: a
  // failed or stopped run marks it "stopped" rather than "done".
  const completed = run.status === "done" || run.status === "needsInput";
  for (const s of run.steps) {
    if (s.state !== "done") {
      s.state = completed ? "done" : "stopped";
      s.elapsedMs = Math.max(0, now - s.startedAt);
    }
  }
}

function snapshot(ref) {
  if (!ref || !RUN_ID.test(ref.messageId || "")) return null;
  const run = runs.get(keyFor(ref.uid, ref.messageId));
  if (!run) return null;
  return {
    status: run.status,
    startedAt: run.startedAt,
    steps: run.steps.map(({ key, title, detail, state, elapsedMs }) => ({ key, title, detail, state, elapsedMs })),
  };
}

/** GET /api/chat/progress/:messageId. Auth is optional (guests are "anon"). */
function progressHandler(req, res) {
  const ref = { uid: req.uid || null, messageId: req.params.messageId };
  const snap = snapshot(ref);
  if (!snap) return res.status(404).json({ status: "unknown", steps: [] });
  res.setHeader("Cache-Control", "no-store");
  return res.json(snap);
}

module.exports = { begin, report, finish, snapshot, progressHandler, RUN_ID };
