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
  getIdToken,
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
          // Don't restore activeId — callers must set it explicitly based on
          // context (URL hash, user selection). Restoring from localStorage
          // causes the "base URL opens a chat" bug when stale IDs persist.
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
    // Sync to server if authenticated (non-blocking)
    // Skip sync during:
    // - Server load (prevents sync-during-load duplication loop)
    // - Pipeline run (prevents unnecessary API calls while processing;
    //   the message is synced explicitly in finalizeAnswer)
    if (!_isLoadingFromServer && !state.isAgentBusy) {
      syncToServer();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Server sync — mirrors localStorage to Firestore when authenticated   */
  /* ------------------------------------------------------------------ */
  let _syncQueued = false;
  let _syncInProgress = false;
  let _migrationDone = false;
  let _isLoadingFromServer = false; // prevents syncToServer during loadFromServer

  function isServerMode() {
    return !!(window.firebaseAuth && window.firebaseAuth.currentUser);
  }

  async function getServerAuthHeaders() {
    const headers = { "Content-Type": "application/json" };
    try {
      if (window.firebaseAuth && window.firebaseAuth.currentUser) {
        const token = await getIdToken(window.firebaseAuth.currentUser);
        if (token) headers["Authorization"] = `Bearer ${token}`;
      }
    } catch (e) { /* ignore */ }
    return headers;
  }

  // Fetch all conversations from server and merge into local state
  async function loadFromServer() {
    if (!isServerMode()) return;
    _isLoadingFromServer = true;
    try {
      const headers = await getServerAuthHeaders();
      // Use ?full=true to get all conversations with messages in ONE request
      // instead of N+1 queries (one per conversation)
      const res = await fetch("/api/conversations?full=true", { headers });
      if (!res.ok) {
        console.warn("[server-sync] Failed to load conversations:", res.status);
        _isLoadingFromServer = false;
        return;
      }
      const data = await res.json();
      if (!data.conversations) {
        _isLoadingFromServer = false;
        return;
      }

      // Map server conversations to local format with _synced flags
      const allConversations = data.conversations.map(detail => ({
        id: detail.id,
        title: detail.title || "New question",
        createdAt: detail.createdAt,
        updatedAt: detail.updatedAt,
        _synced: true,
        messages: (detail.messages || []).map(m => ({ ...m, _synced: true })),
      }));

      // Client-side dedup safety net: remove duplicate empty conversations
      // (conversations with same title and no messages — keep the newest)
      const GENERIC_TITLES = new Set(["new question", "legal question", "immigration", "untitled"]);
      const seen = new Map();
      const fullConversations = [];
      for (const c of allConversations) {
        const hasMessages = c.messages.length > 0;
        const normalizedTitle = c.title.trim().toLowerCase();
        if (!hasMessages && GENERIC_TITLES.has(normalizedTitle)) {
          continue; // skip generic empty conversations
        }
        if (!hasMessages && seen.has(normalizedTitle)) {
          continue; // skip duplicate empty conversation
        }
        if (!hasMessages) seen.set(normalizedTitle, true);
        fullConversations.push(c);
      }
      const removed = allConversations.length - fullConversations.length;
      if (removed > 0) {
        console.log(`[server-sync] Dedup: skipped ${removed} duplicate/generic empty conversations`);
      }

      // Always replace local state with server data (even if empty).
      // This makes Firestore the single source of truth when authenticated —
      // deleted conversations stay deleted across reloads.
      state.conversations = fullConversations;
      state.activeId = null; // let URL routing decide what's active
      saveState(); // persist to localStorage as write-behind cache (won't trigger syncToServer because _isLoadingFromServer is true)
      renderHistory();
      renderChat();
      console.log(`[server-sync] Loaded ${fullConversations.length} conversations from server`);
    } catch (err) {
      console.warn("[server-sync] loadFromServer failed:", err.message);
    } finally {
      _isLoadingFromServer = false;
    }
  }

  // Sync local state to server (debounced — only one sync at a time)
  async function syncToServer() {
    if (!isServerMode() || _syncInProgress || _isLoadingFromServer) {
      _syncQueued = true;
      return;
    }
    _syncInProgress = true;
    _syncQueued = false;

    try {
      const headers = await getServerAuthHeaders();

      // Deduplicate: if multiple conversations have the same title and no messages,
      // keep only the newest one. This cleans up duplicates from the sync loop bug.
      const seen = new Map(); // title → index of newest
      const toRemove = [];
      for (let i = state.conversations.length - 1; i >= 0; i--) {
        const c = state.conversations[i];
        const key = (c.title || "New question").trim().toLowerCase();
        const hasMessages = c.messages && c.messages.length > 0;
        if (!hasMessages && seen.has(key)) {
          toRemove.push(i); // duplicate with no messages — remove
        } else if (!hasMessages) {
          seen.set(key, i);
        }
      }
      if (toRemove.length > 0) {
        console.log(`[server-sync] Removing ${toRemove.length} duplicate empty conversations locally`);
        for (const idx of toRemove) {
          state.conversations.splice(idx, 1);
        }
      }

      for (const convo of state.conversations) {
        // Check if this convo has a _synced flag (already on server)
        if (convo._synced) continue;

        // Create new conversation on server
        try {
          const createRes = await fetch("/api/conversations", {
            method: "POST",
            headers,
            body: JSON.stringify({ title: convo.title || "New question" }),
          });

          let serverConvoId;
          if (createRes.ok) {
            const created = await createRes.json();
            serverConvoId = created.id;
          } else {
            console.warn("[server-sync] Failed to create conversation:", createRes.status);
            continue;
          }

          // If server assigned a new ID, update local reference
          if (serverConvoId !== convo.id) {
            const oldId = convo.id;
            convo.id = serverConvoId;
            if (state.activeId === oldId) state.activeId = serverConvoId;
          }

          // Sync all messages
          for (const msg of convo.messages) {
            if (msg._synced) continue;
            try {
              const msgRes = await fetch(`/api/conversations/${convo.id}/messages/${msg.id}`, {
                method: "PUT",
                headers,
                body: JSON.stringify(msg),
              });
              if (msgRes.ok) msg._synced = true;
            } catch (e) {
              console.warn(`[server-sync] Failed to sync message ${msg.id}:`, e.message);
            }
          }

          convo._synced = true;
        } catch (e) {
          console.warn(`[server-sync] Failed to sync conversation ${convo.id}:`, e.message);
        }
      }

      // Persist the _synced flags to localStorage
      const storageKey = getStorageKey();
      localStorage.setItem(storageKey, JSON.stringify({
        conversations: state.conversations,
        activeId: state.activeId,
        questionsUsedToday: state.questionsUsedToday,
      }));
    } catch (err) {
      console.warn("[server-sync] syncToServer failed:", err.message);
    } finally {
      _syncInProgress = false;
      if (_syncQueued) {
        setTimeout(() => syncToServer(), 500);
      }
    }
  }

  // Sync a single message to server immediately (for critical updates like step completion)
  async function syncMessageToServer(convoId, message) {
    if (!isServerMode()) return;
    try {
      const headers = await getServerAuthHeaders();
      const res = await fetch(`/api/conversations/${convoId}/messages/${message.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(message),
      });
      if (res.ok) message._synced = true;
    } catch (e) {
      console.warn(`[server-sync] syncMessage failed for ${message.id}:`, e.message);
    }
  }

  // Migrate existing localStorage conversations to server
  async function migrateToServer() {
    if (!isServerMode() || _migrationDone) return;
    _migrationDone = true;

    const storageKey = getStorageKey();
    const raw = localStorage.getItem(storageKey);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw);
      if (!parsed.conversations || parsed.conversations.length === 0) return;
      if (parsed._migratedToServer) return; // already migrated

      console.log(`[server-sync] Migrating ${parsed.conversations.length} conversations to server...`);
      const headers = await getServerAuthHeaders();

      // Clean _synced flags before sending
      const cleanConvos = parsed.conversations.map(c => {
        const { _synced, ...rest } = c;
        return {
          ...rest,
          messages: (c.messages || []).map(m => {
            const { _synced: ms, ...mRest } = m;
            return mRest;
          }),
        };
      });

      const res = await fetch("/api/conversations/migrate", {
        method: "POST",
        headers,
        body: JSON.stringify({ conversations: cleanConvos }),
      });

      if (res.ok) {
        const data = await res.json();
        // Update local IDs to match server IDs
        if (data.idMap) {
          for (const convo of state.conversations) {
            if (data.idMap[convo.id]) {
              const oldId = convo.id;
              convo.id = data.idMap[oldId];
              convo._synced = true;
              if (state.activeId === oldId) state.activeId = convo.id;
            }
          }
          // Mark all messages as synced
          state.conversations.forEach(c => {
            c._synced = true;
            (c.messages || []).forEach(m => { m._synced = true; });
          });
        }
        // Set migration flag
        parsed._migratedToServer = true;
        localStorage.setItem(storageKey, JSON.stringify(parsed));
        saveState();
        renderHistory();
        renderChat();
        console.log("[server-sync] Migration complete");
      } else {
        console.warn("[server-sync] Migration failed:", res.status);
        _migrationDone = false; // allow retry
      }
    } catch (err) {
      console.warn("[server-sync] Migration error:", err.message);
      _migrationDone = false; // allow retry
    }
  }

  // Delete conversation on server
  async function deleteConversationOnServer(convoId) {
    if (!isServerMode()) return;
    try {
      const headers = await getServerAuthHeaders();
      await fetch(`/api/conversations/${convoId}`, { method: "DELETE", headers });
    } catch (e) {
      console.warn(`[server-sync] Failed to delete conversation ${convoId}:`, e.message);
    }
  }

  // One-time cleanup: delete duplicate empty conversations from the server
  // Created by the sync loop bug — removes conversations with no messages
  // and generic titles like "New question", "Legal question", "Immigration"
  let _cleanupDone = false;
  async function cleanupDuplicates() {
    if (!isServerMode() || _cleanupDone) return;
    _cleanupDone = true;
    try {
      const headers = await getServerAuthHeaders();
      const res = await fetch("/api/conversations/cleanup", { method: "POST", headers });
      if (res.ok) {
        const data = await res.json();
        if (data.deleted > 0) {
          console.log(`[server-sync] Cleaned up ${data.deleted} duplicate conversations`);
        }
      }
    } catch (e) {
      console.warn("[server-sync] Cleanup failed:", e.message);
      _cleanupDone = false; // allow retry
    }
  }

  /* ------------------------------------------------------------------ */
  /* Helpers                                                             */
  /* ------------------------------------------------------------------ */
  function uid() {
    // UUID v4 — proper high-entropy IDs that can't be enumerated or guessed.
    // Uses crypto.randomUUID() where available (all modern browsers + Node 19+),
    // falls back to crypto.getRandomValues for older environments.
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // Fallback: RFC 4122 v4 UUID from crypto.getRandomValues
    const bytes = new Uint8Array(16);
    (crypto || window.crypto || window.msCrypto).getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
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
    t = t.replace(/\*(.+?)\*/g, "<em>$1</em>");
    t = t.replace(/\[(.+?)\]\(.+?\)/g, "$1"); // Strip markdown links, keep text
    t = t.replace(/`(.+?)`/g, "<code>$1</code>");
    // Bug fix: strip placeholder/example URLs that LLM may hallucinate
    t = t.replace(/https?:\/\/(?:www\.)?example\.(?:com|org|net)[^\s)<>"']*/gi, "");
    t = t.replace(/\bexample\.(?:com|org|net)\b/gi, "");
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
  function streamText(container, fullText, { cps = 200, token, onDone } = {}) {
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

  // ── Auth header helper ────────────────────────────────────────────────
  // Returns headers object with Firebase ID token for authenticated API calls.
  // Falls back to plain JSON header if Firebase isn't available or user not signed in.
  async function getAuthHeaders() {
    const headers = { "Content-Type": "application/json" };
    try {
      if (window.firebaseAuth && window.firebaseAuth.currentUser) {
        const token = await getIdToken(window.firebaseAuth.currentUser);
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }
      }
    } catch (e) {
      console.warn("[auth] Failed to get ID token:", e.message);
    }
    return headers;
  }

  // ── Phase 4: Event-driven SSE client ──────────────────────────────────
  // Uses fetch + ReadableStream for authenticated SSE (EventSource doesn't
  // support custom headers). Emits structured events that drive the UI
  // reactively instead of relying on hardcoded step pacing.
  async function callChatApiSSE(question, { onClassify, onSearch, onDraft, onCritique, onSafetyFlag, onComplete, onCasual, onNeedsInput, onCorpusEmpty, onError } = {}) {
    const headers = await getAuthHeaders();
    const url = `/api/chat/stream?question=${encodeURIComponent(question)}`;

    const res = await fetch(url, { headers, signal: AbortSignal.timeout(180000) });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.message || "SSE request failed (" + res.status + ")");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop(); // keep incomplete line in buffer

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr) continue;

        let event;
        try { event = JSON.parse(jsonStr); } catch (e) { continue; }

        switch (event.event) {
          case "classify_done": onClassify?.(event); break;
          case "search_done": onSearch?.(event); break;
          case "draft_done": onDraft?.(event); break;
          case "critique_done": onCritique?.(event); break;
          case "safety_flag":
            onSafetyFlag?.(event);
            return { safetyFlag: true, ackToken: event.ackToken, practiceArea: event.practiceArea, message: event.message };
          case "complete":
            onComplete?.(event);
            return { hasResult: true, result: event.result, classification: event.classification, critique: event.critique, route: event.route };
          case "casual":
            onCasual?.(event);
            return { isCasual: true, casualReply: event.casualReply };
          case "needs_input":
            onNeedsInput?.(event);
            return { needsInput: true, question: event.question, field: event.field };
          case "corpus_empty":
            onCorpusEmpty?.(event);
            return { corpusEmpty: true, message: event.message };
          case "error":
            onError?.(event);
            throw new Error(event.message || "Stream error");
        }
      }
    }

    return { hasResult: false };
  }

  async function callChatApi(question, history) {
    console.log('[callChatApi] Starting API call to /api/chat');
    
    // Add timeout to fetch call
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180000); // 3 minute timeout — full pipeline (classify + search + plan + draft + critique) can take 60-120s on free-tier LLMs
    
    try {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/chat", {
        method: "POST",
        headers,
        body: JSON.stringify({ question, history: history || [] }),
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
        // Provide user-friendly messages for common error codes
        if (res.status === 401) {
          throw new Error("Please sign in to continue. Your session may have expired.");
        }
        if (res.status === 429) {
          throw new Error("You're sending messages too quickly. Please wait a moment and try again.");
        }
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
      // BUG FIX: don't auto-select another conversation — show empty landing state
      state.activeId = null;
      setUrlConvo(null);
    }
    saveState();
    renderHistory();
    renderChat();
    updateClearChatButtonState();
    // Delete from server too (non-blocking)
    deleteConversationOnServer(id);
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
    body.className = "msg__body msg__body--agent-plain";
    wrap.appendChild(body);

    if (msg.status !== "done" && msg.status !== "corpusEmpty" && msg.status !== "error" && msg.status !== "casual" && msg.status !== "stopped") {
      // Never reached a terminal state (e.g. page reload mid-request).
      // Resolve it honestly instead of fabricating an answer.
      finalizeStaleMessage(msg);
    }

    // BUG FIX: Don't render the 5-step trace for casual messages.
    // Casual replies don't go through the legal pipeline — the trace is irrelevant.
    if (msg.status !== "casual") {
      body.appendChild(buildTraceElStatic(msg));
    }

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
      // BUG FIX: If the message has a completed result, the server DID finish
      // — mark all steps "done" so the trace doesn't freeze mid-pipeline on reload.
      // Only reset to "pending" if there's no result (truly interrupted).
      if (msg.result) {
        msg.steps.forEach((s) => { s.state = "done"; });
      } else {
        msg.steps.forEach((s) => { if (s.state !== "done") s.state = "pending"; });
      }
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
      ? `<span class="trace__status" style="color: var(--color-text-faint);">${(msg.steps || []).length} steps</span>`
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
    wrap.className = "answer-block-plain";
    const r = msg.result;

    // Phase 2 safety flag — warn user when high-risk answer couldn't be verified
    if (r._safetyFlag) {
      const banner = document.createElement("div");
      banner.className = "safety-flag-banner";
      banner.style.cssText = `
        background: rgba(229, 72, 77, 0.12);
        border: 1px solid rgba(229, 72, 77, 0.4);
        border-radius: 8px;
        padding: 12px 14px;
        margin-bottom: 16px;
        display: flex;
        gap: 10px;
        align-items: flex-start;
      `;
      banner.innerHTML = `
        <div style="flex-shrink:0; color: var(--color-danger, #e5484d); font-size: 18px; margin-top: 1px;">
          <i class="fa-solid fa-triangle-exclamation"></i>
        </div>
        <div>
          <div style="font-weight: 600; font-size: 13px; color: var(--color-danger, #e5484d); margin-bottom: 4px;">
            High-risk legal area — please verify with a lawyer
          </div>
          <div style="font-size: 13px; color: var(--color-text-muted, #9a9a94); line-height: 1.5;">
            ${escapeHtml(r._safetyFlag.message || "This response covers a sensitive legal area and could not be fully verified.")}
          </div>
        </div>
      `;
      wrap.appendChild(banner);
    }

    // "What the law says" section - plain text
    const lawWrapper = document.createElement("div");
    lawWrapper.className = "answer-text-block";
    const lawTitle = document.createElement("div");
    lawTitle.className = "answer-section-title";
    lawTitle.textContent = "What the law says";
    lawWrapper.appendChild(lawTitle);
    const lawTextEl = document.createElement("div");
    lawWrapper.appendChild(lawTextEl);
    wrap.appendChild(lawWrapper);
    
    if (stream) {
      // Empty container for streaming
    } else {
      lawTextEl.innerHTML = renderMarkdown(r.lawMd);
      appendContextCards(wrap, r.sources);
    }

    // "What you can do" section - plain text
    const actionsWrapper = document.createElement("div");
    actionsWrapper.className = "answer-text-block";
    actionsWrapper.style.marginTop = "16px";
    const actionsTitle = document.createElement("div");
    actionsTitle.className = "answer-section-title";
    actionsTitle.textContent = "What you can do";
    actionsWrapper.appendChild(actionsTitle);
    const actionsTextEl = document.createElement("div");
    actionsWrapper.appendChild(actionsTextEl);
    wrap.appendChild(actionsWrapper);
    
    if (stream) {
      actionsWrapper.style.display = "none";
    } else {
      actionsTextEl.innerHTML = renderMarkdown(r.actionsMd);
    }

    // Verdict (uses BeUIRecommendationCard)
    const verdict = buildVerdictEl(r);
    wrap.appendChild(verdict);
    if (stream) verdict.style.display = "none";

    // Follow-up suggestions
    const followUps = document.createElement("div");
    followUps.className = "answer-followups";
    if (r.followUps && r.followUps.length > 0) {
      const fuTitle = document.createElement("div");
      fuTitle.style.cssText = "font-size: 11px; font-weight: 600; color: var(--color-text-faint, #6b6b66); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;";
      fuTitle.textContent = "Related questions";
      followUps.appendChild(fuTitle);
      r.followUps.forEach((q) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.style.cssText = `
          display: block; width: 100%; text-align: left;
          padding: 8px 12px; margin-bottom: 4px;
          background: var(--color-surface, #1a1a1a);
          border: 1px solid var(--color-border, #2a2a2a);
          border-radius: 8px; color: var(--color-text-muted, #9a9a94);
          font-size: 13px; cursor: pointer; transition: background 0.15s;
        `;
        btn.textContent = q;
        btn.addEventListener("mouseenter", () => { btn.style.background = "var(--color-border, #2a2a2a)"; });
        btn.addEventListener("mouseleave", () => { btn.style.background = "var(--color-surface, #1a1a1a)"; });
        btn.addEventListener("click", () => {
          if (el.composerInput) { el.composerInput.value = q; el.composerInput.focus(); }
          if (window.promptBar && window.promptBar.setValue) window.promptBar.setValue(q);
        });
        followUps.appendChild(btn);
      });
    }
    wrap.appendChild(followUps);
    if (stream) followUps.style.display = "none";

    // Meta / disclaimer line
    const meta = document.createElement("div");
    meta.className = "msg__meta";
    meta.innerHTML = `<span class="msg__meta-text">Legal information, not legal advice · ${formatTime(msg.createdAt)}</span>`;
    wrap.appendChild(meta);
    if (stream) meta.style.display = "none";

    // Approval Card (if agent needs user input)
    let approvalCard = null;
    if (r.approvalQuestions && r.approvalQuestions.length > 0 && window.BeUIApprovalCard) {
      approvalCard = buildApprovalCard(r);
      wrap.appendChild(approvalCard);
      if (stream) approvalCard.style.display = "none";
    }

    wrap._refs = { 
      lawSection: { el: lawWrapper, textEl: lawTextEl, liveDot: null },
      actionsSection: { el: actionsWrapper, textEl: actionsTextEl, liveDot: null },
      verdict,
      followUps,
      meta,
      approvalCard
    };
    return wrap;
  }

  // Bug fix: filter out placeholder/hallucinated sources (e.g. example.com)
  const PLACEHOLDER_DOMAINS_RE = /example\.(com|org|net)|placeholder\.com|test\.com|domain\.com|sample\.com/i;
  function isPlaceholderSource(src) {
    if (!src) return true;
    if (src.label && PLACEHOLDER_DOMAINS_RE.test(src.label)) return true;
    if (src.url && PLACEHOLDER_DOMAINS_RE.test(src.url)) return true;
    if (src.excerpt && PLACEHOLDER_DOMAINS_RE.test(src.excerpt)) return true;
    return false;
  }

  function appendContextCards(sectionEl, sources) {
    if (!sources || !sources.length) return;
    // Filter out any placeholder/hallucinated sources
    const validSources = sources.filter(s => !isPlaceholderSource(s));
    if (!validSources.length) return;
    sources = validSources;
    
    // Simple inline citation list - no card styling
    const list = document.createElement("div");
    list.className = "answer-sources";
    list.style.cssText = `
      margin-top: 12px;
      padding: 8px 0;
      border-top: 1px solid var(--color-border-soft, #1f1f1f);
    `;
    
    const label = document.createElement("div");
    label.style.cssText = `
      font-size: 11px;
      font-weight: 600;
      color: var(--color-text-faint, #6b6b66);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 6px;
    `;
    label.textContent = "Sources";
    list.appendChild(label);
    
    sources.forEach((src) => {
      const item = document.createElement("div");
      item.style.cssText = `
        font-size: 12px;
        color: var(--color-text-muted, #9a9a94);
        margin-bottom: 4px;
        padding-left: 12px;
        border-left: 2px solid var(--color-accent-border, rgba(242, 183, 5, 0.35));
      `;
      
      const name = document.createElement("span");
      name.style.cssText = `
        font-weight: 600;
        color: var(--color-text, #f5f5f2);
      `;
      name.textContent = src.label || "Unknown Source";
      item.appendChild(name);
      
      if (src.excerpt) {
        const excerpt = document.createElement("span");
        excerpt.style.cssText = `
          display: block;
          margin-top: 2px;
          font-style: italic;
          color: var(--color-text-faint, #6b6b66);
          line-height: 1.4;
        `;
        // Truncate long excerpts
        const maxLen = 200;
        excerpt.textContent = src.excerpt.length > maxLen 
          ? src.excerpt.slice(0, maxLen) + "..." 
          : src.excerpt;
        item.appendChild(excerpt);
      }
      
      list.appendChild(item);
    });
    
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
    setUrlConvo(convo.id);
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
    setUrlConvo(id);
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
    body.className = "msg__body msg__body--agent-plain";
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
    live.refs = { wrap, body, traceEl: null, toggle: null, traceBody: null, stepEls: [] };

    runPipeline(convo, agentMsg, token);
  }

  function startTimer(agentMsg, token) {
    clearInterval(live.timerId);
    
    // Update the trace status with elapsed time
    if (live.refs && live.refs.toggle) {
      const statusSpan = live.refs.toggle.querySelector(".trace__status");
      if (statusSpan) {
        statusSpan.innerHTML = "";
        
        // Simple reasoning text display
        const reasoningText = document.createElement("span");
        reasoningText.className = "reasoning-text";
        reasoningText.textContent = "Thinking";
        reasoningText.style.cssText = "font-size: 12px; color: var(--color-text-muted);";
        statusSpan.appendChild(reasoningText);
        
        // Progress timer
        const progressText = document.createElement("span");
        progressText.style.cssText = "margin-left: 0.5em; font-size: 12px; color: var(--color-text-faint); font-variant-numeric: tabular-nums;";
        progressText.textContent = "0s";
        statusSpan.appendChild(progressText);
        
        live.timerId = setInterval(() => {
          if (token !== pipelineToken || !live.refs) {
            clearInterval(live.timerId);
            return;
          }
          const elapsed = Math.floor((Date.now() - agentMsg.startedAt) / 1000);
          progressText.textContent = `${elapsed}s`;
        }, 1000);
      }
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function setStepActive(agentMsg, index) {
    if (!agentMsg || !agentMsg.steps || !agentMsg.steps[index]) return;
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
    
    // BeUIThinkingState is self-contained - it animates on its own.
    // No need to call addStep() - the component handles its own sequence.
  }

  function setStepDone(agentMsg, index) {
    if (!agentMsg || !agentMsg.steps || !agentMsg.steps[index]) return;
    const step = agentMsg.steps[index];
    step.state = "done";
    step.elapsedMs = Date.now() - (step._start || Date.now());
    updateStepEl(index, step);
    
    // BUG FIX: Persist step completion immediately so a page reload
    // doesn't restore a frozen half-completed trace.
    saveState();
    
    // BeUIThinkingState is self-contained - no need to call renderSteps().
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
      // Build conversation history — last 6 messages (3 user + 3 agent pairs)
      const recentMessages = convo.messages
        .filter(m => m.role === "user" || m.status === "done" || m.status === "casual")
        .slice(-6)
        .map(m => ({ role: m.role, content: m.content || m.casualReply || "" }));
      
      response = await callChatApi(question, recentMessages);
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
      
      // BUG FIX: Mark ALL steps done so the trace doesn't freeze mid-pipeline on reload.
      // Casual messages don't need the 5-step trace at all.
      if (agentMsg.steps) {
        agentMsg.steps.forEach((s) => { s.state = "done"; });
      }
      agentMsg.thinkingElapsedMs = Date.now() - agentMsg.startedAt;
      saveState();
      
      // Stop loading state
      if (live.loadingState) {
        live.loadingState.destroy();
        live.loadingState = null;
      }
      
      // Stream the casual reply with animation
      renderCasualReply(agentMsg, response.casualReply, token);
      // Note: finalizeAnswer is called inside renderCasualReply's streamText onDone
      return;
    }

    // HITL — agent needs clarification or safety acknowledgment
    if (response.needsInput) {
      // Phase 3: Safety acknowledgment — show ApprovalCard instead of text input
      if (response.safetyAck) {
        console.log('[runPipeline] Safety acknowledgment required:', response.question);

        if (live.loadingState) {
          live.loadingState.destroy();
          live.loadingState = null;
        }

        renderSafetyApproval(agentMsg, response, token);
        finalizeAnswer(agentMsg, token);
        return;
      }

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

    // All providers busy — show friendly retry banner, auto-retry after cooldown
    if (response.providersBusy) {
      console.log('[runPipeline] All providers busy, retrying in', response.retryAfter, 's');
      
      // Stop loading state
      if (live.loadingState) {
        live.loadingState.destroy();
        live.loadingState = null;
      }
      
      renderProvidersBusy(agentMsg, response);
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
      live.thinkingComponent.destroy();
      live.thinkingComponent = null;
    }
    if (live.beuiStreaming) {
      live.beuiStreaming.destroy();
      live.beuiStreaming = null;
    }

    agentMsg.thinkingElapsedMs = Date.now() - agentMsg.startedAt;
    agentMsg.traceOpen = false;
    agentMsg.status = "streaming";

    // BUG FIX: Ensure ALL steps are marked "done" when collapsing the trace.
    // This prevents the frozen-half-complete state if a step's setStepDone
    // was somehow skipped or the pipeline took an unexpected path.
    if (agentMsg.steps) {
      agentMsg.steps.forEach((s) => { if (s.state !== "done") s.state = "done"; });
    }

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
    wrap.className = "casual-reply-plain";
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

  function renderCasualReply(agentMsg, replyText, token) {
    if (!live.refs || !live.refs.body) {
      console.warn('[renderCasualReply] live.refs.body not available, cannot render casual reply');
      return;
    }
    
    // Casual reply — plain inline text, no bubble/card container.
    // Styled differently from legal responses (which get .answer-block-plain).
    const wrap = document.createElement("div");
    wrap.className = "casual-reply-plain";
    
    const textContainer = document.createElement("div");
    textContainer.style.cssText = `
      font-size: 14px;
      line-height: 1.6;
      color: var(--color-text, #f5f5f2);
      background: transparent;
    `;
    
    wrap.appendChild(textContainer);
    live.refs.body.appendChild(wrap);
    
    // Stream the casual reply text
    streamText(textContainer, replyText, {
      cps: 200,
      token: token,
      onDone: () => {
        if (token === pipelineToken) {
          finalizeAnswer(agentMsg, token);
        }
      }
    });
    
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
      
      // With conversation history, server has context — just send the answer
      console.log('[renderNeedsInput] Sending answer:', answer);
      submitQuestion(answer);
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

  // Phase 3: Safety acknowledgment UI — wired to HITL when high-risk answer fails critique
  function renderSafetyApproval(agentMsg, response, token) {
    if (!live.refs || !live.refs.body) return;

    const wrap = document.createElement("div");
    wrap.className = "safety-approval";
    wrap.style.cssText = `
      background: rgba(229, 72, 77, 0.08);
      border: 1px solid rgba(229, 72, 77, 0.35);
      border-radius: 10px;
      padding: 16px;
      margin: 12px 0;
    `;

    wrap.innerHTML = `
      <div style="display: flex; gap: 10px; align-items: flex-start; margin-bottom: 12px;">
        <div style="flex-shrink:0; color: var(--color-danger, #e5484d); font-size: 20px; margin-top: 2px;">
          <i class="fa-solid fa-triangle-exclamation"></i>
        </div>
        <div>
          <div style="font-weight: 600; font-size: 14px; color: var(--color-danger, #e5484d); margin-bottom: 6px;">
            High-risk legal area — review required
          </div>
          <div style="font-size: 13px; color: var(--color-text-muted, #9a9a94); line-height: 1.5;">
            ${escapeHtml(response.context?.message || response.question || "This response could not be fully verified.")}
          </div>
        </div>
      </div>
      <div style="display: flex; gap: 8px; justify-content: flex-end;">
        <button class="safety-ack-cancel" style="
          padding: 8px 16px; background: transparent;
          border: 1px solid var(--color-border, #2a2a2a);
          border-radius: 6px; color: var(--color-text-muted, #9a9a94);
          font-size: 13px; cursor: pointer;
        ">Cancel</button>
        <button class="safety-ack-confirm" style="
          padding: 8px 16px; background: var(--color-danger, #e5484d);
          border: none; border-radius: 6px; color: white;
          font-size: 13px; font-weight: 600; cursor: pointer;
        ">I understand, show me</button>
      </div>
    `;

    // Cancel — dismiss the card
    wrap.querySelector(".safety-ack-cancel").addEventListener("click", () => {
      wrap.style.opacity = "0.5";
      wrap.querySelector(".safety-ack-confirm").disabled = true;
      wrap.querySelector(".safety-ack-cancel").textContent = "Dismissed";
      wrap.querySelector(".safety-ack-cancel").disabled = true;
      // Send rejection to server
      getAuthHeaders().then(headers => {
        fetch("/api/chat/acknowledge", {
          method: "POST",
          headers,
          body: JSON.stringify({ ackToken: response.ackToken, acknowledged: false }),
        }).catch(() => {});
      });
    });

    // Confirm — fetch the cached response and render it
    wrap.querySelector(".safety-ack-confirm").addEventListener("click", async () => {
      const confirmBtn = wrap.querySelector(".safety-ack-confirm");
      confirmBtn.disabled = true;
      confirmBtn.textContent = "Loading...";

      try {
        const headers = await getAuthHeaders();
        const res = await fetch("/api/chat/acknowledge", {
          method: "POST",
          headers,
          body: JSON.stringify({ ackToken: response.ackToken, acknowledged: true }),
        });
        const data = await res.json();

        if (data.acknowledged && data.result) {
          // Remove the approval card
          wrap.remove();

          // Set the result on the agent message and render the answer
          agentMsg.result = data.result;
          agentMsg.classification = data.classification;
          agentMsg.status = "done";
          if (data.critique) {
            agentMsg.critique = data.critique;
          }

          // Render the answer block with safety banner
          const answerBlock = buildAnswerBlock(agentMsg, { stream: false });
          live.refs.body.appendChild(answerBlock);
          saveState();
          renderHistory();
          scrollChatToBottom();
        } else {
          confirmBtn.textContent = "Response unavailable";
          confirmBtn.style.opacity = "0.5";
        }
      } catch (err) {
        console.error("[safetyAck] Failed:", err);
        confirmBtn.textContent = "Error — try again";
        confirmBtn.disabled = false;
      }
    });

    live.refs.body.appendChild(wrap);
    scrollChatToBottom();
  }

  function renderProvidersBusy(agentMsg, response) {
    if (!live.refs || !live.refs.body) {
      console.warn('[renderProvidersBusy] live.refs.body not available');
      return;
    }
    
    const retryAfter = response.retryAfter || 30;
    const lawMd = response.result?.lawMd || 'All legal reasoning providers are currently busy.';
    const actionsMd = response.result?.actionsMd || '';
    
    const wrap = document.createElement("div");
    wrap.className = "providers-busy";
    wrap.style.cssText = `
      background: var(--color-surface, #1a1a1a);
      border: 1px solid var(--color-border, #2a2a2a);
      border-radius: 10px;
      padding: 14px;
      margin: 12px 0;
    `;
    
    const icon = document.createElement("div");
    icon.innerHTML = '<i class="fa-solid fa-hourglass-half" style="color: var(--color-accent, #f2b705); font-size: 18px;"></i>';
    icon.style.cssText = "margin-bottom: 8px;";
    
    const title = document.createElement("p");
    title.textContent = `Providers are busy — retry in ${retryAfter}s`;
    title.style.cssText = `
      font-size: 14px;
      color: var(--color-text, #f5f5f2);
      margin: 0 0 8px 0;
      font-weight: 600;
    `;
    
    const message = document.createElement("p");
    message.textContent = lawMd;
    message.style.cssText = `
      font-size: 13px;
      color: var(--color-text-muted, #9a9a94);
      margin: 0 0 8px 0;
      line-height: 1.5;
    `;
    
    if (actionsMd) {
      const steps = document.createElement("p");
      steps.innerHTML = actionsMd.replace(/\n/g, '<br>').replace(/^- /g, '• ');
      steps.style.cssText = `
        font-size: 13px;
        color: var(--color-text, #f5f5f2);
        margin: 0;
      `;
      wrap.appendChild(icon);
      wrap.appendChild(title);
      wrap.appendChild(message);
      wrap.appendChild(steps);
    } else {
      wrap.appendChild(icon);
      wrap.appendChild(title);
      wrap.appendChild(message);
    }
    
    live.refs.body.appendChild(wrap);
    scrollChatToBottom();
    
    // Auto-retry after cooldown
    setTimeout(() => {
      const lastQ = lastUserText(agentMsg);
      if (lastQ) {
        console.log('[renderProvidersBusy] Auto-retrying:', lastQ);
        submitQuestion(lastQ);
      }
    }, retryAfter * 1000);
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
      live.thinkingComponent.destroy();
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

    streamWithBeUI(refs.lawSection.textEl, r.lawMd, {
      onDone: () => {
        if (token !== pipelineToken) return;
        const stickAfterLaw = isNearBottom();
        refs.lawSection.el.classList.remove("is-live");
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
          scrollChatToBottom(stickBeforeActions);

          streamWithBeUI(refs.actionsSection.textEl, r.actionsMd, {
            onDone: () => {
              if (token !== pipelineToken) return;
              const stickAfterActions = isNearBottom();
              refs.actionsSection.el.classList.remove("is-live");
              scrollChatToBottom(stickAfterActions);

              setTimeout(() => {
                if (token !== pipelineToken) return;
                const stickBeforeVerdict = isNearBottom();
                refs.verdict.style.display = "";
                scrollChatToBottom(stickBeforeVerdict);

                setTimeout(() => {
                  if (token !== pipelineToken) return;
                  const stickBeforeFollowUps = isNearBottom();
                  if (refs.followUps) refs.followUps.style.display = "";
                  scrollChatToBottom(stickBeforeFollowUps);

                  setTimeout(() => {
                    if (token !== pipelineToken) return;
                    const stickBeforeMeta = isNearBottom();
                    if (refs.meta) refs.meta.style.display = "";
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

    // ── BUG FIX: properly clean up loading state, timer, and thinking elapsed ──
    // Previously these were not cleaned up in the HITL (needsInput) and
    // providersBusy paths, causing orphaned "Analyzing" timers to stay visible
    // and the next pipeline's "Thought for X" to mismatch the live counter.
    if (live.loadingState) {
      live.loadingState.destroy();
      live.loadingState = null;
    }
    clearInterval(live.timerId);
    live.timerId = null;
    if (live.thinkingComponent) {
      live.thinkingComponent.destroy();
      live.thinkingComponent = null;
    }
    if (live.beuiStreaming) {
      live.beuiStreaming.destroy();
      live.beuiStreaming = null;
    }
    // Record thinking elapsed so the trace toggle shows correct time
    // ALWAYS update — collapseTrace sets an early time before streaming,
    // but finalizeAnswer runs after streaming completes (the real total time).
    if (agentMsg.startedAt) {
      agentMsg.thinkingElapsedMs = Date.now() - agentMsg.startedAt;
    }

    saveState();
    renderHistory();
    updateComposerState();
    updatePlanLabel();

    // Update the trace toggle with the correct final time
    // (collapseTrace set an early time before streaming — this fixes it)
    if (tokenMatch && live.refs && live.refs.toggle) {
      const toggleEl = live.refs.toggle;
      toggleEl.innerHTML = `
        <i class="fa-solid fa-chevron-right trace__toggle-icon"></i>
        <span>Thought for ${(agentMsg.thinkingElapsedMs / 1000).toFixed(1)}s</span>
        <span class="trace__status" style="color: var(--color-text-faint);">${(agentMsg.steps || []).length} steps</span>
      `;
    }

    // Immediately sync final message state to server (critical for persistence)
    const activeConvo = getActiveConversation();
    if (activeConvo && tokenMatch) {
      syncMessageToServer(activeConvo.id, agentMsg);
    }

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
      live.thinkingComponent.destroy();
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
        
        // Clear URL hash — don't carry stale conversation IDs across auth changes
        setUrlConvo(null);
        
        // Load conversations for the new user
        loadState();
        
        // CRITICAL: loadState() restores activeId from localStorage — override it.
        // Base URL (no hash) must ALWAYS show empty landing state.
        // Only a URL with #chat/{id} should auto-open a conversation.
        state.activeId = null;
        
        // Re-render everything (empty state — no conversation selected)
        renderHistory();
        renderChat();
        updateComposerState();
        updatePlanLabel();

        // Server sync: load from server and/or migrate localStorage data
        if (user) {
          // First migrate any existing localStorage conversations to server
          migrateToServer().then(() => {
            // Clean up duplicate empty conversations created by the sync loop bug
            return cleanupDuplicates();
          }).then(() => {
            // Then load fresh data from server (authoritative — replaces localStorage)
            return loadFromServer();
          }).then(() => {
            // After server data loaded, check URL for explicit conversation ID
            const urlId = getConvoIdFromUrl();
            if (urlId) {
              const c = state.conversations.find(cc => cc.id === urlId);
              if (c) {
                state.activeId = c.id;
                renderHistory();
                renderChat();
              }
            }
          });
        }
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
    
    // Clear URL hash — don't leave stale conversation IDs after logout
    setUrlConvo(null);
    
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

  /* ------------------------------------------------------------------ */
  /* URL-based routing — base URL = empty state, #chat/{id} = convo      */
  /* ------------------------------------------------------------------ */
  function getConvoIdFromUrl() {
    const hash = window.location.hash;
    const match = hash.match(/^#chat\/(.+)$/);
    return match ? match[1] : null;
  }

  function setUrlConvo(convoId) {
    if (convoId) {
      const newHash = "#chat/" + convoId;
      if (window.location.hash !== newHash) {
        history.replaceState(null, "", newHash);
      }
    } else {
      if (window.location.hash) {
        history.replaceState(null, "", window.location.pathname);
      }
    }
  }

  window.addEventListener("hashchange", () => {
    const urlId = getConvoIdFromUrl();
    if (urlId === null) {
      // URL cleared → show empty landing state
      state.activeId = null;
      saveState();
      renderHistory();
      renderChat();
    } else {
      const convo = state.conversations.find(c => c.id === urlId);
      if (convo) {
        state.activeId = convo.id;
        saveState();
        renderHistory();
        renderChat();
      } else {
        // ID in URL doesn't match any conversation → empty state
        state.activeId = null;
        saveState();
        renderHistory();
        renderChat();
      }
    }
  });

  function init() {
    loadState();
    // BUG FIX: Do NOT auto-select conversations[0]. Base URL = empty landing state.
    // Only load a conversation if the URL explicitly references one.
    const urlConvoId = getConvoIdFromUrl();
    if (urlConvoId) {
      const convo = state.conversations.find(c => c.id === urlConvoId);
      if (convo) {
        state.activeId = convo.id;
      } else {
        // URL has an ID that doesn't match any saved conversation → empty state
        state.activeId = null;
        setUrlConvo(null); // clean up the URL
      }
    } else {
      // No conversation ID in URL → empty landing state, always
      state.activeId = null;
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
