/**
 * Agent trace for a legal answer.
 *
 * Shows only the steps the server reported as they actually ran (see
 * server/progressStore.js). Collapsed by default. The header carries the
 * elapsed time and, while the agent works, the name of the current step.
 * Expanding reveals every step that ran, each with its own timing.
 *
 * Updates are applied to existing rows in place, and the panel opens and
 * closes with a grid-rows transition, so the list is never rebuilt on toggle.
 *
 * API:
 *   new BeUIThinkingState(container, { startedAt, elapsedMs, steps, status })
 *   .update({ steps })                 apply progress while running
 *   .finish({ status, elapsedMs, steps })  freeze: "done" | "stopped"
 *   .destroy()                         remove from the DOM
 */

const AGTRACE_CHECK =
  '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3.2 8.6l3 3 6.6-6.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const AGTRACE_CARET =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 6.25l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const AGTRACE_STATES = ["active", "done", "stopped", "pending"];

/**
 * Elapsed time for display: whole seconds, then minutes, then hours.
 * 3 -> "3s", 125 -> "2m 5s", 3900 -> "1h 5m".
 */
function formatThinkingElapsed(ms) {
  const total = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes ? `${hours}h ${restMinutes}m` : `${hours}h`;
}

function normaliseAgtraceStep(step) {
  const state = AGTRACE_STATES.includes(step && step.state) ? step.state : "done";
  return {
    key: String((step && step.key) || ""),
    title: String((step && step.title) || "Working"),
    detail: String((step && step.detail) || ""),
    state,
    elapsedMs: Number(step && step.elapsedMs) || 0,
  };
}

let agtraceSeq = 0;

class BeUIThinkingState {
  constructor(container, options = {}) {
    this.container = container;
    this.startedAt = options.startedAt || null;
    this.elapsedMs = options.elapsedMs != null ? Number(options.elapsedMs) : null;
    this.steps = Array.isArray(options.steps) ? options.steps.map(normaliseAgtraceStep) : [];
    this.status = options.status || (this.startedAt && this.elapsedMs == null ? "running" : "done");
    this.destroyed = false;
    this.open = false;
    this.tickTimer = null;
    this.rows = new Map();
    this.markKind = null;
    this.id = `agtrace-${++agtraceSeq}`;

    this.build();
    this.renderSteps();
    this.renderLabel();
    this.syncTicker();
  }

  build() {
    const root = document.createElement("div");
    root.className = "agtrace";
    root.innerHTML = `
      <button type="button" class="agtrace__header" aria-expanded="false" aria-controls="${this.id}-panel">
        <span class="agtrace__mark" aria-hidden="true"></span>
        <span class="agtrace__label"><span class="agtrace__verb"></span> <span class="agtrace__time"></span></span>
        <span class="agtrace__now"></span>
        <span class="agtrace__caret" aria-hidden="true">${AGTRACE_CARET}</span>
      </button>
      <div class="agtrace__panel" id="${this.id}-panel">
        <div class="agtrace__inner">
          <ol class="agtrace__steps"></ol>
        </div>
      </div>`;
    this.element = root;
    this.header = root.querySelector(".agtrace__header");
    this.markEl = root.querySelector(".agtrace__mark");
    this.verbEl = root.querySelector(".agtrace__verb");
    this.timeEl = root.querySelector(".agtrace__time");
    this.nowEl = root.querySelector(".agtrace__now");
    this.listEl = root.querySelector(".agtrace__steps");
    this.header.addEventListener("click", () => this.setOpen(!this.open));
    this.container.appendChild(root);
  }

  setOpen(open) {
    if (this.destroyed) return;
    this.open = !!open;
    this.element.classList.toggle("is-open", this.open);
    this.header.setAttribute("aria-expanded", String(this.open));
  }

  elapsedNow() {
    if (this.status === "running" && this.startedAt != null) return Date.now() - this.startedAt;
    if (this.elapsedMs != null) return this.elapsedMs;
    return this.startedAt != null ? Date.now() - this.startedAt : 0;
  }

  setMark(kind) {
    if (this.markKind === kind) return;
    this.markKind = kind;
    this.markEl.className = `agtrace__mark is-${kind}`;
    this.markEl.innerHTML = kind === "done" ? AGTRACE_CHECK : "";
  }

