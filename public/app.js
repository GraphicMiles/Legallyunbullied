/* ==========================================================================
   Legally Unbullied — Phase 1 AI Agent Answer UI
   Conversation store (localStorage) + a simulated agent pipeline with a
   real timeline trace, markdown streaming, expandable source cards, and
   follow-up suggestions.

   Loaded as an ES module (see index.html) specifically so this file's
   auth imports and firebase-init.js's own module both execute in
   document order, guaranteeing window.firebaseAuth already exists (or
   is definitively absent, if config was incomplete) by the time the code
   below runs — no event-listener race to coordinate.
   ========================================================================== */

import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

(function () {
  "use strict";

  const STORAGE_KEY_PREFIX = "lu.conversations.v3";
  const NBA_DIRECTORY_URL = "https://www.nigerianbar.org.ng/find-a-lawyer";
  const CURSOR_TOKEN = "\uE000CURSOR\uE000";

  // Get storage key scoped to current user
  function getStorageKey() {
    const userId = state.user?.uid || "anonymous";
    return `${STORAGE_KEY_PREFIX}.${userId}`;
  }

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
    composerForm: document.getElementById("composer-form") || document.getElementById("prompt-bar-container"),
    composerInput: document.getElementById("composer-input"),
    sendBtn: document.getElementById("send-btn"),
    planValue: document.getElementById("plan-value"),
    upgradeBtn: document.getElementById("upgrade-btn"),
    clearChatBtn: document.getElementById("clear-chat-btn"),
    copyChatBtn: document.getElementById("copy-chat-btn"),
    topbarAvatar: document.getElementById("topbar-avatar"),
    authSection: document.getElementById("auth-section"),
    authModalOverlay: document.getElementById("auth-modal-overlay"),
    authModalClose: document.getElementById("auth-modal-close"),
    authModalTitle: document.getElementById("auth-modal-title"),
    authTabSignin: document.getElementById("auth-tab-signin"),
    authTabSignup: document.getElementById("auth-tab-signup"),
    authForm: document.getElementById("auth-form"),
    authEmail: document.getElementById("auth-email"),
    authPassword: document.getElementById("auth-password"),
    authError: document.getElementById("auth-error"),
    authSubmit: document.getElementById("auth-submit"),
    authGoogleBtn: document.getElementById("auth-google-btn"),
    confirmModalOverlay: document.getElementById("confirm-modal-overlay"),
    confirmModalTitle: document.getElementById("confirm-modal-title"),
    confirmModalText: document.getElementById("confirm-modal-text"),
    confirmModalCancel: document.getElementById("confirm-modal-cancel"),
    confirmModalConfirm: document.getElementById("confirm-modal-confirm"),
  };

  /* ------------------------------------------------------------------ */
  /* State                                                               */
  /* ------------------------------------------------------------------ */
  let state = {
    conversations: [],
    activeId: null,
    isAgentBusy: false,
    questionsUsedToday: 0,
    user: null, // set by the Firebase auth listener, never persisted to localStorage
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
      const storageKey = getStorageKey();
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.conversations)) {
          state.conversations = parsed.conversations;
          state.activeId = parsed.activeId || null;
          state.questionsUsedToday = parsed.questionsUsedToday || 0;

          // Migrate: repair any agent messages missing the `steps` field
          // (from sessions saved before the steps/tracing feature was added).
          for (const convo of state.conversations) {
            if (convo && Array.isArray(convo.messages)) {
              for (const msg of convo.messages) {
                if (msg && msg.role === "agent" && !msg.steps) {
                  msg.steps = STEP_DEFS.map((s, i) => ({
                    ...s,
                    state: msg.status === "done" ? "done" : "pending",
                    elapsedMs: msg.thinkingElapsedMs || 0,
                  }));
                }
              }
            }
          }
        }
      }
    } catch (e) { /* corrupt storage — start fresh */ }
  }

  function saveState() {
    const storageKey = getStorageKey();
    localStorage.setItem(storageKey, JSON.stringify({
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
    criminal_offences: "Criminal Offences",
    family_law: "Family Law",
    land_property: "Land & Property Law",
    contract: "Contract Law",
    company_business: "Company & Business Law",
    consumer_rights: "Consumer Rights",
    constitutional_rights: "Constitutional Rights",
    immigration_citizenship: "Immigration & Citizenship",
    tax_finance: "Tax & Finance",
    intellectual_property: "Intellectual Property",
    transport_traffic: "Transport & Traffic",
    education: "Education",
    health: "Health",
    employment_labour_safety: "Labour & Workplace Safety",
    environment: "Environment",
    government_administration: "Government & Administration",
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
    console.log('[callChatApi] Starting API call to /api/chat');
    
    // Add timeout to fetch call
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180000); // 3 minute timeout — full pipeline (classify + search + plan + draft + critique) can take 60-120s on free-tier LLMs
    
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      console.log('[callChatApi] Response received, status:', res.status);
      
      let data = null;
      try { 
        data = await res.json(); 
        console.log('[callChatApi] Response parsed successfully');
      } catch (e) { 
        console.error('[callChatApi] Failed to parse response:', e);
        /* fall through to error below */ 
      }
      
      if (!res.ok) {
        console.error('[callChatApi] Request failed:', res.status, data);
        throw new Error((data && data.message) || `Request failed with status ${res.status}.`);
      }
      if (!data) {
        console.error('[callChatApi] Empty response');
        throw new Error("The server returned an unexpected empty response.");
      }
      
      console.log('[callChatApi] Returning data:', { isCasual: data.isCasual, hasResult: !!data.result });
      return data;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        console.error('[callChatApi] Request timed out after 60 seconds');
        throw new Error('Request timed out after 60 seconds. Please try again.');
      }
      console.error('[callChatApi] Error:', err);
      throw err;
    }
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
    { key: "plan", title: "Planning the response", detail: "Analyzing provisions and structuring the answer.", icon: "bolt" },
    { key: "draft", title: "Drafting the answer", detail: "Structuring the response and the escalation verdict.", icon: "draft" },
  ];
  const STEP_DURATIONS = [480, 620, 780, 550, 420];

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
      li.className = "history__row";

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

      const kebab = document.createElement("button");
      kebab.type = "button";
      kebab.className = "history__kebab";
      kebab.setAttribute("aria-label", "Chat options");
      kebab.innerHTML = '<i class="fa-solid fa-ellipsis-vertical"></i>';
      if (state.isAgentBusy) kebab.disabled = true;
      kebab.addEventListener("click", (e) => {
        e.stopPropagation();
        kebab.classList.add("is-open");
        showPopover(
          kebab,
          [
            { label: "Clear chat", icon: "fa-broom", onClick: () => confirmClearConversation(c.id) },
            { label: "Delete chat", icon: "fa-trash", danger: true, onClick: () => confirmDeleteConversation(c.id) },
          ],
          { onClose: () => kebab.classList.remove("is-open") }
        );
      });
      li.appendChild(kebab);

      list.appendChild(li);
    });
    group.appendChild(list);
    return group;
  }

  /* ------------------------------------------------------------------ */
  /* Generic small popover menu (history kebab, topbar avatar menu)      */
  /* ------------------------------------------------------------------ */
  let activePopover = null;

  function closePopover() {
    if (!activePopover) return;
    activePopover.el.remove();
    document.removeEventListener("click", activePopover.outsideHandler, true);
    document.removeEventListener("keydown", activePopover.escHandler, true);
    activePopover.onClose && activePopover.onClose();
    activePopover = null;
  }

  function showPopover(anchorEl, items, { onClose, align = "end" } = {}) {
    closePopover();

    const menu = document.createElement("div");
    menu.className = "menu-popover";
    items.forEach((item) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "menu-popover__item" + (item.danger ? " menu-popover__item--danger" : "");
      btn.innerHTML = `<span class="menu-popover__item-icon"><i class="fa-solid ${item.icon}"></i></span><span>${escapeHtml(item.label)}</span>`;
      btn.addEventListener("click", () => {
        closePopover();
        item.onClick();
      });
      menu.appendChild(btn);
    });

    document.body.appendChild(menu);

    const rect = anchorEl.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    let top = rect.bottom + 6;
    let left = align === "start" ? rect.left : rect.right - menuRect.width;
    left = Math.max(8, Math.min(left, window.innerWidth - menuRect.width - 8));
    if (top + menuRect.height > window.innerHeight - 8) {
      top = rect.top - menuRect.height - 6;
    }
    menu.style.top = top + "px";
    menu.style.left = left + "px";

    const outsideHandler = (e) => {
      if (!menu.contains(e.target) && e.target !== anchorEl && !anchorEl.contains(e.target)) {
        closePopover();
      }
    };
    const escHandler = (e) => { if (e.key === "Escape") closePopover(); };

    // Defer attaching so the same click that opened the menu doesn't
    // immediately register as an "outside" click and close it again.
    setTimeout(() => {
      document.addEventListener("click", outsideHandler, true);
      document.addEventListener("keydown", escHandler, true);
    }, 0);

    activePopover = { el: menu, outsideHandler, escHandler, onClose };
  }

  /* ------------------------------------------------------------------ */
  /* Confirm dialog (Clear / Delete chat)                                 */
  /* ------------------------------------------------------------------ */
  function showConfirm({ text, confirmLabel = "Confirm", onConfirm }) {
    el.confirmModalText.textContent = text;
    el.confirmModalConfirm.textContent = confirmLabel;
    el.confirmModalOverlay.classList.add("is-visible");

    el.confirmModalConfirm.onclick = () => {
      hideConfirm();
      onConfirm();
    };
    el.confirmModalCancel.onclick = hideConfirm;
  }

  function hideConfirm() {
    el.confirmModalOverlay.classList.remove("is-visible");
  }

  el.confirmModalOverlay.addEventListener("click", (e) => {
    if (e.target === el.confirmModalOverlay) hideConfirm();
  });

  /* ------------------------------------------------------------------ */
  /* Clear / delete conversations                                        */
  /* ------------------------------------------------------------------ */
  function confirmClearConversation(id) {
    const convo = state.conversations.find((c) => c.id === id);
    if (!convo) return;
    showConfirm({
      text: `Clear all messages in "${truncate(convo.title, 44)}"? This can't be undone.`,
      confirmLabel: "Clear chat",
      onConfirm: () => clearConversationMessages(id),
    });
  }

  function clearConversationMessages(id) {
    const convo = state.conversations.find((c) => c.id === id);
    if (!convo) return;
    convo.messages = [];
    convo.title = "New question";
    saveState();
    renderHistory();
    if (state.activeId === id) renderChat();
    updateClearChatButtonState();
    // Clear the prompt bar when clearing a chat
    if (window.promptBar) {
      window.promptBar.clear();
    } else if (el.composerInput) {
      el.composerInput.value = "";
    }
  }

  function copyConversationToClipboard(id) {
    const convo = state.conversations.find((c) => c.id === id);
    if (!convo || !convo.messages.length) return;

    const lines = convo.messages.map((msg) => {
      const timestamp = new Date(msg.createdAt).toLocaleTimeString();
      if (msg.role === "user") {
        return `[${timestamp}] You: ${msg.content}`;
      } else if (msg.role === "agent") {
        if (msg.status === "casual" && msg.casualReply) {
          return `[${timestamp}] Agent: ${msg.casualReply}`;
        } else if (msg.status === "done" && msg.result) {
          const law = msg.result.lawMd || "";
          const actions = msg.result.actionsMd || "";
          const verdict = msg.result.escalate ? "Lawyer recommended" : "Can handle yourself";
          return `[${timestamp}] Agent:\n\nWhat the law says:\n${law}\n\nWhat you can do:\n${actions}\n\nVerdict: ${verdict}`;
        } else if (msg.status === "stopped") {
          return `[${timestamp}] Agent: [Response stopped]`;
        } else if (msg.status === "error") {
          return `[${timestamp}] Agent: [Error: ${msg.errorMessage || "Something went wrong"}]`;
        } else if (msg.status === "corpusEmpty") {
          return `[${timestamp}] Agent: [No legal sources available]`;
        }
        return `[${timestamp}] Agent: [No response]`;
      }
      return "";
    });

    const text = `Conversation: ${convo.title}\nDate: ${new Date(convo.messages[0].createdAt).toLocaleDateString()}\n\n${lines.join("\n\n---\n\n")}`;

    const flashCopied = () => {
      const btn = el.copyChatBtn;
      btn.innerHTML = '<i class="fa-solid fa-check"></i>';
      setTimeout(() => {
        btn.innerHTML = '<i class="fa-solid fa-copy"></i>';
      }, 1400);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(flashCopied).catch(() => {
        console.warn("[copy] Clipboard write failed, trying fallback");
        fallbackCopy(text, flashCopied);
      });
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
    } catch (e) {
      console.error("[copy] Fallback copy failed:", e);
    }
  }

  function confirmDeleteConversation(id) {
    const convo = state.conversations.find((c) => c.id === id);
    if (!convo) return;
    showConfirm({
      text: `Delete "${truncate(convo.title, 44)}"? This can't be undone.`,
      confirmLabel: "Delete chat",
      onConfirm: () => deleteConversationById(id),
    });
  }

  function deleteConversationById(id) {
    const idx = state.conversations.findIndex((c) => c.id === id);
    if (idx === -1) return;
    state.conversations.splice(idx, 1);
    if (state.activeId === id) {
      state.activeId = state.conversations.length ? state.conversations[0].id : null;
    }
    saveState();
    renderHistory();
    renderChat();
    updateClearChatButtonState();
    // Clear the prompt bar when deleting a chat
    if (window.promptBar) {
      window.promptBar.clear();
    } else if (el.composerInput) {
      el.composerInput.value = "";
    }
  }

  function updateClearChatButtonState() {
    const convo = getActiveConversation();
    const hasMessages = !!(convo && convo.messages.length);
    el.clearChatBtn.disabled = !hasMessages || state.isAgentBusy;
    el.copyChatBtn.disabled = !hasMessages || state.isAgentBusy;
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
    updateClearChatButtonState();

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

    if (msg.status !== "done" && msg.status !== "corpusEmpty" && msg.status !== "error" && msg.status !== "casual" && msg.status !== "stopped") {
      // Never reached a terminal state (e.g. page reload mid-request).
      // Resolve it honestly instead of fabricating an answer.
      finalizeStaleMessage(msg);
    }

    body.appendChild(buildTraceElStatic(msg));

    if (msg.status === "done" && msg.result) {
      body.appendChild(buildAnswerBlock(msg, { stream: false }));
    } else if (msg.status === "casual") {
      body.appendChild(buildCasualReplyEl(msg.casualReply || "Hello!"));
    } else if (msg.status === "stopped") {
      body.appendChild(buildStoppedEl());
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
    if (msg.steps) {
      msg.steps.forEach((s) => { if (s.state !== "done") s.state = "pending"; });
    }
    msg.thinkingElapsedMs = msg.thinkingElapsedMs || 0;
    msg.status = "incomplete";
  }

  function buildTraceElStatic(msg) {
    const trace = document.createElement("div");
    trace.className = "trace" + (msg.traceOpen ? " is-open" : "");

    const toggle = buildTraceToggle(msg, trace);
    const body = document.createElement("div");
    body.className = "trace__body";
    if (msg.steps) {
      msg.steps.forEach((step) => body.appendChild(buildStepEl(step)));
    }

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

    // "What the law says" section
    const lawSection = document.createElement("div");
    lawSection.className = "answer-section";
    lawSection.innerHTML = `
      <div class="answer-section__head">
        <div class="answer-section__icon">${ICONS.bolt}</div>
        <span class="answer-section__title">What the law says</span>
        <span class="answer-section__live-dot" style="display:none;"></span>
      </div>
      <div class="answer-section__text"></div>
    `;
    wrap.appendChild(lawSection);
    const lawTextEl = lawSection.querySelector(".answer-section__text");
    const lawLiveDot = lawSection.querySelector(".answer-section__live-dot");
    
    if (stream) {
      lawTextEl.innerHTML = "";
    } else {
      lawTextEl.innerHTML = renderMarkdown(r.lawMd);
      appendContextCards(lawSection, r.sources);
    }

    // "What you can do" section
    const actionsSection = document.createElement("div");
    actionsSection.className = "answer-section";
    actionsSection.innerHTML = `
      <div class="answer-section__head">
        <div class="answer-section__icon">${ICONS.list}</div>
        <span class="answer-section__title">What you can do</span>
        <span class="answer-section__live-dot" style="display:none;"></span>
      </div>
      <div class="answer-section__text"></div>
    `;
    wrap.appendChild(actionsSection);
    const actionsTextEl = actionsSection.querySelector(".answer-section__text");
    const actionsLiveDot = actionsSection.querySelector(".answer-section__live-dot");
    
    if (stream) {
      actionsSection.style.display = "none";
    } else {
      actionsTextEl.innerHTML = renderMarkdown(r.actionsMd);
    }

    // Verdict (uses BeUIRecommendationCard)
    const verdict = buildVerdictEl(r);
    wrap.appendChild(verdict);
    if (stream) verdict.style.display = "none";

    // Approval Card (if agent needs user input)
    let approvalCard = null;
    if (r.approvalQuestions && r.approvalQuestions.length > 0 && window.BeUIApprovalCard) {
      approvalCard = buildApprovalCard(r);
      wrap.appendChild(approvalCard);
      if (stream) approvalCard.style.display = "none";
    }

    wrap._refs = { 
      lawSection: { el: lawSection, textEl: lawTextEl, liveDot: lawLiveDot },
      actionsSection: { el: actionsSection, textEl: actionsTextEl, liveDot: actionsLiveDot },
      verdict,
      approvalCard
    };
    return wrap;
  }

  function appendContextCards(sectionEl, sources) {
    if (!sources || !sources.length) return;
    
    // Use BeUIContextCards if available
    if (window.BeUIContextCards) {
      const container = document.createElement("div");
      sectionEl.appendChild(container);
      
      const contextCards = new window.BeUIContextCards(container, {
        maxVisible: 3
      });
      
      sources.forEach((src) => {
        contextCards.addCard({
          type: src.type || "SOURCE",
          title: src.label,
          excerpt: src.excerpt
        });
      });
    } else {
      // Fallback to old context cards
      const list = document.createElement("div");
      list.className = "context-list";
      sources.forEach((src, i) => list.appendChild(buildContextCard(src, i)));
      sectionEl.appendChild(list);
    }
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
    // Use BeUIRecommendationCard
    if (window.BeUIRecommendationCard) {
      const container = document.createElement("div");
      
      const recommendation = new window.BeUIRecommendationCard(container, {
        options: [
          {
            body: r.escalate 
              ? "This situation likely requires professional legal assistance. A lawyer can help you navigate the legal process and protect your rights."
              : "You can likely handle this yourself by following the steps outlined above. No lawyer needed for this situation.",
            short: r.escalate ? "Consult a lawyer" : "Handle yourself",
            signal: r.escalate ? 3 : 2,
            tone: r.escalate ? "var(--color-accent)" : "var(--color-success)",
            label: r.escalate ? "High confidence" : "Good option",
            cta: r.escalate ? "Find lawyer" : "Got it",
            ctaStyle: r.escalate ? "var(--color-accent)" : "var(--color-success)"
          }
        ]
      });
      
      return container;
    }
    
    // Fallback to old verdict UI
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

  function buildApprovalCard(r) {
    const container = document.createElement("div");
    container.className = "approval-card-wrapper";
    
    if (window.BeUIApprovalCard) {
      new window.BeUIApprovalCard(container, {
        question: r.approvalQuestion || "The agent needs your input:",
        options: r.approvalQuestions.map(q => ({
          label: q.label || q,
          value: q.value || q
        })),
        onSelect: (value) => {
          console.log("[approval] Selected:", value);
        },
        onApprove: (value) => {
          console.log("[approval] Approved:", value);
          // Submit the selected option as a follow-up question
          if (value && !state.isAgentBusy) {
            submitQuestion(value);
          }
        },
        onReject: () => {
          console.log("[approval] Rejected");
        }
      });
    }
    
    return container;
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
    // Clear the prompt bar when creating a new chat
    if (window.promptBar) {
      window.promptBar.clear();
      window.promptBar.inputElement.focus();
    } else if (el.composerInput) {
      el.composerInput.value = "";
      el.composerInput.focus();
    }
  }

  function selectConversation(id) {
    if (state.isAgentBusy) return;
    state.activeId = id;
    saveState();
    renderHistory();
    renderChat();
    closeMobileSidebar();
    // Clear the prompt bar when switching to a different chat
    if (window.promptBar) {
      window.promptBar.clear();
    } else if (el.composerInput) {
      el.composerInput.value = "";
    }
  }

  function ensureActiveConversation() {
    if (!getActiveConversation()) createConversation();
  }

  /* ------------------------------------------------------------------ */
  /* Contextual title generation                                         */
  /* ------------------------------------------------------------------ */
  function deriveTopicFromText(text) {
    // Simple fallback: extract key legal terms from the message
    const lower = text.toLowerCase();
    const topics = {
      "tenancy": ["landlord", "tenant", "rent", "eviction", "lease"],
      "employment": ["employer", "employee", "fired", "salary", "work"],
      "criminal": ["police", "arrest", "detained", "crime", "charged"],
      "contract": ["contract", "agreement", "breach", "payment"],
      "family": ["divorce", "marriage", "custody", "child"],
      "property": ["property", "land", "ownership", "dispute"]
    };
    
    for (const [topic, keywords] of Object.entries(topics)) {
      if (keywords.some(k => lower.includes(k))) {
        return topic.charAt(0).toUpperCase() + topic.slice(1) + " question";
      }
    }
    
    return "Legal question";
  }

  async function generateContextualTitle(convo, userText) {
    try {
      const response = await fetch("/api/generate-title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: userText })
      });
      
      if (!response.ok) {
        console.warn("[title] API call failed, keeping derived title");
        return;
      }
      
      const data = await response.json();
      if (data.title && data.title.length > 0 && data.title.length <= 50) {
        convo.title = data.title;
        saveState();
        renderHistory();
        renderTopbar();
      }
    } catch (err) {
      console.warn("[title] Failed to generate contextual title:", err);
      // Keep the derived title as fallback
    }
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
      // Set an initial title from context, then try to generate a smarter one
      convo.title = deriveTopicFromText(text);
      generateContextualTitle(convo, text);
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

    // Only append the NEW user message (don't re-render everything)
    const lastUserMsg = convo.messages[convo.messages.length - 2]; // second to last is the user message
    if (lastUserMsg && lastUserMsg.role === "user") {
      // Check if this message is already rendered
      const existingMsg = el.chatMessages.querySelector(`[data-msg-id="${lastUserMsg.id}"]`);
      if (!existingMsg) {
        el.chatMessages.appendChild(renderUserMessage(lastUserMsg));
      }
    }

    // Build the live agent message shell.
    const wrap = document.createElement("div");
    wrap.className = "msg msg--agent";
    wrap.dataset.msgId = agentMsg.id;
    wrap.innerHTML = agentAvatarHtml();
    const body = document.createElement("div");
    body.className = "msg__body";
    wrap.appendChild(body);

    // Add BeUI Loading State (initial "agent is working" indicator)
    const loadingContainer = document.createElement("div");
    body.appendChild(loadingContainer);
    
    if (window.BeUILoadingState) {
      live.loadingState = new window.BeUILoadingState(loadingContainer, {
        label: "Analyzing",
        variant: "drive"
      });
    }

    el.chatMessages.appendChild(wrap);
    renderTopbar();
    scrollChatToBottom(true);

    live.msgId = agentMsg.id;
    live.refs = { wrap, body, traceEl: null, toggle: null, traceBody: null, stepEls: null };

    runPipeline(convo, agentMsg, token);
  }

  function startTimer(agentMsg, token) {
    clearInterval(live.timerId);
    
    // Create BeUI components for reasoning text and progress
    if (live.refs && live.refs.toggle) {
      const statusSpan = live.refs.toggle.querySelector(".trace__status");
      if (statusSpan) {
        statusSpan.innerHTML = "";
        
        // Create reasoning text component
        const reasoningContainer = document.createElement("span");
        reasoningContainer.className = "reasoning-text";
        statusSpan.appendChild(reasoningContainer);
        
        live.reasoningText = new window.BeUI.ReasoningText(reasoningContainer, {
          phrases: [
            "Reading the question",
            "Classifying the issue",
            "Searching legal sources",
            "Analyzing provisions",
            "Planning the response",
            "Drafting the answer"
          ],
          interval: 2000
        });
        
        // Create progress timer
        const progressContainer = document.createElement("span");
        progressContainer.style.marginLeft = "0.5em";
        statusSpan.appendChild(progressContainer);
        
        live.agentProgress = new window.BeUI.AgentProgress(progressContainer, {
          label: "",
          initialSeconds: 0
        });
      }
    }
    
    // Keep the interval for updating elapsed time display
    live.timerId = setInterval(() => {
      if (token !== pipelineToken || !live.refs) {
        clearInterval(live.timerId);
        return;
      }
      // The AgentProgress component handles its own updates
    }, 1000);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function setStepActive(agentMsg, index) {
    if (!agentMsg.steps || !agentMsg.steps[index]) return;
    if (index > 0) {
      const prev = agentMsg.steps[index - 1];
      if (prev && prev.state !== "done") {
        prev.state = "done";
        updateStepEl(index - 1, prev);
      }
    }
    const step = agentMsg.steps[index];
    step.state = "active";
    step._start = Date.now();
    updateStepEl(index, step);
    
    // Update BeUIThinking component if available
    if (live.thinkingComponent) {
      live.thinkingComponent.addStep({
        title: step.title,
        detail: step.detail,
        status: "is-active"
      });
    }
  }

  function setStepDone(agentMsg, index) {
    if (!agentMsg.steps || !agentMsg.steps[index]) return;
    const step = agentMsg.steps[index];
    step.state = "done";
    step.elapsedMs = Date.now() - (step._start || Date.now());
    updateStepEl(index, step);
    
    // Update BeUIThinking component if available
    if (live.thinkingComponent) {
      // Mark the last added step as complete
      const steps = live.thinkingComponent.data.steps;
      if (steps.length > 0) {
        steps[steps.length - 1].status = "is-complete";
        live.thinkingComponent.renderSteps();
      }
    }
  }

  async function runPipeline(convo, agentMsg, token) {
    console.log('[runPipeline] Starting pipeline');
    const question = lastUserText(convo);

    // Step 0: Reading the question — purely cosmetic pacing, no server call yet.
    console.log('[runPipeline] Step 0: Reading question');
    setStepActive(agentMsg, 0);
    await sleep(380);
    if (token !== pipelineToken) {
      console.log('[runPipeline] Cancelled after step 0');
      return;
    }

    // Step 1: Classifying — this is where the real network request happens.
    // It stays active (with the live elapsed timer ticking) for however
    // long the server actually takes, since classify+retrieve+draft all
    // happen server-side in one round trip.
    console.log('[runPipeline] Step 1: Classifying (calling API)');
    setStepActive(agentMsg, 1);

    let response;
    let requestError = null;
    try {
      response = await callChatApi(question);
      console.log('[runPipeline] API call completed successfully');
    } catch (err) {
      console.error('[runPipeline] API call failed:', err);
      requestError = err;
    }
    if (token !== pipelineToken) {
      console.log('[runPipeline] Cancelled after API call');
      return;
    }

    if (requestError) {
      console.log('[runPipeline] Finishing with error');
      finishWithError(convo, agentMsg, token, requestError.message);
      return;
    }

    // Casual chat — skip the full legal pipeline and trace UI
    if (response.isCasual) {
      console.log('[runPipeline] Casual chat detected, skipping pipeline');
      agentMsg.casualReply = response.casualReply;
      agentMsg.status = "casual";
      
      // Stop loading state
      if (live.loadingState) {
        live.loadingState.destroy();
        live.loadingState = null;
      }
      
      // Just render the casual reply directly — no trace/thinking UI
      renderCasualReply(agentMsg, response.casualReply);
      finalizeAnswer(agentMsg, token);
      return;
    }

    // HITL — agent needs clarification before continuing
    if (response.needsInput) {
      console.log('[runPipeline] Agent needs input:', response.question);
      
      // Stop loading state
      if (live.loadingState) {
        live.loadingState.destroy();
        live.loadingState = null;
      }
      
      // Get original question to send context with answer
      const originalQuestion = lastUserText(convo);
      
      // Show inline prompt
      renderNeedsInput(agentMsg, response, originalQuestion);
      finalizeAnswer(agentMsg, token);
      return;
    }

    // Stop loading state now that we have a response
    if (live.loadingState) {
      live.loadingState.destroy();
      live.loadingState = null;
    }

    // Safety check: ensure agentMsg exists
    if (!agentMsg) {
      console.error('[runPipeline] agentMsg is undefined! Cannot proceed.');
      finishWithError(convo, agentMsg || { id: 'unknown' }, token, 'Internal error: agent message missing');
      return;
    }

    // Legal question — create Beautiful UI Thinking State for pipeline execution
    // Guard against null steps (migration safety) — apply to BOTH paths
    if (!agentMsg.steps) {
      console.log('[runPipeline] Initializing missing steps for agentMsg:', agentMsg.id);
      agentMsg.steps = STEP_DEFS.map((s, i) => ({ ...s, state: "pending", elapsedMs: 0 }));
    }
    
    if (window.BeUIThinkingState) {
      const thinkingContainer = document.createElement("div");
      live.refs.body.insertBefore(thinkingContainer, live.refs.body.firstChild);
      
      live.thinkingComponent = new window.BeUIThinkingState(thinkingContainer, {
        variant: "Steps"
      });
    } else {
      // Fallback to old trace UI if BeUIThinkingState not available
      const traceEl = document.createElement("div");
      traceEl.className = "trace is-open is-thinking";
      const toggle = buildTraceToggle(agentMsg, traceEl);
      const traceBody = document.createElement("div");
      traceBody.className = "trace__body";
      const stepEls = agentMsg.steps.map((step) => buildStepEl(step));
      stepEls.forEach((se) => traceBody.appendChild(se));
      traceEl.appendChild(toggle);
      traceEl.appendChild(traceBody);
      live.refs.body.insertBefore(traceEl, live.refs.body.firstChild);
      
      live.refs.traceEl = traceEl;
      live.refs.toggle = toggle;
      live.refs.traceBody = traceBody;
      live.refs.stepEls = stepEls;
    }
    
    startTimer(agentMsg, token);

    try {
      agentMsg.classification = normalizeClassification(response.classification);
      
      console.log('[runPipeline] agentMsg.steps:', agentMsg.steps);
      console.log('[runPipeline] agentMsg.steps[1]:', agentMsg.steps[1]);
      
      if (agentMsg.steps[1]) {
        agentMsg.steps[1].detail = `${agentMsg.classification.practiceArea} · ${agentMsg.classification.jurisdictionGuess} · ${agentMsg.classification.urgency} urgency`;
      }
      setStepDone(agentMsg, 1);
    } catch (err) {
      console.error('[runPipeline] Error updating steps:', err);
      console.error('[runPipeline] agentMsg:', agentMsg);
      console.error('[runPipeline] response:', response);
      throw err;
    }

    // Step 2: Searching legal sources — the server already did this; show
    // what it found (or admit nothing's ingested yet) with brief pacing.
    setStepActive(agentMsg, 2);
    const hasResult = !response.corpusEmpty && response.result;
    if (hasResult && response.result.sources && response.result.sources.length) {
      if (agentMsg.steps[2]) {
        agentMsg.steps[2].detail = `Cross-checking ${response.result.sources.length} source${response.result.sources.length === 1 ? "" : "s"} for relevance.`;
        agentMsg.steps[2].chips = response.result.sources.map((s) => s.label);
      }
    } else {
      if (agentMsg.steps[2]) {
        agentMsg.steps[2].detail = "No ingested sources for this practice area yet.";
      }
    }
    if (agentMsg.steps[2]) updateStepEl(2, agentMsg.steps[2]);
    await sleep(350);
    if (token !== pipelineToken) return;
    setStepDone(agentMsg, 2);

    // Step 3: Planning the response — show the reasoning plan
    setStepActive(agentMsg, 3);
    if (response.plan) {
      agentMsg.plan = response.plan;
      if (agentMsg.steps[3]) {
        agentMsg.steps[3].detail = response.plan.analysis || "Analyzing provisions and structuring response";
        if (response.plan.key_provisions && response.plan.key_provisions.length) {
          agentMsg.steps[3].chips = response.plan.key_provisions.slice(0, 3).map(p => {
            // Extract just the act/section name from the provision description
            const match = p.match(/^(Section \d+|[A-Z][^-\n]+)/);
            return match ? match[1].slice(0, 40) : p.slice(0, 40);
          });
        }
      }
    } else {
      if (agentMsg.steps[3]) {
        agentMsg.steps[3].detail = "Preparing response structure";
      }
    }
    if (agentMsg.steps[3]) updateStepEl(3, agentMsg.steps[3]);
    await sleep(400);
    if (token !== pipelineToken) return;
    setStepDone(agentMsg, 3);

    // Step 4: Drafting — also already done server-side; brief pacing only.
    setStepActive(agentMsg, 4);
    await sleep(300);
    if (token !== pipelineToken) return;
    setStepDone(agentMsg, 4);

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
    if (!live.refs || !live.refs.stepEls) return;
    const fresh = buildStepEl(step);
    const old = live.refs.stepEls[index];
    if (old && old.parentNode) old.parentNode.replaceChild(fresh, old);
    live.refs.stepEls[index] = fresh;
  }

  function collapseTrace(agentMsg, token) {
    if (token !== pipelineToken || !live.refs) return;
    clearInterval(live.timerId);
    
    // Stop BeUI components
    if (live.reasoningText) {
      live.reasoningText.stop();
      live.reasoningText = null;
    }
    if (live.agentProgress) {
      live.agentProgress.stop();
      live.agentProgress = null;
    }
    if (live.pipelineLoading) {
      live.pipelineLoading.destroy();
      live.pipelineLoading = null;
    }
    if (live.thinkingComponent) {
      live.thinkingComponent.complete();
      live.thinkingComponent = null;
    }
    if (live.beuiStreaming) {
      live.beuiStreaming.destroy();
      live.beuiStreaming = null;
    }

    agentMsg.thinkingElapsedMs = Date.now() - agentMsg.startedAt;
    agentMsg.traceOpen = false;
    agentMsg.status = "streaming";

    // Only update old trace UI if it exists
    if (live.refs.traceEl && live.refs.toggle) {
      const traceEl = live.refs.traceEl;
      const toggleEl = live.refs.toggle;

      traceEl.classList.remove("is-thinking");
      traceEl.classList.remove("is-open");
      toggleEl.innerHTML = `
        <i class="fa-solid fa-chevron-right trace__toggle-icon"></i>
        <span>Thought for ${(agentMsg.thinkingElapsedMs / 1000).toFixed(1)}s</span>
        <span class="trace__status" style="color: var(--color-text-faint);">${agentMsg.steps.length} steps</span>
      `;
    }
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

  function buildCasualReplyEl(replyText) {
    const wrap = document.createElement("div");
    wrap.className = "casual-reply";
    wrap.innerHTML = `<p>${inlineMd(replyText)}</p>`;
    return wrap;
  }

  function buildStoppedEl() {
    const wrap = document.createElement("div");
    wrap.className = "answer";
    wrap.innerHTML = `
      <div class="answer-section">
        <div class="answer-section__head">
          <div class="answer-section__icon"><i class="fa-solid fa-hand"></i></div>
          <span class="answer-section__title">Response stopped</span>
        </div>
        <div class="answer-section__text"><p>You stopped the response. You can ask a follow-up question or rephrase to continue.</p></div>
      </div>
    `;
    return wrap;
  }

  function renderCasualReply(agentMsg, replyText) {
    if (!live.refs || !live.refs.body) {
      console.warn('[renderCasualReply] live.refs.body not available, cannot render casual reply');
      return;
    }
    live.refs.body.appendChild(buildCasualReplyEl(replyText));
    scrollChatToBottom();
  }

  function renderNeedsInput(agentMsg, response, originalQuestion) {
    if (!live.refs || !live.refs.body) {
      console.warn('[renderNeedsInput] live.refs.body not available');
      return;
    }
    console.log('[renderNeedsInput] Rendering input prompt:', response.question);
    console.log('[renderNeedsInput] Original question:', originalQuestion);
    
    const wrap = document.createElement("div");
    wrap.className = "needs-input";
    wrap.style.cssText = `
      background: var(--color-surface, #1a1a1a);
      border: 1px solid var(--color-accent-border, rgba(242, 183, 5, 0.35));
      border-radius: 10px;
      padding: 14px;
      margin: 12px 0;
    `;
    
    const icon = document.createElement("div");
    icon.innerHTML = '<i class="fa-solid fa-circle-question" style="color: var(--color-accent, #f2b705); font-size: 18px;"></i>';
    icon.style.cssText = "margin-bottom: 8px;";
    
    const question = document.createElement("p");
    question.textContent = response.question || "Can you clarify?";
    question.style.cssText = `
      font-size: 14px;
      color: var(--color-text, #f5f5f2);
      margin: 0 0 12px 0;
      font-weight: 500;
    `;
    
    const inputRow = document.createElement("div");
    inputRow.style.cssText = "display: flex; gap: 8px;";
    
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = response.field === "jurisdiction" ? "e.g., Lagos State" : "Your answer";
    input.style.cssText = `
      flex: 1;
      padding: 8px 12px;
      background: var(--color-bg, #0a0a0a);
      border: 1px solid var(--color-border, #2a2a2a);
      border-radius: 6px;
      color: var(--color-text, #f5f5f2);
      font-size: 14px;
      outline: none;
    `;
    
    const submitBtn = document.createElement("button");
    submitBtn.textContent = "Send";
    submitBtn.style.cssText = `
      padding: 8px 16px;
      background: var(--color-accent, #f2b705);
      color: var(--color-accent-text, #14120a);
      border: none;
      border-radius: 6px;
      font-weight: 600;
      cursor: pointer;
    `;
    
    submitBtn.addEventListener("click", () => {
      const answer = input.value.trim();
      if (!answer) return;
      
      console.log('[renderNeedsInput] User answered:', answer);
      
      // Combine original question with answer for context
      const combinedQuestion = response.field === "jurisdiction"
        ? `${originalQuestion} [State: ${answer}]`
        : `${originalQuestion} [${answer}]`;
      
      console.log('[renderNeedsInput] Combined question:', combinedQuestion);
      submitQuestion(combinedQuestion);
    });
    
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitBtn.click();
    });
    
    inputRow.appendChild(input);
    inputRow.appendChild(submitBtn);
    wrap.appendChild(icon);
    wrap.appendChild(question);
    wrap.appendChild(inputRow);
    
    live.refs.body.appendChild(wrap);
    scrollChatToBottom();
    
    // Focus input
    setTimeout(() => input.focus(), 100);
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

    // Stop loading state if still active
    if (live.loadingState) {
      live.loadingState.destroy();
      live.loadingState = null;
    }
    if (live.pipelineLoading) {
      live.pipelineLoading.destroy();
      live.pipelineLoading = null;
    }

    // Guard against missing steps
    if (agentMsg.steps) {
      agentMsg.steps.forEach((s) => { if (s.state === "active") s.state = "pending"; });
    } else {
      console.warn('[finishWithError] agentMsg.steps is missing, skipping step update');
    }
    
    agentMsg.thinkingElapsedMs = Date.now() - agentMsg.startedAt;
    agentMsg.traceOpen = false;
    agentMsg.status = "error";
    agentMsg.errorMessage = message;

    // Handle BeUIThinking component
    if (live.thinkingComponent) {
      live.thinkingComponent.setStatus("Error");
      live.thinkingComponent = null;
    }
    // Handle BeUIStreamingText
    if (live.beuiStreaming) {
      live.beuiStreaming.destroy();
      live.beuiStreaming = null;
    }
    
    // Handle old trace UI
    if (live.refs.traceEl && live.refs.toggle) {
      const traceEl = live.refs.traceEl;
      traceEl.classList.remove("is-thinking");
      traceEl.classList.remove("is-open");
      live.refs.toggle.innerHTML = `
        <i class="fa-solid fa-chevron-right trace__toggle-icon"></i>
        <span>Stopped after ${(agentMsg.thinkingElapsedMs / 1000).toFixed(1)}s</span>
      `;
    }

    live.refs.body.appendChild(buildErrorEl(message));
    scrollChatToBottom();

    agentMsg.result = null;
    finalizeAnswer(agentMsg, token);
  }

  /**
   * Hybrid streaming wrapper — uses BeUIStreamingText for the beautiful
   * blur-to-clear word animation while keeping the multi-stage pipeline
   * structure (live dots, staggered reveals, context cards, verdict, etc.)
   */
  function streamWithBeUI(container, text, { onDone } = {}) {
    if (window.BeUIStreamingText) {
      const instance = new window.BeUIStreamingText(container, {
        text,
        sources: [],         // sources shown separately via BeUIContextCards stage
        followUps: [],       // follow-ups shown separately in their own stage
        oneShot: true,       // no loop — pipeline moves forward
        showActions: false,  // actions row handled by pipeline verdict stage
        onDone
      });
      // Track for cleanup on stop/abort
      live.beuiStreaming = instance;
      return instance;
    }
    // Fallback to the old streamText if component unavailable
    return streamText(container, text, { onDone });
  }

  function streamAnswerSequence(agentMsg, answerBlock, token) {
    const r = agentMsg.result;
    const refs = answerBlock._refs;

    refs.lawSection.el.classList.add("is-live");
    refs.lawSection.liveDot.style.display = "inline-block";

    streamWithBeUI(refs.lawSection.textEl, r.lawMd, {
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

          streamWithBeUI(refs.actionsSection.textEl, r.actionsMd, {
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
    // Always reset isAgentBusy — even if the token doesn't match (user cancelled).
    // Previously this returned early on token mismatch, leaving the composer
    // stuck in "busy" state with the stop button unresponsive.
    const tokenMatch = token === pipelineToken;
    
    const wasStreaming = agentMsg.status === "streaming";
    const wasCasual = agentMsg.status === "casual";
    if (wasStreaming) agentMsg.status = "done";
    
    // Always reset — don't gate on tokenMatch
    state.isAgentBusy = false;
    
    // Only count quota when the answer actually streamed (not casual / error / stopped)
    if (tokenMatch && wasStreaming) state.questionsUsedToday += 1;

    saveState();
    renderHistory();
    updateComposerState();
    updatePlanLabel();

    if (tokenMatch) {
      live.refs = null;
      live.msgId = null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Composer                                                             */
  /* ------------------------------------------------------------------ */
  function updateComposerState() {
    // --- New BeUIPromptBar path (composer-form was replaced by prompt-bar-container) ---
    if (window.promptBar) {
      if (state.isAgentBusy) {
        window.promptBar.setDisabled(false);
        window.promptBar.setSubmitting(true);
      } else {
        window.promptBar.setSubmitting(false);
        window.promptBar.setDisabled(false);
      }
    }

    // --- Legacy composer path (kept as fallback if old HTML is ever restored) ---
    if (el.composerInput && el.sendBtn) {
      const hasText = el.composerInput.value.trim().length > 0;

      if (state.isAgentBusy) {
        el.sendBtn.disabled = false;
        el.sendBtn.type = "button";
        el.sendBtn.classList.add("composer__send--stop");
        el.sendBtn.innerHTML = '<i class="fa-solid fa-stop"></i>';
        el.sendBtn.setAttribute("aria-label", "Stop generating");
        el.sendBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); stopGeneration(); };

        el.composerInput.classList.add("is-busy");
        el.composerInput.placeholder = "Responding…";
        el.composerInput.disabled = false;
      } else {
        el.sendBtn.type = "submit";
        el.sendBtn.classList.remove("composer__send--stop");
        el.sendBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i>';
        el.sendBtn.setAttribute("aria-label", "Send");
        el.sendBtn.onclick = null;
        el.sendBtn.disabled = !hasText;

        el.composerInput.classList.remove("is-busy");
        el.composerInput.placeholder = "Describe your legal situation…";
        el.composerInput.disabled = false;
      }
    }

    el.newChatBtn.disabled = state.isAgentBusy;
    el.newChatMobile.disabled = state.isAgentBusy;
    updateClearChatButtonState();
  }

  function stopGeneration() {
    // Increment token to invalidate the current pipeline's async callbacks
    pipelineToken += 1;
    clearInterval(live.timerId);
    
    // Stop loading state if still active
    if (live.loadingState) {
      live.loadingState.destroy();
      live.loadingState = null;
    }
    if (live.pipelineLoading) {
      live.pipelineLoading.destroy();
      live.pipelineLoading = null;
    }
    
    // Stop thinking component if active
    if (live.thinkingComponent) {
      live.thinkingComponent.setStatus("Stopped");
      live.thinkingComponent = null;
    }
    // Stop BeUIStreamingText if active
    if (live.beuiStreaming) {
      live.beuiStreaming.destroy();
      live.beuiStreaming = null;
    }
    
    // Mark current agent message as stopped
    const convo = getActiveConversation();
    if (convo && live.msgId) {
      const agentMsg = convo.messages.find((m) => m.id === live.msgId);
      if (agentMsg && (agentMsg.status === "thinking" || agentMsg.status === "streaming")) {
        agentMsg.status = "stopped";
        agentMsg.thinkingElapsedMs = Date.now() - agentMsg.startedAt;
        agentMsg.traceOpen = false;
        
        // Show what we got so far
        if (live.refs) {
          // Handle old trace UI
          if (live.refs.traceEl && live.refs.toggle) {
            const traceEl = live.refs.traceEl;
            traceEl.classList.remove("is-thinking");
            traceEl.classList.remove("is-open");
            live.refs.toggle.innerHTML = `
              <i class="fa-solid fa-chevron-right trace__toggle-icon"></i>
              <span>Stopped after ${(agentMsg.thinkingElapsedMs / 1000).toFixed(1)}s</span>
              <span class="trace__status" style="color: var(--color-text-faint);">partial</span>
            `;
          }
          
          // If we have a partial result, show it
          if (agentMsg.result) {
            // Already streaming, just finalize what we have
          } else if (agentMsg.casualReply) {
            // Already got casual reply
          } else {
            // Show a stopped message
            const stoppedEl = document.createElement("div");
            stoppedEl.className = "answer";
            stoppedEl.innerHTML = `
              <div class="answer-section">
                <div class="answer-section__head">
                  <div class="answer-section__icon"><i class="fa-solid fa-hand"></i></div>
                  <span class="answer-section__title">Response stopped</span>
                </div>
                <div class="answer-section__text"><p>You stopped the response. You can ask a follow-up question or rephrase to continue.</p></div>
              </div>
              <div class="msg__meta"><span class="msg__meta-text">Stopped · ${formatTime(Date.now())}</span></div>
            `;
            live.refs.body.appendChild(stoppedEl);
          }
        }
        
        saveState();
      }
    }
    
    state.isAgentBusy = false;
    live.refs = null;
    live.msgId = null;
    
    updateComposerState();
    renderHistory();
    scrollChatToBottom();
  }

  function autoGrowTextarea() {
    // BeUIPromptBar handles its own auto-resize; this is only needed for the legacy composer
    if (!el.composerInput) return;
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

  el.clearChatBtn.addEventListener("click", () => {
    if (!state.activeId || state.isAgentBusy) return;
    confirmClearConversation(state.activeId);
  });

  el.copyChatBtn.addEventListener("click", () => {
    if (!state.activeId || state.isAgentBusy) return;
    copyConversationToClipboard(state.activeId);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMobileSidebar();
  });

  /* ------------------------------------------------------------------ */
  /* Auth (Firebase) — sidebar sign-in/profile, topbar avatar, modal      */
  /* ------------------------------------------------------------------ */
  let authMode = "signin";

  function initAuth() {
    // Wait for Firebase to be ready
    if (window.firebaseAuth) {
      setupAuth();
    } else {
      console.log("[auth] Waiting for Firebase to initialize...");
      window.addEventListener("firebase-ready", () => {
        console.log("[auth] Firebase ready, setting up auth");
        setupAuth();
      }, { once: true });
      
      // Fallback: if Firebase doesn't load within 3 seconds, show sign-in disabled
      setTimeout(() => {
        if (!window.firebaseAuth) {
          console.warn("[auth] Firebase Auth isn't configured — sign-in disabled.");
          renderAuthSection(null);
        }
      }, 3000);
    }
  }

  function setupAuth() {
    const auth = window.firebaseAuth;
    if (!auth) {
      console.warn("[auth] Firebase Auth isn't configured — sign-in disabled.");
      renderAuthSection(null);
      return;
    }
    
    onAuthStateChanged(auth, (user) => {
      const previousUserId = state.user?.uid;
      const newUserId = user?.uid;
      
      state.user = user;
      
      // If user changed (sign-in, sign-out, or account switch), reload conversations
      if (previousUserId !== newUserId) {
        console.log("[auth] User changed, reloading conversations");
        
        // Reset state for new user
        state.conversations = [];
        state.activeId = null;
        state.questionsUsedToday = 0;
        
        // Load conversations for the new user
        loadState();
        
        // Ensure there's an active conversation
        if (!state.activeId && state.conversations.length > 0) {
          state.activeId = state.conversations[0].id;
        }
        
        // Re-render everything
        renderHistory();
        renderChat();
        updateComposerState();
        updatePlanLabel();
      }
      
      renderAuthSection(user);
    });
  } // end setupAuth()

  function renderAuthSection(user) {
    const container = el.authSection;
    if (!container) return;

    if (!window.firebaseAuth) {
      container.innerHTML = `
        <button type="button" class="auth-signin-btn" disabled title="Sign-in isn't configured yet">
          <i class="fa-solid fa-right-to-bracket"></i> Sign in
        </button>
      `;
      el.topbarAvatar.style.display = "none";
      return;
    }

    if (!user) {
      container.innerHTML = `
        <button type="button" class="auth-signin-btn" id="auth-open-btn">
          <i class="fa-solid fa-right-to-bracket"></i> Sign in
        </button>
      `;
      container.querySelector("#auth-open-btn").addEventListener("click", openAuthModal);
      el.topbarAvatar.style.display = "none";
      return;
    }

    const name = user.displayName || (user.email ? user.email.split("@")[0] : "Account");
    const initials = (name.trim().slice(0, 1) || "?").toUpperCase();
    const avatarInner = user.photoURL
      ? `<img src="${escapeHtml(user.photoURL)}" alt="" />`
      : escapeHtml(initials);

    container.innerHTML = `
      <div class="auth-profile">
        <div class="auth-profile__avatar">${avatarInner}</div>
        <div class="auth-profile__info">
          <span class="auth-profile__name">${escapeHtml(name)}</span>
          ${user.email ? `<span class="auth-profile__email">${escapeHtml(user.email)}</span>` : ""}
        </div>
        <button type="button" class="auth-profile__logout" id="auth-logout-btn" title="Log out" aria-label="Log out">
          <i class="fa-solid fa-right-from-bracket"></i>
        </button>
      </div>
    `;
    container.querySelector("#auth-logout-btn").addEventListener("click", handleLogout);

    el.topbarAvatar.style.display = "flex";
    el.topbarAvatar.innerHTML = avatarInner;
    el.topbarAvatar.title = `${name} · Log out`;
    el.topbarAvatar.onclick = (e) => {
      showPopover(el.topbarAvatar, [
        { label: "Log out", icon: "fa-right-from-bracket", danger: true, onClick: handleLogout },
      ]);
    };
  }

  function openAuthModal() {
    authMode = "signin";
    updateAuthModalMode();
    el.authForm.reset();
    el.authError.style.display = "none";
    el.authModalOverlay.classList.add("is-visible");
    setTimeout(() => el.authEmail.focus(), 60);
  }

  function closeAuthModal() {
    el.authModalOverlay.classList.remove("is-visible");
  }

  function updateAuthModalMode() {
    const isSignup = authMode === "signup";
    el.authTabSignin.classList.toggle("is-active", !isSignup);
    el.authTabSignup.classList.toggle("is-active", isSignup);
    el.authModalTitle.textContent = isSignup ? "Create your account" : "Welcome back";
    el.authSubmit.textContent = isSignup ? "Create account" : "Sign in";
    el.authPassword.autocomplete = isSignup ? "new-password" : "current-password";
    el.authError.style.display = "none";
  }

  function showAuthError(message) {
    el.authError.textContent = message;
    el.authError.style.display = "block";
  }

  function friendlyAuthError(err) {
    const code = (err && err.code) || "";
    const map = {
      "auth/invalid-email": "That email address doesn't look right.",
      "auth/user-not-found": "No account found with that email.",
      "auth/wrong-password": "Incorrect password.",
      "auth/invalid-credential": "Incorrect email or password.",
      "auth/email-already-in-use": "An account already exists with that email — try signing in instead.",
      "auth/weak-password": "Password should be at least 6 characters.",
      "auth/popup-closed-by-user": "Sign-in was cancelled.",
      "auth/operation-not-allowed": "This sign-in method isn't enabled yet for this app.",
      "auth/network-request-failed": "Network error — check your connection and try again.",
    };
    return map[code] || (err && err.message) || "Something went wrong. Try again.";
  }

  function handleLogout() {
    const auth = window.firebaseAuth;
    if (!auth) return;
    
    // Clear all user-specific data before signing out
    clearUserData();
    
    signOut(auth).catch((err) => console.error("[auth] sign out failed:", err));
  }

  // Clear all user-specific data from localStorage and state
  function clearUserData() {
    console.log("[auth] Clearing user data");
    
    // Clear current user's storage
    const storageKey = getStorageKey();
    localStorage.removeItem(storageKey);
    
    // Clear all conversation storage keys (cleanup old anonymous data)
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(STORAGE_KEY_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
    
    // Reset state
    state.conversations = [];
    state.activeId = null;
    state.questionsUsedToday = 0;
    state.user = null;
    
    // Clear any active pipeline
    if (live.loadingState) {
      live.loadingState.destroy();
      live.loadingState = null;
    }
    if (live.pipelineLoading) {
      live.pipelineLoading.destroy();
      live.pipelineLoading = null;
    }
    if (live.thinkingComponent) {
      live.thinkingComponent.destroy();
      live.thinkingComponent = null;
    }
    if (live.beuiStreaming) {
      live.beuiStreaming.destroy();
      live.beuiStreaming = null;
    }
    
    // Re-render
    renderChat();
    renderHistory();
    updateComposerState();
  }

  el.authModalClose.addEventListener("click", closeAuthModal);
  el.authModalOverlay.addEventListener("click", (e) => {
    if (e.target === el.authModalOverlay) closeAuthModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && el.authModalOverlay.classList.contains("is-visible")) closeAuthModal();
  });

  el.authTabSignin.addEventListener("click", () => { authMode = "signin"; updateAuthModalMode(); });
  el.authTabSignup.addEventListener("click", () => { authMode = "signup"; updateAuthModalMode(); });

  el.authForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const auth = window.firebaseAuth;
    if (!auth) return;

    const email = el.authEmail.value.trim();
    const password = el.authPassword.value;
    el.authError.style.display = "none";
    el.authSubmit.disabled = true;
    const originalLabel = el.authSubmit.textContent;
    el.authSubmit.textContent = authMode === "signup" ? "Creating account…" : "Signing in…";

    try {
      if (authMode === "signup") {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      closeAuthModal();
    } catch (err) {
      showAuthError(friendlyAuthError(err));
    } finally {
      el.authSubmit.disabled = false;
      el.authSubmit.textContent = originalLabel;
    }
  });

  el.authGoogleBtn.addEventListener("click", async () => {
    const auth = window.firebaseAuth;
    if (!auth) return;
    el.authError.style.display = "none";
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      closeAuthModal();
    } catch (err) {
      showAuthError(friendlyAuthError(err));
    }
  });

  function init() {
    loadState();
    if (!state.activeId && state.conversations.length) {
      state.activeId = state.conversations[0].id;
    }
    renderHistory();
    renderChat();
    initAuth();       // auth first — more critical than composer
    initPromptBar();  // prompt bar before updateComposerState so it can delegate
    updateComposerState();
    updatePlanLabel();
  }

  function initPromptBar() {
    const container = document.getElementById("prompt-bar-container");
    if (!container) {
      console.warn('[init] Prompt bar container not found');
      return;
    }
    
    if (!window.BeUIPromptBar) {
      console.warn('[init] BeUIPromptBar not available');
      return;
    }

    try {
      // Initialize BeUIPromptBar with full features
      window.promptBar = new window.BeUIPromptBar(container, {
        placeholder: "Describe your legal situation…",
        onSubmit: (text) => {
          if (!text || state.isAgentBusy) return;
          submitQuestion(text);
        },
        onStop: () => {
          if (state.isAgentBusy) {
            stopGeneration();
          }
        },
        sources: [
          { key: "attach", name: "Add photos & files", desc: "Upload from your computer", glyph: "clip", attach: true },
          { key: "legal-db", name: "Legal Database", desc: "Search Nigerian laws", glyph: "layers" },
          { key: "cases", name: "Case Law", desc: "Search court decisions", glyph: "chart" },
          { key: "web", name: "Web Search", desc: "Search the web", glyph: "globe" }
        ],
        commands: [
          { key: "tenancy", name: "/tenancy", desc: "Ask about tenancy law" },
          { key: "employment", name: "/employment", desc: "Ask about employment law" },
          { key: "criminal", name: "/criminal", desc: "Ask about criminal law" },
          { key: "family", name: "/family", desc: "Ask about family law" },
          { key: "business", name: "/business", desc: "Ask about business law" },
          { key: "constitutional", name: "/constitutional", desc: "Ask about constitutional rights" }
        ],
        models: [
          { key: "groq", name: "Groq", tag: "Fast", icon: "fa-bolt" },
          { key: "openrouter", name: "OpenRouter", tag: "35+ models", icon: "fa-globe" },
          { key: "cerebras", name: "Cerebras", tag: "Ultra-fast", icon: "fa-rocket" }
        ]
      });

      console.log('[init] BeUIPromptBar initialized successfully');
    } catch (err) {
      console.error('[init] BeUIPromptBar initialization failed:', err);
    }
  }

  // Unregister service workers and clear caches on load
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => {
        console.log('[cache] Unregistering service worker');
        registration.unregister();
      });
    });
  }
  
  // Clear browser caches
  if ('caches' in window) {
    caches.keys().then((cacheNames) => {
      cacheNames.forEach((cacheName) => {
        console.log('[cache] Deleting cache:', cacheName);
        caches.delete(cacheName);
      });
    });
  }

  init();
})();
