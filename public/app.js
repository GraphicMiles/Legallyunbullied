/* ==========================================================================
   Legally Unbullied — Phase 1 AI Agent Answer UI
   Conversation store (localStorage) + a simulated agent pipeline with a
   real timeline trace, markdown streaming, expandable source cards, and
   follow-up suggestions.
   ========================================================================== */

(function () {
  "use strict";

  const STORAGE_KEY = "lu.conversations.v2";
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
  function streamText(container, fullText, { cps = 950, token, onDone } = {}) {
    const start = performance.now();
    const total = fullText.length;

    function frame(now) {
      if (token !== pipelineToken) return; // cancelled — a new pipeline started
      const elapsed = (now - start) / 1000;
      const count = Math.min(total, Math.round(elapsed * cps));
      const partial = fullText.slice(0, count) + (count < total ? CURSOR_TOKEN : "");
      container.innerHTML = renderMarkdown(partial);
      if (count >= total) {
        onDone && onDone();
        return;
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------------ */
  /* Legal classification + answer content (mock, deterministic)         */
  /* ------------------------------------------------------------------ */
  const TOPICS = [
    {
      key: "tenancy",
      practiceArea: "Tenancy Law",
      match: /\b(landlord|tenant|rent|eviction|evict|lease|apartment|flat|quit notice)\b/i,
      jurisdictionGuess: "Lagos State",
      urgency: "High",
      sources: [
        { id: "s1", label: "Lagos Tenancy Law 2011, s.13", type: "SUMMARY", excerpt: "In short: s.13 sets the minimum notice a landlord must give before a monthly tenancy can be ended — generally one month — before any recovery-of-possession step can begin." },
        { id: "s2", label: "Lagos Tenancy Law 2011, s.25", type: "SUMMARY", excerpt: "In short: s.25 makes self-help eviction (locking a tenant out, seizing belongings, or removing them by force without a court order) an offence, regardless of arrears owed." },
      ],
      lawMd: "In Lagos State, a landlord cannot eject a tenant without following due process under the **Lagos Tenancy Law 2011**. For a monthly tenant, the landlord must serve a valid **quit notice** — typically one month's notice — followed by a separate **7-day notice of owner's intention to recover possession** if the tenant doesn't leave.\n\nSelf-help eviction — changing locks, removing property, or forcibly ejecting a tenant without a court order — is illegal, regardless of rent arrears.",
      actionsMd: "- Ask the landlord (in writing) for the specific notice they claim to have served, and its date.\n- Keep proof of rent payments and any communication about the tenancy.\n- If your property is interfered with or you're locked out without a court order, this becomes a police + court matter immediately — it's a criminal act, not just a civil dispute.\n- If a valid notice was served and it has expired, the landlord still needs a court order (from a Magistrate or the Landlord/Tenant division) before physically recovering the property.",
      escalate: true,
      escalateReason: "Evictions involve statutory notice periods and court procedure. If the notice was invalid or force was used, a lawyer can get you an urgent injunction — this isn't something to resolve by yourself once it's contested.",
      followUps: ["What counts as a valid quit notice in Lagos?", "Can my landlord increase my rent mid-tenancy?"],
    },
    {
      key: "employment",
      practiceArea: "Labour & Employment Law",
      match: /\b(employer|fired|dismissed|salary|wages|termination|job|resign|severance|unpaid)\b/i,
      jurisdictionGuess: "Federal (Labour Act)",
      urgency: "Medium",
      sources: [
        { id: "s1", label: "Labour Act, Cap. L1 LFN 2004, s.11", type: "SUMMARY", excerpt: "In short: s.11 ties notice periods to length of service and allows payment in lieu of notice, but doesn't excuse an employer from paying wages already earned." },
        { id: "s2", label: "National Industrial Court Act 2006", type: "SUMMARY", excerpt: "In short: this Act gives the National Industrial Court exclusive jurisdiction over employment and labour disputes, including unpaid-wage claims." },
      ],
      lawMd: "Under the **Labour Act**, termination of employment (for workers it covers) generally requires notice proportional to length of service, or payment in lieu of notice. Termination itself doesn't have to be justified for most private contracts unless your contract or a collective agreement says otherwise — but **unpaid earned salary must still be paid** regardless of how the termination happened.\n\nFiring by text message isn't automatically illegal, but withholding wages already earned is a separate, actionable wrong.",
      actionsMd: "- Request a written termination letter and a final pay statement — you're entitled to both.\n- Calculate exactly what's owed: unpaid salary, unused leave, and any notice-in-lieu your contract specifies.\n- Send a formal written demand for the outstanding salary with a short deadline before escalating.\n- If unresolved, claims for unpaid wages go to the **National Industrial Court**, which handles employment disputes exclusively.",
      escalate: true,
      escalateReason: "Recovering unpaid wages through the National Industrial Court involves procedure a lawyer handles far faster than a self-filed claim — especially if your employer stalls after the written demand.",
      followUps: ["How much notice pay am I actually owed?", "Can I claim unpaid wages without a lawyer?"],
    },
    {
      key: "policing",
      practiceArea: "Constitutional & Criminal Law",
      match: /\b(police|arrest|detain|detained|custody|bail|charge|station)\b/i,
      jurisdictionGuess: "Federal (Constitution + ACJA)",
      urgency: "Critical",
      sources: [
        { id: "s1", label: "1999 Constitution (as amended), s.35", type: "SUMMARY", excerpt: "In short: s.35 protects personal liberty and requires anyone arrested to be brought before a court within a reasonable time, or released." },
        { id: "s2", label: "Administration of Criminal Justice Act 2015, s.6", type: "SUMMARY", excerpt: "In short: s.6 of the ACJA sets out the reasonable-time thresholds (roughly 24–48 hours depending on court proximity) for producing a detained suspect in court." },
      ],
      lawMd: "Section 35 of the **1999 Constitution** and the **Administration of Criminal Justice Act (ACJA) 2015** require that a person arrested and detained be brought before a court within a **reasonable time** — interpreted as 24–48 hours depending on court proximity. Detention beyond that without charge or a court appearance is unlawful, and bail for most offences is a right, not a favour, before conviction.",
      actionsMd: "- Go to the station in person and formally request the case file number, the exact offence alleged, and the officer in charge's name.\n- Ask in writing for bail — the police are required to consider it for most offences.\n- If 48 hours pass with no charge or court appearance, this is a constitutional violation you can act on immediately — including via a fundamental rights enforcement application.\n- Document everything: dates, times, names, station location.",
      escalate: true,
      escalateReason: "This is time-critical and involves personal liberty. A lawyer can file a fundamental rights enforcement application today — every hour of unlawful detention matters here.",
      followUps: ["How do I file a fundamental rights enforcement application?", "What happens if the police refuse to grant bail?"],
    },
    {
      key: "contract",
      practiceArea: "Contract Law",
      match: /\b(contractor|contract|refund|deposit|breach|agreement|scam|paid him|paid her)\b/i,
      jurisdictionGuess: "State (Civil/Small Claims)",
      urgency: "Medium",
      sources: [
        { id: "s1", label: "Contract Act (general principles)", type: "SUMMARY", excerpt: "In short: Nigerian contract law recognises oral and written agreements alike, as long as offer, acceptance, and consideration (e.g. payment) can be shown." },
        { id: "s2", label: "Small Claims Court Practice Direction 2018", type: "SUMMARY", excerpt: "In short: this Practice Direction created a fast-track court process for modest-value disputes, designed to be filed without a lawyer and resolved in weeks." },
      ],
      lawMd: "Taking payment for work and not completing it is a **breach of contract**, whether the agreement was written or verbal — Nigerian contract law recognises oral agreements as long as you can show offer, acceptance, and payment (receipts, transfer alerts, chats).\n\nYou're entitled to either completion of the work, a refund, or damages for the loss caused by the breach.",
      actionsMd: "- Gather every piece of evidence: chats, receipts, transfer alerts, photos of unfinished work.\n- Send a written demand letter giving a clear deadline (e.g. 7 days) to complete the work or refund you.\n- If the amount is modest, Nigeria's **Small Claims Courts** are built exactly for this — no lawyer required to file, and cases move in weeks, not years.\n- If ignored, that's your trigger to escalate formally.",
      escalate: false,
      escalateReason: "This is the kind of dispute the Small Claims Court process was designed for — you can likely resolve it yourself without hiring a lawyer, unless the amount is large or the other side pushes back hard.",
      followUps: ["How do I file at the Small Claims Court?", "What evidence actually holds up for a verbal agreement?"],
    },
  ];

  const DEFAULT_TOPIC = {
    key: "general",
    practiceArea: "General Inquiry",
    jurisdictionGuess: "Nigeria (Federal)",
    urgency: "Low",
    sources: [
      { id: "s1", label: "1999 Constitution (as amended)", type: "SUMMARY", excerpt: "In short: the Constitution sets the baseline rights and federal/state divide that most everyday legal questions ultimately sit on top of." },
    ],
    lawMd: "This doesn't map cleanly to one of the common issue types yet, so treat this as a general read: most everyday disputes in Nigeria are governed by a mix of federal statutes (like the Constitution and the Labour Act) and state-specific laws (like tenancy or traffic laws), so the exact answer depends on where you are and the specifics of what happened.",
    actionsMd: "- Add specifics: what state you're in, who the other party is, and what's happened so far.\n- Keep a written record of dates, names, and any money or documents involved — this matters no matter what the issue turns out to be.",
    escalate: false,
    escalateReason: "There isn't enough here yet to tell if this needs a lawyer — add more detail and the agent will re-classify.",
    followUps: ["What state-specific laws should I mention?", "Can you give me an example of a well-described legal question?"],
  };

  function classify(text) {
    return TOPICS.find((t) => t.match.test(text)) || DEFAULT_TOPIC;
  }

  /* ------------------------------------------------------------------ */
  /* Trace step definitions + icons                                      */
  /* ------------------------------------------------------------------ */
  const ICONS = {
    read: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 5h11l5 5v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 12h8M8 16h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    classify: '<svg viewBox="0 0 24 24" fill="none"><path d="M20.5 12.5 12 21l-9-9V4h8l9.5 8.5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.8"/><path d="M20 20 15.8 15.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    draft: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 20h4L19.5 8.5a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16v4Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 12L10 17L19 8" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none"><path d="M9 6L15 12L9 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    bolt: '<svg viewBox="0 0 24 24" fill="none"><path d="M13 3 5 13h5l-1 8 8-10h-5l1-8Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
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
    scrollChatToBottom();
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

  function scrollChatToBottom() {
    requestAnimationFrame(() => {
      el.chat.scrollTop = el.chat.scrollHeight;
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

    if (!msg.result) {
      // Defensive fallback: a message that never finished (e.g. page reload
      // mid-pipeline). Resolve it immediately and instantly, no animation.
      finalizeStaleMessage(msg);
    }

    body.appendChild(buildTraceElStatic(msg));
    body.appendChild(buildAnswerBlock(msg, { stream: false }));

    return wrap;
  }

  function finalizeStaleMessage(msg) {
    const topic = msg.classification || DEFAULT_TOPIC;
    msg.result = {
      lawMd: topic.lawMd,
      actionsMd: topic.actionsMd,
      sources: topic.sources,
      escalate: topic.escalate,
      escalateReason: topic.escalateReason,
      followUps: topic.followUps,
    };
    msg.steps.forEach((s) => { s.state = "done"; });
    msg.thinkingElapsedMs = msg.thinkingElapsedMs || 0;
    msg.status = "done";
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
    const isDone = msg.status === "done" || msg.status === "streaming";
    const seconds = ((msg.thinkingElapsedMs || 0) / 1000).toFixed(1);
    const label = isDone ? `Thought for ${seconds}s` : "Thinking";
    const statusHtml = isDone
      ? `<span class="trace__status" style="color: var(--color-text-faint);">${msg.steps.length} steps</span>`
      : `<span class="trace__status"></span>`;
    toggle.innerHTML = `
      <svg class="trace__toggle-icon" viewBox="0 0 24 24" fill="none"><path d="M9 6L15 12L9 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
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
    const actionsSection = buildSectionShell("What you can do", ICONS.chevron);
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
        <span class="context-card__badge">${escapeHtml(src.type)}</span>
        <span class="context-card__label">${escapeHtml(src.label)}</span>
        <span class="context-card__meta">${src.excerpt.length} chars</span>
        <svg class="context-card__chevron" viewBox="0 0 24 24" fill="none"><path d="M9 6L15 12L9 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
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
          ${r.escalate
            ? '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M12 8V13" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="16.2" r="1.1" fill="currentColor"/></svg>'
            : '<svg viewBox="0 0 24 24" fill="none"><path d="M5 12L10 17L19 8" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
          }
        </div>
        <span class="verdict__title">${r.escalate ? "This likely needs a lawyer" : "You can likely handle this yourself"}</span>
      </div>
      <p class="verdict__text">${escapeHtml(r.escalateReason)}</p>
      ${r.escalate ? `
        <div class="verdict__actions">
          <a class="link-btn" href="${NBA_DIRECTORY_URL}" target="_blank" rel="noopener noreferrer">
            <svg viewBox="0 0 24 24" fill="none"><path d="M14 5H19V10M19 5L11 13M12 5H7C5.9 5 5 5.9 5 7V17C5 18.1 5.9 19 7 19H17C18.1 19 19 18.1 19 17V12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
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
      chip.innerHTML = `<svg viewBox="0 0 24 24" fill="none"><path d="M12 5V19M5 12H19" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>${escapeHtml(text)}`;
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
          <svg viewBox="0 0 24 24" fill="none"><rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" stroke="currentColor" stroke-width="1.8"/></svg>
        </button>
        <button type="button" class="msg-action-btn${msg.feedback === "up" ? " is-active" : ""}" data-action="up" title="Helpful">
          <svg viewBox="0 0 24 24" fill="none"><path d="M7 11v9H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3Zm0 0 4.5-7.5a1.5 1.5 0 0 1 2.7.4L15 8h4a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.8 19H10a3 3 0 0 1-3-3v-5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
        </button>
        <button type="button" class="msg-action-btn${msg.feedback === "down" ? " is-active" : ""}" data-action="down" title="Not helpful">
          <svg viewBox="0 0 24 24" fill="none"><path d="M17 13V4h3a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-3Zm0 0-4.5 7.5a1.5 1.5 0 0 1-2.7-.4L9 16H5a2 2 0 0 1-2-2.3l1.2-7A2 2 0 0 1 6.2 5H14a3 3 0 0 1 3 3v5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
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
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none"><path d="M5 12L10 17L19 8" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
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
    scrollChatToBottom();

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

  function runPipeline(convo, agentMsg, token) {
    let stepIndex = 0;
    let stepStart = Date.now();

    function advance() {
      if (token !== pipelineToken) return;
      if (stepIndex > 0) {
        const prev = agentMsg.steps[stepIndex - 1];
        prev.state = "done";
        prev.elapsedMs = Date.now() - stepStart;
        updateStepEl(stepIndex - 1, prev);
      }

      if (stepIndex < agentMsg.steps.length) {
        const step = agentMsg.steps[stepIndex];
        step.state = "active";
        stepStart = Date.now();

        if (stepIndex === 1) {
          const topic = classify(lastUserText(convo));
          agentMsg.classification = topic;
          step.detail = `${topic.practiceArea} · ${topic.jurisdictionGuess} · ${topic.urgency} urgency`;
        }
        if (stepIndex === 2 && agentMsg.classification) {
          step.detail = `Cross-checking ${agentMsg.classification.sources.length} sources for relevance.`;
          step.chips = agentMsg.classification.sources.map((s) => s.label);
        }

        updateStepEl(stepIndex, step);
        stepIndex++;
        setTimeout(advance, STEP_DURATIONS[stepIndex - 1] || 600);
      } else {
        finishThinking(convo, agentMsg, token);
      }
    }
    advance();
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

  function finishThinking(convo, agentMsg, token) {
    if (token !== pipelineToken || !live.refs) return;
    clearInterval(live.timerId);

    agentMsg.thinkingElapsedMs = Date.now() - agentMsg.startedAt;
    agentMsg.traceOpen = false;
    agentMsg.status = "streaming";

    const traceEl = live.refs.traceEl;
    const toggleEl = live.refs.toggle;

    traceEl.classList.remove("is-open");
    toggleEl.innerHTML = `
      <svg class="trace__toggle-icon" viewBox="0 0 24 24" fill="none"><path d="M9 6L15 12L9 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span>Thought for ${(agentMsg.thinkingElapsedMs / 1000).toFixed(1)}s</span>
      <span class="trace__status" style="color: var(--color-text-faint);">${agentMsg.steps.length} steps</span>
    `;

    const topic = agentMsg.classification || classify(lastUserText(convo));
    agentMsg.classification = topic;
    agentMsg.result = {
      lawMd: topic.lawMd,
      actionsMd: topic.actionsMd,
      sources: topic.sources,
      escalate: topic.escalate,
      escalateReason: topic.escalateReason,
      followUps: topic.followUps,
    };

    saveState();
    renderHistory();
    renderTopbar();

    const answerBlock = buildAnswerBlock(agentMsg, { stream: true });
    live.refs.body.appendChild(answerBlock);
    scrollChatToBottom();

    streamAnswerSequence(agentMsg, answerBlock, token);
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
        refs.lawSection.el.classList.remove("is-live");
        refs.lawSection.liveDot.style.display = "none";
        appendContextCards(refs.lawSection.el, r.sources);
        scrollChatToBottom();

        refs.actionsSection.el.style.display = "";
        refs.actionsSection.el.classList.add("is-live");
        refs.actionsSection.liveDot.style.display = "inline-block";

        streamText(refs.actionsSection.textEl, r.actionsMd, {
          token,
          onDone: () => {
            if (token !== pipelineToken) return;
            refs.actionsSection.el.classList.remove("is-live");
            refs.actionsSection.liveDot.style.display = "none";
            scrollChatToBottom();

            refs.verdict.style.display = "";
            refs.followUps.style.display = "";
            refs.meta.style.display = "";
            scrollChatToBottom();

            finalizeAnswer(agentMsg, token);
          },
        });
      },
    });
  }

  function finalizeAnswer(agentMsg, token) {
    if (token !== pipelineToken) return;
    agentMsg.status = "done";
    state.isAgentBusy = false;
    state.questionsUsedToday += 1;

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