  renderLabel() {
    if (this.destroyed) return;
    const running = this.status === "running";
    const stopped = this.status === "stopped";
    this.element.dataset.status = this.status;
    this.setMark(running ? "running" : stopped ? "stopped" : "done");

    this.verbEl.textContent = running ? "Thinking" : stopped ? "Stopped after" : "Thought for";
    this.timeEl.textContent = formatThinkingElapsed(this.elapsedNow());

    if (running) {
      // Name the step that is happening now, so the collapsed bar says what
      // the agent is doing without needing to expand it.
      const active = this.steps.find((s) => s.state === "active");
      this.nowEl.textContent = active ? active.title : "";
    } else {
      const n = this.steps.length;
      this.nowEl.textContent = n ? `${n} step${n === 1 ? "" : "s"}` : "";
    }
  }

  renderSteps() {
    if (this.destroyed) return;
    const seen = new Set();
    this.steps.forEach((step) => {
      const key = step.key || `step-${this.rows.size}`;
      seen.add(key);
      let row = this.rows.get(key);
      if (!row) {
        row = document.createElement("li");
        row.className = "agtrace__step";
        row.innerHTML = `
          <span class="agtrace__dot" aria-hidden="true"></span>
          <div class="agtrace__text">
            <div class="agtrace__title"></div>
            <div class="agtrace__detail"></div>
          </div>
          <span class="agtrace__step-time"></span>`;
        this.rows.set(key, row);
        this.listEl.appendChild(row);
      }
      row.dataset.state = step.state;
      row.querySelector(".agtrace__title").textContent = step.title;
      const detail = row.querySelector(".agtrace__detail");
      detail.textContent = step.detail;
      detail.hidden = !step.detail;
      const time = row.querySelector(".agtrace__step-time");
      if (step.state === "done" || step.state === "stopped") {
        time.textContent = step.elapsedMs < 500 ? "<1s" : formatThinkingElapsed(step.elapsedMs);
      } else {
        time.textContent = "";
      }
      const dot = row.querySelector(".agtrace__dot");
      dot.className = `agtrace__dot is-${step.state}`;
      dot.innerHTML = step.state === "done" ? AGTRACE_CHECK : "";
    });

    // Remove rows for steps that no longer exist (the list only grows in
    // practice, but keep the DOM and the data in step regardless).
    for (const [key, row] of this.rows) {
      if (!seen.has(key)) {
        row.remove();
        this.rows.delete(key);
      }
    }

    // Explain the empty list honestly instead of showing a placeholder step.
    let empty = this.listEl.querySelector(".agtrace__empty");
    if (!this.steps.length) {
      if (!empty) {
        empty = document.createElement("li");
        empty.className = "agtrace__empty";
        this.listEl.appendChild(empty);
      }
      empty.textContent = this.status === "running"
        ? "Sent your question. Waiting for the first step."
        : "No step details were recorded for this answer.";
    } else if (empty) {
      empty.remove();
    }
  }

  syncTicker() {
    if (this.destroyed) return;
    if (this.status === "running" && !this.tickTimer) {
      this.tickTimer = setInterval(() => this.renderLabel(), 1000);
    } else if (this.status !== "running" && this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  update(patch = {}) {
    if (this.destroyed || this.status !== "running") return;
    if (Array.isArray(patch.steps)) this.steps = patch.steps.map(normaliseAgtraceStep);
    this.renderSteps();
    this.renderLabel();
  }

  finish(patch = {}) {
    if (this.destroyed) return;
    const status = patch.status === "stopped" ? "stopped" : "done";
    if (Array.isArray(patch.steps)) this.steps = patch.steps.map(normaliseAgtraceStep);
    this.elapsedMs = patch.elapsedMs != null
      ? Number(patch.elapsedMs)
      : (this.startedAt != null ? Date.now() - this.startedAt : 0);
    // A step still marked active never completed. Show it as stopped when the
    // run was stopped, and as done when the run finished normally.
    this.steps = this.steps.map((s) => (s.state === "active"
      ? { ...s, state: status === "stopped" ? "stopped" : "done" }
      : s));
    this.status = status;
    this.syncTicker();
    this.renderSteps();
    this.renderLabel();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
    if (this.element && this.element.parentNode) this.element.parentNode.removeChild(this.element);
  }
}

if (typeof window !== "undefined") {
  window.BeUIThinkingState = BeUIThinkingState;
  window.formatThinkingElapsed = formatThinkingElapsed;
}
