/* ==========================================================================
   Legally Unbullied — Phase 1 AI Agent Answer UI
   Self-contained front-end logic: conversation store (localStorage),
   a simulated agent pipeline (classify -> retrieve -> draft), and
   structured answer rendering per the PRD's 3-part answer format.
   ========================================================================== */

(function () {
  "use strict";

  const STORAGE_KEY = "lu.conversations.v1";
  const NBA_DIRECTORY_URL = "https://www.nigerianbar.org.ng/find-a-lawyer";

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
    conversations: [],   // { id, title, createdAt, messages: [...] }
    activeId: null,
    isAgentBusy: false,
    questionsUsedToday: 0,
  };

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

  /* ------------------------------------------------------------------ */
  /* Legal classification + answer engine (mock, deterministic)          */
  /* ------------------------------------------------------------------ */
  const TOPICS = [
    {
      key: "tenancy",
      practiceArea: "Tenancy Law",
      match: /\b(landlord|tenant|rent|eviction|evict|lease|apartment|flat|quit notice)\b/i,
      jurisdictionGuess: "Lagos State",
      urgency: "High",
      sources: ["Lagos Tenancy Law 2011, s.13", "Lagos Tenancy Law 2011, s.25"],
      law: `<p>In Lagos State, a landlord cannot eject a tenant without following due process under the <strong>Lagos Tenancy Law 2011</strong>. For a monthly tenant, the landlord must serve a valid <strong>quit notice</strong> — typically one month's notice — followed by a separate <strong>7-day notice of owner's intention to recover possession</strong> if the tenant doesn't leave.</p><p>Self-help eviction — changing locks, removing property, or forcibly ejecting a tenant without a court order — is illegal, regardless of rent arrears.</p>`,
      actions: `<ul><li>Ask the landlord (in writing) for the specific notice they claim to have served, and its date.</li><li>Keep proof of rent payments and any communication about the tenancy.</li><li>If your property is interfered with or you're locked out without a court order, this becomes a police + court matter immediately — it's a criminal act, not just a civil dispute.</li><li>If a valid notice was served and it has expired, the landlord still needs a court order (from a Magistrate or the Landlord/Tenant division) before physically recovering the property.</li></ul>`,
      escalate: true,
      escalateReason: "Evictions involve statutory notice periods and court procedure. If the notice was invalid or force was used, a lawyer can get you an urgent injunction — this isn't something to resolve by yourself once it's contested.",
    },
    {
      key: "employment",
      practiceArea: "Labour & Employment Law",
      match: /\b(employer|fired|dismissed|salary|wages|termination|job|resign|severance|unpaid)\b/i,
      jurisdictionGuess: "Federal (Labour Act)",
      urgency: "Medium",
      sources: ["Labour Act, Cap. L1 LFN 2004, s.11", "National Industrial Court Act 2006"],
      law: `<p>Under the <strong>Labour Act</strong>, termination of employment (for workers it covers) generally requires notice proportional to length of service, or payment in lieu of notice. Termination itself doesn't have to be justified for most private contracts unless your contract or a collective agreement says otherwise — but <strong>unpaid earned salary must still be paid</strong> regardless of how the termination happened.</p><p>Firing by text message isn't automatically illegal, but withholding wages already earned is a separate, actionable wrong.</p>`,
      actions: `<ul><li>Request a written termination letter and a final pay statement — you're entitled to both.</li><li>Calculate exactly what's owed: unpaid salary, unused leave, and any notice-in-lieu your contract specifies.</li><li>Send a formal written demand for the outstanding salary with a short deadline before escalating.</li><li>If unresolved, claims for unpaid wages go to the <strong>National Industrial Court</strong>, which handles employment disputes exclusively.</li></ul>`,
      escalate: true,
      escalateReason: "Recovering unpaid wages through the National Industrial Court involves procedure a lawyer handles far faster than a self-filed claim — especially if your employer stalls after the written demand.",
    },
    {
      key: "policing",
      practiceArea: "Constitutional & Criminal Law",
      match: /\b(police|arrest|detain|detained|custody|bail|charge|station)\b/i,
      jurisdictionGuess: "Federal (Constitution + ACJA)",
      urgency: "Critical",
      sources: ["1999 Constitution (as amended), s.35", "Administration of Criminal Justice Act 2015, s.6"],
      law: `<p>Section 35 of the <strong>1999 Constitution</strong> and the <strong>Administration of Criminal Justice Act (ACJA) 2015</strong> require that a person arrested and detained be brought before a court within a <strong>reasonable time</strong> — interpreted as 24–48 hours depending on court proximity. Detention beyond that without charge or a court appearance is unlawful, and bail for most offences is a right, not a favour, before conviction.</p>`,
      actions: `<ul><li>Go to the station in person and formally request the case file number, the exact offence alleged, and the officer in charge's name.</li><li>Ask in writing for bail — the police are required to consider it for most offences.</li><li>If 48 hours pass with no charge or court appearance, this is a constitutional violation you can act on immediately — including via a fundamental rights enforcement application.</li><li>Document everything: dates, times, names, station location.</li></ul>`,
      escalate: true,
      escalateReason: "This is time-critical and involves personal liberty. A lawyer can file a fundamental rights enforcement application today — every hour of unlawful detention matters here.",
    },
    {
      key: "contract",
      practiceArea: "Contract Law",
      match: /\b(contractor|contract|refund|deposit|breach|agreement|scam|paid him|paid her)\b/i,
      jurisdictionGuess: "State (Civil/Small Claims)",
      urgency: "Medium",
      sources: ["Contract Act (general principles)", "Small Claims Court Practice Direction 2018"],
      law: `<p>Taking payment for work and not completing it is a <strong>breach of contract</strong>, whether the agreement was written or verbal — Nigerian contract law recognises oral agreements as long as you can show offer, acceptance, and payment (receipts, transfer alerts, chats).</p><p>You're entitled to either completion of the work, a refund, or damages for the loss caused by the breach.</p>`,
      actions: `<ul><li>Gather every piece of evidence: chats, receipts, transfer alerts, photos of unfinished work.</li><li>Send a written demand letter giving a clear deadline (e.g. 7 days) to complete the work or refund you.</li><li>If the amount is modest, Nigeria's <strong>Small Claims Courts</strong> are built exactly for this — no lawyer required to file, and cases move in weeks, not years.</li><li>If ignored, that's your trigger to escalate formally.</li></ul>`,
      escalate: false,
      escalateReason: "This is the kind of dispute the Small Claims Court process was designed for — you can likely resolve it yourself without hiring a lawyer, unless the amount is large or the other side pushes back hard.",
    },
  ];

  const DEFAULT_TOPIC = {
    key: "general",
    practiceArea: "General Inquiry",
    jurisdictionGuess: "Nigeria (Federal)",
    urgency: "Low",
    sources: ["1999 Constitution (as amended)"],
    law: `<p>This doesn't map cleanly to one of the common issue types yet, so treat this as a general read: most everyday disputes in Nigeria are governed by a mix of federal statutes (like the Constitution and the Labour Act) and state-specific laws (like tenancy or traffic laws), so the exact answer depends on where you are and the specifics of what happened.</p>`,
    actions: `<ul><li>Add specifics: what state you're in, who the other party is, and what's happened so far.</li><li>Keep a written record of dates, names, and any money or documents involved — this matters no matter what the issue turns out to be.</li></ul>`,
    escalate: false,
    escalateReason: "There isn't enough here yet to tell if this needs a lawyer — add more detail and the agent will re-classify.",
  };

  function classify(text) {
    const topic = TOPICS.find((t) => t.match.test(text)) || DEFAULT_TOPIC;
    return topic;
  }

  /* ------------------------------------------------------------------ */
  /* Rendering: sidebar / history                                        */
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

      const titleSpan = document.createElement("span");
      titleSpan.className = "history__item-title";
      titleSpan.textContent = c.title;
      btn.appendChild(titleSpan);

      const lastMsg = c.messages[c.messages.length - 1];
      if (lastMsg && lastMsg.classification) {
        const tag = document.createElement("span");
        tag.className = "history__item-tag";
        tag.textContent = lastMsg.classification.practiceArea.split(" ")[0];
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
  /* Rendering: topbar                                                    */
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
  /* Rendering: chat messages                                             */
  /* ------------------------------------------------------------------ */
  function renderChat() {
    const convo = getActiveConversation();
    el.chatMessages.innerHTML = "";

    if (!convo || convo.messages.length === 0) {
      el.emptyState.style.display = "flex";
      renderTopbar();
      return;
    }

    el.emptyState.style.display = "none";

    convo.messages.forEach((msg) => {
      el.chatMessages.appendChild(renderMessage(msg));
    });

    renderTopbar();
    scrollChatToBottom();
  }

  function renderMessage(msg) {
    if (msg.role === "user") return renderUserMessage(msg);
    return renderAgentMessage(msg);
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

  function renderAgentMessage(msg) {
    const wrap = document.createElement("div");
    wrap.className = "msg msg--agent";
    wrap.dataset.msgId = msg.id;

    const avatar = document.createElement("div");
    avatar.className = "msg__avatar";
    avatar.innerHTML = `<svg viewBox="0 0 32 32" fill="none"><path d="M16 2L27 6.5V15C27 22.5 22.2 27.8 16 30C9.8 27.8 5 22.5 5 15V6.5L16 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M11 15.5L14.2 18.7L21 11.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

    const body = document.createElement("div");
    body.className = "msg__body";

    body.appendChild(buildTraceEl(msg));

    if (msg.status === "done" && msg.answer) {
      body.appendChild(buildAnswerEl(msg));
      const meta = document.createElement("div");
      meta.className = "msg__meta";
      meta.textContent = "Legal information, not legal advice · " + formatTime(msg.createdAt);
      body.appendChild(meta);
    }

    wrap.appendChild(avatar);
    wrap.appendChild(body);
    return wrap;
  }

  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function buildTraceEl(msg) {
    const trace = document.createElement("div");
    trace.className = "trace" + (msg.traceOpen ? " is-open" : "");

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "trace__toggle";
    toggle.innerHTML = `
      <svg class="trace__toggle-icon" viewBox="0 0 24 24" fill="none"><path d="M9 6L15 12L9 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span>${msg.status === "done" ? "Reasoning" : "Working"}</span>
      <span class="trace__status">${
        msg.status === "done"
          ? `${msg.steps.length} steps · done`
          : `<span class="spinner"></span> ${currentStepLabel(msg)}`
      }</span>
    `;
    toggle.addEventListener("click", () => {
      msg.traceOpen = !msg.traceOpen;
      trace.classList.toggle("is-open", msg.traceOpen);
    });

    const body = document.createElement("div");
    body.className = "trace__body";
    msg.steps.forEach((step) => {
      body.appendChild(buildStepEl(step));
    });

    trace.appendChild(toggle);
    trace.appendChild(body);
    return trace;
  }

  function currentStepLabel(msg) {
    const active = msg.steps.find((s) => s.state === "active");
    return active ? active.title : "Thinking…";
  }

  function buildStepEl(step) {
    const item = document.createElement("div");
    item.className = "trace-step is-" + step.state;

    const icon = document.createElement("div");
    icon.className = "trace-step__icon";
    if (step.state === "done") {
      icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none"><path d="M5 12L10 17L19 8" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    } else if (step.state === "active") {
      icon.innerHTML = `<span class="spinner" style="width:10px;height:10px;"></span>`;
    } else {
      icon.innerHTML = "";
    }

    const content = document.createElement("div");
    content.className = "trace-step__content";
    content.innerHTML = `<div class="trace-step__title">${escapeHtml(step.title)}</div>${
      step.detail ? `<div class="trace-step__detail">${escapeHtml(step.detail)}</div>` : ""
    }`;

    item.appendChild(icon);
    item.appendChild(content);
    return item;
  }

  function buildAnswerEl(msg) {
    const a = msg.answer;
    const wrap = document.createElement("div");
    wrap.className = "answer";

    wrap.innerHTML = `
      <div class="answer-section">
        <div class="answer-section__head">
          <div class="answer-section__icon">
            <svg viewBox="0 0 24 24" fill="none"><path d="M12 3L4 7V11C4 16 7.5 20.5 12 21.5C16.5 20.5 20 16 20 11V7L12 3Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
          </div>
          <span class="answer-section__title">What the law says</span>
        </div>
        <div class="answer-section__text">${a.law}</div>
        <div class="source-list">${a.sources.map((s) => `<span class="source-chip">${escapeHtml(s)}</span>`).join("")}</div>
      </div>

      <div class="answer-section">
        <div class="answer-section__head">
          <div class="answer-section__icon">
            <svg viewBox="0 0 24 24" fill="none"><path d="M9 18L15 12L9 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <span class="answer-section__title">What you can do</span>
        </div>
        <div class="answer-section__text">${a.actions}</div>
      </div>

      <div class="verdict ${a.escalate ? "verdict--escalate" : "verdict--self"}">
        <div class="verdict__head">
          <div class="verdict__icon">
            ${a.escalate
              ? `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M12 8V13" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="16.2" r="1.1" fill="currentColor"/></svg>`
              : `<svg viewBox="0 0 24 24" fill="none"><path d="M5 12L10 17L19 8" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`
            }
          </div>
          <span class="verdict__title">${a.escalate ? "This likely needs a lawyer" : "You can likely handle this yourself"}</span>
        </div>
        <p class="verdict__text">${escapeHtml(a.escalateReason)}</p>
        ${a.escalate ? `
          <div class="verdict__actions">
            <a class="link-btn" href="${NBA_DIRECTORY_URL}" target="_blank" rel="noopener noreferrer">
              <svg viewBox="0 0 24 24" fill="none"><path d="M14 5H19V10M19 5L11 13M12 5H7C5.9 5 5 5.9 5 7V17C5 18.1 5.9 19 7 19H17C18.1 19 19 18.1 19 17V12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              Find a verified lawyer — NBA directory
            </a>
          </div>
        ` : ""}
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
  /* Conversation actions                                                 */
  /* ------------------------------------------------------------------ */
  function createConversation() {
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
  /* Agent pipeline (simulated, deterministic timings)                    */
  /* ------------------------------------------------------------------ */
  const PIPELINE_STEPS = [
    { title: "Reading your question", detail: "Parsing the situation and extracting key facts." },
    { title: "Classifying the issue", detail: "Identifying practice area, jurisdiction, and urgency." },
    { title: "Searching legal sources", detail: "Checking relevant statutes and case law." },
    { title: "Drafting the answer", detail: "Structuring the response and the escalation verdict." },
  ];

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
      steps: PIPELINE_STEPS.map((s, i) => ({ ...s, state: i === 0 ? "active" : "pending" })),
      classification: null,
      answer: null,
      createdAt: Date.now(),
    };
    convo.messages.push(agentMsg);

    saveState();
    renderHistory();
    renderChat();

    state.isAgentBusy = true;
    updateComposerState();
    runPipeline(convo, agentMsg, text);
  }

  function runPipeline(convo, agentMsg, questionText) {
    let stepIndex = 0;
    const stepDurations = [550, 700, 850, 650];

    function advance() {
      if (stepIndex > 0) {
        agentMsg.steps[stepIndex - 1].state = "done";
      }
      if (stepIndex < agentMsg.steps.length) {
        agentMsg.steps[stepIndex].state = "active";

        // attach classification detail once classification step is reached
        if (stepIndex === 1) {
          const topic = classify(questionText);
          agentMsg.classification = topic;
          agentMsg.steps[1].detail = `${topic.practiceArea} · ${topic.jurisdictionGuess} · ${topic.urgency} urgency`;
        }
        if (stepIndex === 2 && agentMsg.classification) {
          agentMsg.steps[2].detail = agentMsg.classification.sources.join(" · ");
        }

        rerenderSingleMessage(convo, agentMsg);
        stepIndex++;
        setTimeout(advance, stepDurations[stepIndex - 1] || 600);
      } else {
        finalizeAnswer(convo, agentMsg, questionText);
      }
    }
    advance();
  }

  function finalizeAnswer(convo, agentMsg, questionText) {
    agentMsg.steps.forEach((s) => (s.state = "done"));
    const topic = agentMsg.classification || classify(questionText);
    agentMsg.answer = {
      law: topic.law,
      actions: topic.actions,
      sources: topic.sources,
      escalate: topic.escalate,
      escalateReason: topic.escalateReason,
    };
    agentMsg.status = "done";
    agentMsg.traceOpen = false;

    state.isAgentBusy = false;
    state.questionsUsedToday += 1;
    saveState();
    renderHistory();
    renderChat();
    updateComposerState();
    updatePlanLabel();
  }

  function rerenderSingleMessage(convo, agentMsg) {
    // Full re-render keeps things simple and correct given the small DOM size.
    renderChat();
  }

  /* ------------------------------------------------------------------ */
  /* Composer                                                             */
  /* ------------------------------------------------------------------ */
  function updateComposerState() {
    const hasText = el.composerInput.value.trim().length > 0;
    el.sendBtn.disabled = !hasText || state.isAgentBusy;
    el.composerInput.disabled = state.isAgentBusy;
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
