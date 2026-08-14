/* ==========================================================================
   Legally Unbullied — Phase 1 AI Agent Answer UI
   Conversation store (localStorage) + a simulated agent pipeline with a
   real timeline trace, markdown streaming, expandable source cards, and
   follow-up suggestions.
   ========================================================================== */

(function () {
  "use strict";

  const STORAGE_KEY = "lu.conversations.v3";
  const NBA_DIRECTORY_URL = "https://www.nigerianbar.org.ng/find-a-lawyer";
  const CURSOR_TOKEN = "\uE000CURSOR\uE000";

  /* ------------------------------------------------------------------ */
  /* DOM refs                                                            */
  /* ------------------------------------------------------------------ */
  const el = {
    sidebar: document.getElementById("sidebar"),
    scrim: document.getElementById("scrim"),
    menuToggle: document.getElementById("menu-toggle"),
    sidebarClose: document.getElementById("sidebar-close"),
    newChatBtn: document.getElementById("new-chat-btn"),
    newChatMobile: document.getElementById("new-chat-mobile"),
    historyList: document.getElementById("history-list"),
    historySearch: document.getElementById("history-search"),
    chat: document.getElementById("chat"),
    chatMessages: document.getElementById("chat-messages"),
    emptyState: document.getElementById("empty-state"),
    conversationTitle: document.getElementById("conversation-title"),
    classificationBadges: document.getElementById("classification-badges"),
    composerForm: document.getElementById("composer-form"),
    composerInput: document.getElementById("composer-input"),
    sendBtn: document.getElementById("send-btn"),
    planValue: document.getElementById("plan-value"),
    upgradeBtn: document.getElementById("upgrade-btn"),
  };

  /* ------------------------------------------------------------------ */
  /* State                                                               */
  /* ------------------------------------------------------------------ */
  let state = {
    conversations: [],
    activeId: null,
    isAgentBusy: false,
    questionsUsedToday: 0,
  };

  // Runtime-only (never persisted): refs + timers for whichever message is
  // currently mid-pipeline, plus a token to invalidate stale async callbacks.
  let live = { msgId: null, refs: null, timerId: null };
  let pipelineToken = 0;

  /* ------------------------------------------------------------------ */
  /* Persistence                                                         */
  /* ------------------------------------------------------------------ */
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.conversations)) {
          state.conversations = parsed.conversations;
          state.activeId = parsed.activeId || null;
          state.questionsUsedToday = parsed.questionsUsedToday || 0;
        }
      }
    } catch (e) { /* corrupt storage — start fresh */ }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      conversations: state.conversations,
      activeId: state.activeId,
      questionsUsedToday: state.questionsUsedToday,
    }));
  }

  /* ------------------------------------------------------------------ */
  /* Helpers                                                             */
  /* ------------------------------------------------------------------ */
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function truncate(str, n) {
    return str.length > n ? str.slice(0, n - 1).trim() + "…" : str;
  }

  function getActiveConversation() {
    return state.conversations.find((c) => c.id === state.activeId) || null;
  }

  function isToday(ts) {
    const d = new Date(ts);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  }

  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  /* ------------------------------------------------------------------ */
  /* Tiny markdown renderer — supports **bold** and "- " bullet lists.
     Paragraphs separated by blank lines. Used for both live streaming
     (called on every partial substring) and static final rendering.     */
  /* ------------------------------------------------------------------ */
  function inlineMd(text) {
    let t = escapeHtml(text);
    t = t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    t = t.split(CURSOR_TOKEN).join('<span class="stream-cursor"></span>');
    return t;
  }

  function renderMarkdown(raw) {
    if (!raw) return "";
    const blocks = raw.split(/\n\n+/);
    return blocks.map((block) => {
      const lines = block.split("\n").filter((l) => l.length);
      const allBullets = lines.length > 0 && lines.every((l) => /^-\s/.test(l.trim()));
      if (allBullets) {
        return `<ul>${lines.map((l) => `<li>${inlineMd(l.trim().replace(/^-\s/, ""))}</li>`).join("")}</ul>`;
      }
      return `<p>${inlineMd(block)}</p>`;
    }).join("");
  }

  function markdownToPlainText(raw) {
    return raw
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .split(/\n\n+/)
      .map((block) => block.split("\n").map((l) => l.trim().replace(/^-\s/, "• ")).join("\n"))
      .join("\n\n");
  }

  /* ------------------------------------------------------------------ */
  /* Streaming engine — reveals markdown text over time, re-parsing the
     accumulated substring each frame so formatting appears live.        */
  /* ------------------------------------------------------------------ */
  function streamText(container, fullText, { cps = 240, token, onDone } = {}) {
    const start = performance.now();
    const total = fullText.length;
    let lastScroll = 0;

    function frame(now) {
      if (token !== pipelineToken) return; // cancelled — a new pipeline started
      const elapsed = (now - start) / 1000;
      const count = Math.min(total, Math.round(elapsed * cps));
      const partial = fullText.slice(0, count) + (count < total ? CURSOR_TOKEN : "");
      container.innerHTML = renderMarkdown(partial);

      // Keep the view tracking the growing text as it streams, not just at
      // the end of each section — throttled so it isn't fighting itself,
      // and only while the user hasn't scrolled away to read something else.
      if (now - lastScroll > 90) {
        lastScroll = now;
        scrollChatToBottom();
      }

      if (count >= total) {
        onDone && onDone();
        return;
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------------ */
  /* Practice-area display labels (server returns snake_case keys)       */
  /* ------------------------------------------------------------------ */
  const PRACTICE_AREA_LABELS = {
    tenancy: "Tenancy Law",
    employment: "Labour & Employment Law",
    criminal_rights: "Constitutional & Criminal Law",
    contract: "Contract Law",
    general: "General Inquiry",
  };

  function normalizeClassification(c) {
    if (!c) return null;
    return {
      practiceArea: PRACTICE_AREA_LABELS[c.practice_area] || c.practice_area || "General Inquiry",
      jurisdictionGuess: c.jurisdiction || "Nigeria (Federal)",
      urgency: c.urgency || "Low",
      summary: c.summary || "",
    };
  }

  async function callChatApi(question) {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* fall through to error below */ }
    if (!res.ok) {
      throw new Error((data && data.message) || `Request failed with status ${res.status}.`);
    }
    if (!data) throw new Error("The server returned an unexpected empty response.");
    return data;
  }

  /* ------------------------------------------------------------------ */
  /* Trace step definitions + icons                                      */
  /* ------------------------------------------------------------------ */
  const ICONS = {
    read: '<i class="fa-solid fa-file-lines"></i>',
    classify: '<i class="fa-solid fa-tag"></i>',
    search: '<i class="fa-solid fa-magnifying-glass"></i>',
    draft: '<i class="fa-solid fa-pen-nib"></i>',
    check: '<i class="fa-solid fa-check"></i>',
    chevron: '<i class="fa-solid fa-chevron-right"></i>',
    bolt: '<i class="fa-solid fa-scale-balanced"></i>',
    list: '<i class="fa-solid fa-list-check"></i>',
    lawyer: '<i class="fa-solid fa-triangle-exclamation"></i>',
    thumbsUp: '<i class="fa-solid fa-thumbs-up"></i>',
    thumbsDown: '<i class="fa-solid fa-thumbs-down"></i>',
    copy: '<i class="fa-regular fa-copy"></i>',
    external: '<i class="fa-solid fa-arrow-up-right-from-square"></i>',
    plus: '<i class="fa-solid fa-plus"></i>',
  };

  const STEP_DEFS = [
    { key: "read", title: "Reading your question", detail: "Parsing the situation and extracting key facts.", icon: "read" },
    { key: "classify", title: "Classifying the issue", detail: "Identifying practice area, jurisdiction, and urgency.", icon: "classify" },
    { key: "search", title: "Searching legal sources", detail: "Checking relevant statutes and case law.", icon: "search" },
    { key: "draft", title: "Drafting the answer", detail: "Structuring the response and the escalation verdict.", icon: "draft" },
  ];
  const STEP_DURATIONS = [480, 620, 780, 420];

  /* ------------------------------------------------------------------ */
  /* Sidebar / history                                                   */
  /* ------------------------------------------------------------------ */
  function renderHistory() {
    const query = (el.historySearch.value || "").trim().toLowerCase();
    const filtered = state.conversations
      .filter((c) => !query || c.title.toLowerCase().includes(query))
      .sort((a, b) => b.createdAt - a.createdAt);

    const today = filtered.filter((c) => isToday(c.createdAt));
    const earlier = filtered.filter((c) => !isToday(c.createdAt));

    el.historyList.innerHTML = "";

    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "history__empty";
      empty.textContent = query ? "No matches." : "No questions yet.";
      el.historyList.appendChild(empty);
      return;
    }

    if (today.length) el.historyList.appendChild(buildHistoryGroup("Today", today));
    if (earlier.length) el.historyList.appendChild(buildHistoryGroup("Earlier", earlier));
  }

  function buildHistoryGroup(label, items) {
    const group = document.createElement("div");
    group.className = "history__group";

    const labelEl = document.createElement("div");
    labelEl.className = "history__label";
    labelEl.textContent = label;
    group.appendChild(labelEl);

    const list = document.createElement("ul");
    items.forEach((c) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.className = "history__item" + (c.id === state.activeId ? " is-active" : "");
      btn.type = "button";
      btn.dataset.id = c.id;
      if (state.isAgentBusy) btn.disabled = true;

      const titleSpan = document.createElement("span");
      titleSpan.className = "history__item-title";
      titleSpan.textContent = c.title;
      btn.appendChild(titleSpan);

      const lastAgentMsg = [...c.messages].reverse().find((m) => m.role === "agent" && m.classification);
      if (lastAgentMsg) {
        const tag = document.createElement("span");
        tag.className = "history__item-tag";
        tag.textContent = lastAgentMsg.classification.practiceArea.split(" ")[0];
        btn.appendChild(tag);
      }

      btn.addEventListener("click", () => selectConversation(c.id));
      li.appendChild(btn);
      list.appendChild(li);
    });
    group.appendChild(list);
    return group;
  }

  /* ------------------------------------------------------------------ */
  /* Topbar                                                               */
  /* ------------------------------------------------------------------ */
  function renderTopbar() {
    const convo = getActiveConversation();
    el.conversationTitle.textContent = convo ? convo.title : "New question";

    el.classificationBadges.innerHTML = "";
    if (!convo) return;

    const lastAgentMsg = [...convo.messages].reverse().find((m) => m.role === "agent" && m.classification);
    if (!lastAgentMsg) return;

    const c = lastAgentMsg.classification;
    el.classificationBadges.appendChild(makeBadge(c.practiceArea, false));
    el.classificationBadges.appendChild(makeBadge(c.jurisdictionGuess, false));
    el.classificationBadges.appendChild(makeBadge(c.urgency + " urgency", c.urgency === "Critical" || c.urgency === "High"));
  }

  function makeBadge(text, urgent) {
    const span = document.createElement("span");
    span.className = "badge" + (urgent ? " badge--urgent" : "");
    const dot = document.createElement("span");
    dot.className = "badge__dot";
    span.appendChild(dot);
    span.appendChild(document.createTextNode(text));
    return span;
  }

  /* ------------------------------------------------------------------ */
  /* Chat — full rebuild (conversation switch / new chat / init)         */
  /* ------------------------------------------------------------------ */
  function renderChat() {
    const convo = getActiveConversation();
    el.chatMessages.innerHTML = "";
    live.refs = null;
    live.msgId = null;

    if (!convo || convo.messages.length === 0) {
      el.emptyState.style.display = "flex";
      renderTopbar();
      return;
    }

    el.emptyState.style.display = "none";

    convo.messages.forEach((msg) => {
      if (msg.role === "user") {
        el.chatMessages.appendChild(renderUserMessage(msg));
      } else {
        el.chatMessages.appendChild(renderAgentMessageStatic(msg));
      }
    });

    renderTopbar();
    scrollChatToBottom(true);
  }

  function renderUserMessage(msg) {
    const wrap = document.createElement("div");
    wrap.className = "msg msg--user";
    wrap.innerHTML = `
      <div class="msg__body">
        <div class="msg__bubble">${escapeHtml(msg.content)}</div>
      </div>
    `;
    return wrap;
  }

  function isNearBottom(threshold = 140) {
    return el.chat.scrollHeight - el.chat.scrollTop - el.chat.clientHeight < threshold;
  }

  function scrollChatToBottom(force) {
    requestAnimationFrame(() => {
      if (force || isNearBottom()) {
        el.chat.scrollTop = el.chat.scrollHeight;
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Agent message — static (already-finished) rendering                 */
  /* ------------------------------------------------------------------ */
  function agentAvatarHtml() {
    return `<div class="msg__avatar"><svg viewBox="0 0 32 32" fill="none"><path d="M16 2L27 6.5V15C27 22.5 22.2 27.8 16 30C9.8 27.8 5 22.5 5 15V6.5L16 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M11 15.5L14.2 18.7L21 11.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`;
  }

  function renderAgentMessageStatic(msg) {
    const wrap = document.createElement("div");
    wrap.className = "msg msg--agent";
    wrap.dataset.msgId = msg.id;
    wrap.innerHTML = agentAvatarHtml();

    const body = document.createElement("div");
    body.className = "msg__body";
    wrap.appendChild(body);

    if (msg.status !== "done" && msg.status !== "corpusEmpty" && msg.status !== "error") {
      // Never reached a terminal state (e.g. page reload mid-request).
      // Resolve it honestly instead of fabricating an answer.
      finalizeStaleMessage(msg);
    }

    body.appendChild(buildTraceElStatic(msg));

    if (msg.status === "done" && msg.result) {
      body.appendChild(buildAnswerBlock(msg, { stream: false }));
    } else if (msg.status === "corpusEmpty") {
      body.appendChild(buildCorpusEmptyEl(msg.corpusEmptyMessage || "No ingested legal sources match this yet.", msg.createdAt));
    } else if (msg.status === "error") {
      body.appendChild(buildErrorEl(msg.errorMessage || "Something went wrong."));
    } else {
      body.appendChild(buildCorpusEmptyEl("This question didn't finish processing (the page may have reloaded mid-request) — try asking it again.", msg.createdAt));
    }

    return wrap;
  }

  function finalizeStaleMessage(msg) {
    // This message never finished (e.g. the page was reloaded mid-request).
    // Don't fabricate an answer — say plainly that it didn't complete.
    msg.result = null;
    msg.steps.forEach((s) => { if (s.state !== "done") s.state = "pending"; });
    msg.thinkingElapsedMs = msg.thinkingElapsedMs || 0;
    msg.status = "incomplete";
  }

  function buildTraceElStatic(msg) {
    const trace = document.createElement("div");
    trace.className = "trace" + (msg.traceOpen ? " is-open" : "");

    const toggle = buildTraceToggle(msg, trace);
    const body = document.createElement("div");
    body.className = "trace__body";
    msg.steps.forEach((step) => body.appendChild(buildStepEl(step)));

    trace.appendChild(toggle);
    trace.appendChild(body);
    return trace;
  }

  function buildTraceToggle(msg, traceEl) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "trace__toggle";
    const isDone = msg.status !== "thinking";
    const seconds = ((msg.thinkingElapsedMs || 0) / 1000).toFixed(1);
    const label = isDone ? `Thought for ${seconds}s` : "Thinking";
    const statusHtml = isDone
      ? `<span class="trace__status" style="color: var(--color-text-faint);">${msg.steps.length} steps</span>`
      : `<span class="trace__status"></span>`;
    toggle.innerHTML = `
      <i class="fa-solid fa-chevron-right trace__toggle-icon"></i>
      <span>${label}</span>
      ${statusHtml}
    `;
    toggle.addEventListener("click", () => {
      msg.traceOpen = !msg.traceOpen;
      traceEl.classList.toggle("is-open", msg.traceOpen);
    });
    return toggle;
  }

  function buildStepEl(step) {
    const item = document.createElement("div");
    item.className = "trace-step is-" + step.state;

    const rail = document.createElement("div");
    rail.className = "trace-step__rail";
    const icon = document.createElement("div");
    icon.className = "trace-step__icon";
    icon.innerHTML = step.state === "done" ? ICONS.check
      : step.state === "active" ? '<span class="spinner" style="width:10px;height:10px;"></span>'
      : (ICONS[step.icon] || "");
    const connector = document.createElement("div");
    connector.className = "trace-step__connector";
    rail.appendChild(icon);
    rail.appendChild(connector);

    const content = document.createElement("div");
    content.className = "trace-step__content";
    const timeTag = step.elapsedMs ? `<span class="trace-step__title-time">${(step.elapsedMs / 1000).toFixed(1)}s</span>` : "";
    content.innerHTML = `<div class="trace-step__title"><span>${escapeHtml(step.title)}</span>${timeTag}</div><div class="trace-step__detail">${escapeHtml(step.detail || "")}</div>`;

    if (step.chips && step.chips.length) {
      const chipsRow = document.createElement("div");
      chipsRow.className = "trace-step__chips";
      step.chips.forEach((chip, i) => {
        const c = document.createElement("span");
        c.className = "trace-chip";
        c.style.animationDelay = (i * 70) + "ms";
        c.innerHTML = `${ICONS.search}<span>${escapeHtml(chip)}</span>`;
        chipsRow.appendChild(c);
      });
      content.appendChild(chipsRow);
    }

    item.appendChild(rail);
    item.appendChild(content);
    return item;
  }

  /* ------------------------------------------------------------------ */
  /* Answer block — shared by static + live rendering                    */
  /* ------------------------------------------------------------------ */
  function buildAnswerBlock(msg, { stream }) {
    const wrap = document.createElement("div");
    wrap.className = "answer";
    const r = msg.result;

    // "What the law says"
    const lawSection = buildSectionShell("What the law says", ICONS.bolt);
    wrap.appendChild(lawSection.el);
    if (stream) {
      lawSection.textEl.innerHTML = "";
    } else {
      lawSection.textEl.innerHTML = renderMarkdown(r.lawMd);
      appendContextCards(lawSection.el, r.sources);
    }

    // "What you can do"
    const actionsSection = buildSectionShell("What you can do", ICONS.list);
    wrap.appendChild(actionsSection.el);
    if (stream) {
      actionsSection.el.style.display = "none";
    } else {
      actionsSection.textEl.innerHTML = renderMarkdown(r.actionsMd);
    }

    // Verdict
    const verdict = buildVerdictEl(r);
    wrap.appendChild(verdict);
    if (stream) verdict.style.display = "none";

    // Follow-ups
    const followUps = buildFollowUpsEl(r.followUps);
    wrap.appendChild(followUps);
    if (stream) followUps.style.display = "none";

    // Meta / actions row
    const meta = buildMetaRow(msg);
    wrap.appendChild(meta);
    if (stream) meta.style.display = "none";

    wrap._refs = { lawSection, actionsSection, verdict, followUps, meta };
    return wrap;
  }

  function buildSectionShell(title, iconSvg) {
    const section = document.createElement("div");
    section.className = "answer-section";
    section.innerHTML = `
      <div class="answer-section__head">
        <div class="answer-section__icon">${iconSvg}</div>
        <span class="answer-section__title">${title}</span>
        <span class="answer-section__live-dot" style="display:none;"></span>
      </div>
      <div class="answer-section__text"></div>
    `;
    return {
      el: section,
      textEl: section.querySelector(".answer-section__text"),
      liveDot: section.querySelector(".answer-section__live-dot"),
    };
  }

  function appendContextCards(sectionEl, sources) {
    if (!sources || !sources.length) return;
    const list = document.createElement("div");
    list.className = "context-list";
    sources.forEach((src, i) => list.appendChild(buildContextCard(src, i)));
    sectionEl.appendChild(list);
  }

  function buildContextCard(src, index) {
    const card = document.createElement("div");
    card.className = "context-card";
    card.style.animationDelay = (index * 80) + "ms";
    card.innerHTML = `
      <button type="button" class="context-card__head">
        <span class="context-card__badge">${escapeHtml(src.type || "SOURCE")}</span>
        <span class="context-card__label">${escapeHtml(src.label)}</span>
        <span class="context-card__meta">${(src.excerpt || "").length} chars</span>
        <i class="fa-solid fa-chevron-right context-card__chevron"></i>
      </button>
      <div class="context-card__body"><p>${escapeHtml(src.excerpt)}</p></div>
    `;
    card.querySelector(".context-card__head").addEventListener("click", () => {
      card.classList.toggle("is-open");
    });
    return card;
  }

  function buildVerdictEl(r) {
    const verdict = document.createElement("div");
    verdict.className = "verdict " + (r.escalate ? "verdict--escalate" : "verdict--self");
    verdict.innerHTML = `
      <div class="verdict__head">
        <div class="verdict__icon">
          ${r.escalate ? ICONS.lawyer : '<i class="fa-solid fa-check"></i>'}
        </div>
        <span class="verdict__title">${r.escalate ? "This likely needs a lawyer" : "You can likely handle this yourself"}</span>
      </div>
      <p class="verdict__text">${escapeHtml(r.escalateReason)}</p>
      ${r.escalate ? `
        <div class="verdict__actions">
          <a class="link-btn" href="${NBA_DIRECTORY_URL}" target="_blank" rel="noopener noreferrer">
            ${ICONS.external}
            Find a verified lawyer — NBA directory
          </a>
        </div>
      ` : ""}
    `;
    return verdict;
  }

  function buildFollowUpsEl(followUps) {
    const wrap = document.createElement("div");
    wrap.className = "followups";
    (followUps || []).forEach((text) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "followup-chip";
      chip.innerHTML = `${ICONS.plus}<span>${escapeHtml(text)}</span>`;
      chip.addEventListener("click", () => {
        if (state.isAgentBusy) return;
        submitQuestion(text);
      });
      wrap.appendChild(chip);
    });
    return wrap;
  }

  function buildMetaRow(msg) {
    const meta = document.createElement("div");
    meta.className = "msg__meta";
    meta.innerHTML = `
      <span class="msg__meta-text">Legal information, not legal advice · ${formatTime(msg.createdAt)}</span>
      <div class="msg-actions">
        <button type="button" class="msg-action-btn" data-action="copy" title="Copy answer">
          ${ICONS.copy}
        </button>
        <button type="button" class="msg-action-btn${msg.feedback === "up" ? " is-active" : ""}" data-action="up" title="Helpful">
          ${msg.feedback === "up" ? ICONS.thumbsUp : '<i class="fa-regular fa-thumbs-up"></i>'}
        </button>
        <button type="button" class="msg-action-btn${msg.feedback === "down" ? " is-active" : ""}" data-action="down" title="Not helpful">
          ${msg.feedback === "down" ? ICONS.thumbsDown : '<i class="fa-regular fa-thumbs-down"></i>'}
        </button>
      </div>
    `;

    meta.querySelector('[data-action="copy"]').addEventListener("click", (e) => {
      copyAnswer(msg, e.currentTarget);
    });
    meta.querySelector('[data-action="up"]').addEventListener("click", (e) => {
      setFeedback(msg, "up", meta);
    });
    meta.querySelector('[data-action="down"]').addEventListener("click", (e) => {
      setFeedback(msg, "down", meta);
    });

    return meta;
  }

  function setFeedback(msg, value, metaEl) {
    msg.feedback = msg.feedback === value ? null : value;
    saveState();
    metaEl.querySelector('[data-action="up"]').classList.toggle("is-active", msg.feedback === "up");
    metaEl.querySelector('[data-action="down"]').classList.toggle("is-active", msg.feedback === "down");
  }

  function copyAnswer(msg, btn) {
    const r = msg.result;
    const text = [
      "What the law says:",
      markdownToPlainText(r.lawMd),
      "",
      "What you can do:",
      markdownToPlainText(r.actionsMd),
      "",
      (r.escalate ? "This likely needs a lawyer: " : "You can likely handle this yourself: ") + r.escalateReason,
    ].join("\n");

    const flashCopied = () => {
      btn.classList.add("is-copied");
      const original = btn.innerHTML;
      btn.innerHTML = ICONS.check;
      setTimeout(() => { btn.classList.remove("is-copied"); btn.innerHTML = original; }, 1400);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(flashCopied).catch(() => fallbackCopy(text, flashCopied));
    } else {
      fallbackCopy(text, flashCopied);
    }
  }

  function fallbackCopy(text, onSuccess) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      onSuccess();
    } catch (e) { /* clipboard unavailable in this environment — no-op */ }
  }

  /* ------------------------------------------------------------------ */
  /* Conversation actions                                                 */
  /* ------------------------------------------------------------------ */
  function createConversation() {
    if (state.isAgentBusy) return;
    const convo = {
      id: uid(),
      title: "New question",
      createdAt: Date.now(),
      messages: [],
    };
    state.conversations.unshift(convo);
    state.activeId = convo.id;
    saveState();
    renderHistory();
    renderChat();
    closeMobileSidebar();
    el.composerInput.focus();
  }

  function selectConversation(id) {
    if (state.isAgentBusy) return;
    state.activeId = id;
    saveState();
    renderHistory();
    renderChat();
    closeMobileSidebar();
  }

  function ensureActiveConversation() {
    if (!getActiveConversation()) createConversation();
  }

  /* ------------------------------------------------------------------ */
  /* Agent pipeline — live, incremental DOM updates via `live.refs`      */
  /* ------------------------------------------------------------------ */
  function submitQuestion(text) {
    if (state.isAgentBusy) return;
    ensureActiveConversation();
    const convo = getActiveConversation();

    const userMsg = { id: uid(), role: "user", content: text, createdAt: Date.now() };
    convo.messages.push(userMsg);

    if (convo.messages.filter((m) => m.role === "user").length === 1) {
      convo.title = truncate(text, 48);
    }

    const agentMsg = {
      id: uid(),
      role: "agent",
      status: "thinking",
      traceOpen: true,
      steps: STEP_DEFS.map((s, i) => ({ ...s, state: i === 0 ? "active" : "pending", elapsedMs: 0 })),
      classification: null,
      result: null,
      feedback: null,
      startedAt: Date.now(),
      thinkingElapsedMs: 0,
      createdAt: Date.now(),
    };
    convo.messages.push(agentMsg);

    saveState();
    renderHistory();

    state.isAgentBusy = true;
    updateComposerState();
    pipelineToken += 1;
    const myToken = pipelineToken;

    mountLivePipeline(convo, agentMsg, myToken);
  }

  function mountLivePipeline(convo, agentMsg, token) {
    el.emptyState.style.display = "none";

    // Append the user message (already rendered by nothing yet — full list is empty on first msg)
    el.chatMessages.innerHTML = "";
    convo.messages.forEach((m) => {
      if (m.id === agentMsg.id) return; // handled below
      el.chatMessages.appendChild(m.role === "user" ? renderUserMessage(m) : renderAgentMessageStatic(m));
    });

    // Build the live agent message shell.
    const wrap = document.createElement("div");
    wrap.className = "msg msg--agent";
    wrap.dataset.msgId = agentMsg.id;
    wrap.innerHTML = agentAvatarHtml();
    const body = document.createElement("div");
    body.className = "msg__body";
    wrap.appendChild(body);

    const traceEl = document.createElement("div");
    traceEl.className = "trace is-open";
    const toggle = buildTraceToggle(agentMsg, traceEl);
    const traceBody = document.createElement("div");
    traceBody.className = "trace__body";
    const stepEls = agentMsg.steps.map((step) => buildStepEl(step));
    stepEls.forEach((se) => traceBody.appendChild(se));
    traceEl.appendChild(toggle);
    traceEl.appendChild(traceBody);
    body.appendChild(traceEl);

    el.chatMessages.appendChild(wrap);
    renderTopbar();
    scrollChatToBottom(true);

    live.msgId = agentMsg.id;
    live.refs = { wrap, body, traceEl, toggle, traceBody, stepEls };

    startTimer(agentMsg, token);
    runPipeline(convo, agentMsg, token);
  }

  function startTimer(agentMsg, token) {
    clearInterval(live.timerId);
    live.timerId = setInterval(() => {
      if (token !== pipelineToken || !live.refs) { clearInterval(live.timerId); return; }
      const elapsed = ((Date.now() - agentMsg.startedAt) / 1000).toFixed(1);
      const statusSpan = live.refs.toggle.querySelector(".trace__status");
      if (statusSpan) {
        const activeStep = agentMsg.steps.find((s) => s.state === "active");
        statusSpan.innerHTML = `<span class="spinner"></span> ${activeStep ? activeStep.title : "Thinking…"} · ${elapsed}s`;
      }
    }, 120);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function setStepActive(agentMsg, index) {
    if (index > 0) {
      const prev = agentMsg.steps[index - 1];
      if (prev.state !== "done") {
        prev.state = "done";
        updateStepEl(index - 1, prev);
      }
    }
    const step = agentMsg.steps[index];
    step.state = "active";
    step._start = Date.now();
    updateStepEl(index, step);
  }

  function setStepDone(agentMsg, index) {
    const step = agentMsg.steps[index];
    step.state = "done";
    step.elapsedMs = Date.now() - (step._start || Date.now());
    updateStepEl(index, step);
  }

  async function runPipeline(convo, agentMsg, token) {
    const question = lastUserText(convo);

    // Step 0: Reading the question — purely cosmetic pacing, no server call yet.
    setStepActive(agentMsg, 0);
    await sleep(380);
    if (token !== pipelineToken) return;

    // Step 1: Classifying — this is where the real network request happens.
    // It stays active (with the live elapsed timer ticking) for however
    // long the server actually takes, since classify+retrieve+draft all
    // happen server-side in one round trip.
    setStepActive(agentMsg, 1);

    let response;
    let requestError = null;
    try {
      response = await callChatApi(question);
    } catch (err) {
      requestError = err;
    }
    if (token !== pipelineToken) return;

    if (requestError) {
      finishWithError(convo, agentMsg, token, requestError.message);
      return;
    }

    agentMsg.classification = normalizeClassification(response.classification);
    agentMsg.steps[1].detail = `${agentMsg.classification.practiceArea} · ${agentMsg.classification.jurisdictionGuess} · ${agentMsg.classification.urgency} urgency`;
    setStepDone(agentMsg, 1);

    // Step 2: Searching legal sources — the server already did this; show
    // what it found (or admit nothing's ingested yet) with brief pacing.
    setStepActive(agentMsg, 2);
    const hasResult = !response.corpusEmpty && response.result;
    if (hasResult && response.result.sources && response.result.sources.length) {
      agentMsg.steps[2].detail = `Cross-checking ${response.result.sources.length} source${response.result.sources.length === 1 ? "" : "s"} for relevance.`;
      agentMsg.steps[2].chips = response.result.sources.map((s) => s.label);
    } else {
      agentMsg.steps[2].detail = "No ingested sources for this practice area yet.";
    }
    updateStepEl(2, agentMsg.steps[2]);
    await sleep(350);
    if (token !== pipelineToken) return;
    setStepDone(agentMsg, 2);

    // Step 3: Drafting — also already done server-side; brief pacing only.
    setStepActive(agentMsg, 3);
    await sleep(300);
    if (token !== pipelineToken) return;
    setStepDone(agentMsg, 3);

    collapseTrace(agentMsg, token);

    saveState();
    renderHistory();
    renderTopbar();

    if (!hasResult) {
      agentMsg.status = "corpusEmpty";
      agentMsg.corpusEmptyMessage = response.message || "No ingested legal sources match this yet.";
      renderCorpusEmptyMessage(agentMsg, agentMsg.corpusEmptyMessage);
      finalizeAnswer(agentMsg, token);
      return;
    }

    agentMsg.result = response.result;
    const answerBlock = buildAnswerBlock(agentMsg, { stream: true });
    live.refs.body.appendChild(answerBlock);
    scrollChatToBottom();
    streamAnswerSequence(agentMsg, answerBlock, token);
  }

  function lastUserText(convo) {
    const msgs = convo.messages.filter((m) => m.role === "user");
    return msgs.length ? msgs[msgs.length - 1].content : "";
  }

  function updateStepEl(index, step) {
    if (!live.refs) return;
    const fresh = buildStepEl(step);
    const old = live.refs.stepEls[index];
    if (old && old.parentNode) old.parentNode.replaceChild(fresh, old);
    live.refs.stepEls[index] = fresh;
  }

  function collapseTrace(agentMsg, token) {
    if (token !== pipelineToken || !live.refs) return;
    clearInterval(live.timerId);

    agentMsg.thinkingElapsedMs = Date.now() - agentMsg.startedAt;
    agentMsg.traceOpen = false;
    agentMsg.status = "streaming";

    const traceEl = live.refs.traceEl;
    const toggleEl = live.refs.toggle;

    traceEl.classList.remove("is-open");
    toggleEl.innerHTML = `
      <i class="fa-solid fa-chevron-right trace__toggle-icon"></i>
      <span>Thought for ${(agentMsg.thinkingElapsedMs / 1000).toFixed(1)}s</span>
      <span class="trace__status" style="color: var(--color-text-faint);">${agentMsg.steps.length} steps</span>
    `;
  }

  function buildCorpusEmptyEl(message, createdAt) {
    const wrap = document.createElement("div");
    wrap.className = "answer";
    wrap.innerHTML = `
      <div class="answer-section">
        <div class="answer-section__head">
          <div class="answer-section__icon"><i class="fa-solid fa-circle-info"></i></div>
          <span class="answer-section__title">Not sourced yet</span>
        </div>
        <div class="answer-section__text"><p>${escapeHtml(message)}</p></div>
      </div>
      <div class="msg__meta"><span class="msg__meta-text">Legal information, not legal advice · ${formatTime(createdAt)}</span></div>
    `;
    return wrap;
  }

  function renderCorpusEmptyMessage(agentMsg, message) {
    if (!live.refs) return;
    live.refs.body.appendChild(buildCorpusEmptyEl(message, agentMsg.createdAt));
    scrollChatToBottom();
  }

  function buildErrorEl(message) {
    const wrap = document.createElement("div");
    wrap.className = "verdict verdict--error";
    wrap.innerHTML = `
      <div class="verdict__head">
        <div class="verdict__icon"><i class="fa-solid fa-triangle-exclamation"></i></div>
        <span class="verdict__title">Something went wrong</span>
      </div>
      <p class="verdict__text">${escapeHtml(message)}</p>
    `;
    return wrap;
  }

  function finishWithError(convo, agentMsg, token, message) {
    if (token !== pipelineToken || !live.refs) return;
    clearInterval(live.timerId);

    agentMsg.steps.forEach((s) => { if (s.state === "active") s.state = "pending"; });
    agentMsg.thinkingElapsedMs = Date.now() - agentMsg.startedAt;
    agentMsg.traceOpen = false;
    agentMsg.status = "error";
    agentMsg.errorMessage = message;

    const traceEl = live.refs.traceEl;
    traceEl.classList.remove("is-open");
    live.refs.toggle.innerHTML = `
      <i class="fa-solid fa-chevron-right trace__toggle-icon"></i>
      <span>Stopped after ${(agentMsg.thinkingElapsedMs / 1000).toFixed(1)}s</span>
    `;

    live.refs.body.appendChild(buildErrorEl(message));
    scrollChatToBottom();

    agentMsg.result = null;
    finalizeAnswer(agentMsg, token);
  }

  function streamAnswerSequence(agentMsg, answerBlock, token) {
    const r = agentMsg.result;
    const refs = answerBlock._refs;

    refs.lawSection.el.classList.add("is-live");
    refs.lawSection.liveDot.style.display = "inline-block";

    streamText(refs.lawSection.textEl, r.lawMd, {
      token,
      onDone: () => {
        if (token !== pipelineToken) return;
        const stickAfterLaw = isNearBottom();
        refs.lawSection.el.classList.remove("is-live");
        refs.lawSection.liveDot.style.display = "none";
        appendContextCards(refs.lawSection.el, r.sources);
        scrollChatToBottom(stickAfterLaw);

        // Small deliberate pause before the next section starts, rather
        // than every reveal landing in the same animation frame — that's
        // what made the container feel like it was "dumping" all at once.
        setTimeout(() => {
          if (token !== pipelineToken) return;
          const stickBeforeActions = isNearBottom();
          refs.actionsSection.el.style.display = "";
          refs.actionsSection.el.classList.add("is-live");
          refs.actionsSection.liveDot.style.display = "inline-block";
          scrollChatToBottom(stickBeforeActions);

          streamText(refs.actionsSection.textEl, r.actionsMd, {
            token,
            onDone: () => {
              if (token !== pipelineToken) return;
              const stickAfterActions = isNearBottom();
              refs.actionsSection.el.classList.remove("is-live");
              refs.actionsSection.liveDot.style.display = "none";
              scrollChatToBottom(stickAfterActions);

              setTimeout(() => {
                if (token !== pipelineToken) return;
                const stickBeforeVerdict = isNearBottom();
                refs.verdict.style.display = "";
                scrollChatToBottom(stickBeforeVerdict);

                setTimeout(() => {
                  if (token !== pipelineToken) return;
                  const stickBeforeFollowUps = isNearBottom();
                  refs.followUps.style.display = "";
                  scrollChatToBottom(stickBeforeFollowUps);

                  setTimeout(() => {
                    if (token !== pipelineToken) return;
                    const stickBeforeMeta = isNearBottom();
                    refs.meta.style.display = "";
                    scrollChatToBottom(stickBeforeMeta);
                    finalizeAnswer(agentMsg, token);
                  }, 200);
                }, 200);
              }, 250);
            },
          });
        }, 300);
      },
    });
  }

  function finalizeAnswer(agentMsg, token) {
    if (token !== pipelineToken) return;
    const wasStreaming = agentMsg.status === "streaming";
    if (wasStreaming) agentMsg.status = "done";
    state.isAgentBusy = false;
    // Only a real, fully-answered question counts against the daily quota —
    // a failed request or an honest "not sourced yet" shouldn't cost the user.
    if (wasStreaming) state.questionsUsedToday += 1;

    saveState();
    renderHistory();
    updateComposerState();
    updatePlanLabel();

    live.refs = null;
    live.msgId = null;
  }

  /* ------------------------------------------------------------------ */
  /* Composer                                                             */
  /* ------------------------------------------------------------------ */
  function updateComposerState() {
    const hasText = el.composerInput.value.trim().length > 0;
    el.sendBtn.disabled = !hasText || state.isAgentBusy;
    el.composerInput.disabled = state.isAgentBusy;
    el.newChatBtn.disabled = state.isAgentBusy;
    el.newChatMobile.disabled = state.isAgentBusy;
  }

  function autoGrowTextarea() {
    el.composerInput.style.height = "auto";
    el.composerInput.style.height = Math.min(el.composerInput.scrollHeight, 160) + "px";
  }

  function updatePlanLabel() {
    const used = state.questionsUsedToday;
    const remaining = Math.max(0, 2 - used);
    el.planValue.textContent = remaining > 0
      ? `Free · ${remaining} question${remaining === 1 ? "" : "s"} left today`
      : "Free · daily limit reached";
  }

  /* ------------------------------------------------------------------ */
  /* Mobile sidebar                                                       */
  /* ------------------------------------------------------------------ */
  function openMobileSidebar() {
    el.sidebar.classList.add("is-open");
    el.scrim.classList.add("is-visible");
  }
  function closeMobileSidebar() {
    el.sidebar.classList.remove("is-open");
    el.scrim.classList.remove("is-visible");
  }

  /* ------------------------------------------------------------------ */
  /* Event bindings                                                       */
  /* ------------------------------------------------------------------ */
  el.newChatBtn.addEventListener("click", createConversation);
  el.newChatMobile.addEventListener("click", createConversation);
  el.menuToggle.addEventListener("click", openMobileSidebar);
  el.sidebarClose.addEventListener("click", closeMobileSidebar);
  el.scrim.addEventListener("click", closeMobileSidebar);
  el.historySearch.addEventListener("input", renderHistory);
  el.upgradeBtn.addEventListener("click", () => {
    alert("Upgrade flow: ₦1,999/year subscription — hook up Paystack checkout here.");
  });

  el.composerInput.addEventListener("input", () => {
    autoGrowTextarea();
    updateComposerState();
  });

  el.composerInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      el.composerForm.requestSubmit();
    }
  });

  el.composerForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = el.composerInput.value.trim();
    if (!text || state.isAgentBusy) return;
    el.composerInput.value = "";
    autoGrowTextarea();
    updateComposerState();
    submitQuestion(text);
  });

  document.querySelectorAll(".prompt-card").forEach((card) => {
    card.addEventListener("click", () => {
      const prompt = card.dataset.prompt;
      el.composerInput.value = prompt;
      autoGrowTextarea();
      updateComposerState();
      submitQuestion(prompt);
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMobileSidebar();
  });

  /* ------------------------------------------------------------------ */
  /* Init                                                                 */
  /* ------------------------------------------------------------------ */
  function init() {
    loadState();
    if (!state.activeId && state.conversations.length) {
      state.activeId = state.conversations[0].id;
    }
    renderHistory();
    renderChat();
    updateComposerState();
    updatePlanLabel();
  }

  init();
})();
