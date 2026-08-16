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
    chatStatus: document.getElementById("chat-status"),
    chatStatusTitle: document.getElementById("chat-status-title"),
    chatStatusSubtitle: document.getElementById("chat-status-subtitle"),
    chatStatusHome: document.getElementById("chat-status-home"),
    chatStatusSignin: document.getElementById("chat-status-signin"),
    chatStatusRetry: document.getElementById("chat-status-retry"),
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
  let _authSettled = false;         // true once onAuthStateChanged has fired (or no-Firebase fallback elapsed)
  let _serverLoadPending = false;   // true while an authenticated server load is in flight

  // Sidebar list pagination + server-side search (Part 2).
  const LIST_PAGE_SIZE = 25;         // conversations per page
  let _listHasMore = false;          // another page exists on the server
  let _listCursor = null;            // keyset cursor (last item id)
  let _listLoadingMore = false;      // a "load more" request is in flight
  let _searchResults = [];           // server search results (title summaries)
  let _searchLoading = false;        // a search request is in flight
  let _searchToken = 0;              // invalidates stale debounced searches
  let _searchDebounce = null;        // debounce timer for the search box

  // Direct-chat-URL resolution (single-chat fetch). Guards against duplicate
  // concurrent fetches and stale results when the user navigates quickly.
  let _directFetchToken = 0;
  let _directFetchPending = false;
  let _directFetchUrlId = null;

  // Map a server conversation detail into the local message format.
  function mapServerConvo(detail) {
    return {
      id: detail.id,
      title: detail.title || "New question",
      createdAt: normMs(detail.createdAt),
      updatedAt: normMs(detail.updatedAt),
      _synced: true,
      _serverTitle: detail.title || "New question",
      messages: (detail.messages || []).map((m) => {
        const { userId, ...rest } = m;
        return { id: m.id, ...rest, _synced: true };
      }),
    };
  }

  // Normalize a stored timestamp to epoch ms (mirrors the server's toMillis)
  // so direct single-chat fetches sort/display correctly regardless of how
  // Firestore serializes the field (number, ISO string, or Timestamp shape).
  function normMs(v) {
    if (v == null) return Date.now();
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      const t = Date.parse(v);
      return Number.isNaN(t) ? Date.now() : t;
    }
    if (v._seconds != null) return v._seconds * 1000;
    if (typeof v.seconds === "number") return v.seconds * 1000;
    return Date.now();
  }

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

  // Fetch all conversations from server and merge into local state.
  // Retries transient failures (5xx, rate limits, network errors) with a short
  // backoff so a single upstream hiccup or deploy race doesn't leave the user
  // with an empty sidebar until the next reload. Loads the FIRST page only;
  // older conversations are paged in via loadMoreConversations().
  async function loadFromServer() {
    if (!isServerMode()) return;
    _isLoadingFromServer = true;
    const MAX_ATTEMPTS = 3;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      const headers = await getServerAuthHeaders();

      let data = null;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        let res;
        try {
          res = await fetch(`/api/conversations?full=true&limit=${LIST_PAGE_SIZE}`, { headers });
        } catch (err) {
          // Network error — retry, then give up.
          if (attempt === MAX_ATTEMPTS) {
            console.warn("[server-sync] loadFromServer network error:", err.message);
            _isLoadingFromServer = false;
            return;
          }
          await wait(800 * attempt);
          continue;
        }

        if (res.ok) {
          data = await res.json();
          break;
        }

        // Retry only transient failures (502/503/504 = upstream or deploy
        // hiccup; 429 = rate limited). A 4xx is a real problem — don't retry.
        const retryable = res.status === 429 || (res.status >= 500 && res.status <= 599);
        if (!retryable || attempt === MAX_ATTEMPTS) {
          console.warn("[server-sync] Failed to load conversations:", res.status);
          _isLoadingFromServer = false;
          return;
        }
        console.warn(`[server-sync] Transient ${res.status} loading conversations — retry ${attempt}/${MAX_ATTEMPTS - 1}`);
        await wait(800 * attempt);
      }

      if (!data || !data.conversations) {
        _isLoadingFromServer = false;
        return;
      }

      // First page REPLACES local state (server is authoritative).
      const allConversations = data.conversations.map(mapServerConvo);
      state.conversations = allConversations;
      _listHasMore = data.hasMore === true;
      _listCursor = data.nextCursor || null;
      state.activeId = null; // let URL routing decide what's active
      saveState(); // persist to localStorage as write-behind cache (won't trigger syncToServer because _isLoadingFromServer is true)
      console.log(`[server-sync] Loaded ${allConversations.length} conversations from server (hasMore=${_listHasMore})`);
    } catch (err) {
      console.warn("[server-sync] loadFromServer failed:", err.message);
    } finally {
      _isLoadingFromServer = false;
    }
  }

  // Fetch the next page of older conversations and APPEND it (never replace).
  async function loadMoreConversations() {
    if (!isServerMode() || _listLoadingMore || !_listHasMore) return;
    _listLoadingMore = true;
    renderHistory(); // reflect the loading state on the button
    try {
      const headers = await getServerAuthHeaders();
      const res = await fetch(
        `/api/conversations?full=true&limit=${LIST_PAGE_SIZE}&cursor=${encodeURIComponent(_listCursor)}`,
        { headers }
      );
      if (!res.ok) {
        console.warn("[server-sync] loadMore failed:", res.status);
        return;
      }
      const data = await res.json();
      const more = (data.conversations || []).map(mapServerConvo);

      // Append, deduping by id (never duplicate a conversation).
      const seen = new Set(state.conversations.map((c) => c.id));
      for (const c of more) {
        if (!seen.has(c.id)) {
          state.conversations.push(c);
          seen.add(c.id);
        }
      }
      _listHasMore = data.hasMore === true;
      _listCursor = data.nextCursor || null;
      saveState();
    } catch (err) {
      console.warn("[server-sync] loadMoreConversations failed:", err.message);
    } finally {
      _listLoadingMore = false;
      renderHistory();
    }
  }

  // Search across ALL of the user's conversations on the server (complete
  // results regardless of how many pages the sidebar has loaded). Anonymous
  // (no Firebase) users get a client-side filter instead.
  async function searchConversations(q) {
    if (!isServerMode()) {
      return state.conversations.filter((c) =>
        (c.title || "").toLowerCase().includes(q.toLowerCase())
      );
    }
    const headers = await getServerAuthHeaders();
    const res = await fetch(`/api/conversations?q=${encodeURIComponent(q)}&full=false`, { headers });
    if (!res.ok) throw new Error(`Search failed (${res.status})`);
    const data = await res.json();
    return (data.conversations || []).map((d) => ({
      id: d.id,
      title: d.title || "New question",
      createdAt: normMs(d.createdAt),
      updatedAt: normMs(d.updatedAt),
      _searchOnly: true,
    }));
  }

  // Fetch ONE conversation by its canonical ID — the authoritative path for
  // direct chat URLs. Ownership is verified server-side (404 for a missing or
  // foreign chat), so a signed-in user gets the correct answer regardless of
  // the bulk list (which is capped at 100 and can be slow or unavailable).
  async function fetchConversationById(id) {
    const headers = await getServerAuthHeaders();
    let res;
    try {
      res = await fetch(`/api/conversations/${encodeURIComponent(id)}`, { headers });
    } catch (err) {
      throw new Error(`Network error loading chat: ${err.message}`);
    }
    if (res.status === 404) return { notFound: true };
    if (!res.ok) throw new Error(`Failed to load chat (${res.status})`);
    const detail = await res.json();
    const convo = {
      id: detail.id,
      title: detail.title || "New question",
      createdAt: normMs(detail.createdAt),
      updatedAt: normMs(detail.updatedAt),
      _synced: true,
      _serverTitle: detail.title || "New question",
      messages: (detail.messages || []).map((m) => {
        const { userId, ...rest } = m;
        return { id: m.id, ...rest, _synced: true };
      }),
    };
    return { convo };
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

      for (const convo of state.conversations) {
        try {
          // Ensure the conversation exists on the server under its canonical ID.
          if (!convo._synced) {
            // Canonical identity: send the local ID so the server persists the
            // conversation under that exact document ID. The server only mints
            // a new ID when none was provided — never for a conversation that
            // already has one.
            const createRes = await fetch("/api/conversations", {
              method: "POST",
              headers,
              body: JSON.stringify({ id: convo.id, title: convo.title || "New question" }),
            });

            let serverConvoId;
            if (createRes.ok) {
              const created = await createRes.json();
              serverConvoId = created.id;
            } else {
              console.warn("[server-sync] Failed to create conversation:", createRes.status);
              continue;
            }

            // Defensive only: with the server honoring the client ID this is a
            // no-op. If it ever fires, keep the URL in sync with the new ID.
            if (serverConvoId !== convo.id) {
              const oldId = convo.id;
              convo.id = serverConvoId;
              if (state.activeId === oldId) {
                state.activeId = serverConvoId;
                setUrlConvo(serverConvoId);
              }
            }

            convo._synced = true;
            convo._serverTitle = convo.title || "New question";
          }

          // Sync the title if it changed since it was last known on the server.
          // Titles are derived from the first message, so they can change after
          // the conversation was first created (this was never synced before).
          if (convo._serverTitle !== convo.title) {
            try {
              const titleRes = await fetch(`/api/conversations/${convo.id}`, {
                method: "PUT",
                headers,
                body: JSON.stringify({ title: convo.title || "New question" }),
              });
              if (titleRes.ok) convo._serverTitle = convo.title;
            } catch (e) {
              console.warn(`[server-sync] Failed to sync title for ${convo.id}:`, e.message);
            }
          }

          // Sync any messages not yet persisted. This MUST run even for
          // conversations already marked _synced — otherwise messages added
          // after the conversation was first created (e.g. after the user
          // clicked New Chat) never reach the server, and only the agent's
          // reply (synced explicitly in finalizeAnswer) survives a reload.
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

  // Migrate existing localStorage conversations to server.
  // This is a one-time operation per user: the flag is stored under its own
  // key so saveState() can't accidentally erase it (which previously caused
  // migration to re-run on every sign-in and spawn duplicate conversations).
  // The server endpoint is also idempotent and ID-preserving as a second line
  // of defense.
  async function migrateToServer() {
    if (!isServerMode() || _migrationDone) return;
    _migrationDone = true;

    const storageKey = getStorageKey();
    const migrationFlagKey = `${storageKey}.migrated`;
    if (localStorage.getItem(migrationFlagKey) === "1") return;

    const raw = localStorage.getItem(storageKey);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw);
      if (!parsed.conversations || parsed.conversations.length === 0) return;

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
        // Mark migration complete under a dedicated key that survives
        // subsequent saveState() writes (this was the root cause of migration
        // re-running on every sign-in).
        localStorage.setItem(migrationFlagKey, "1");
        saveState();
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

  // Automatic legacy cleanup: safely dedupe empty conversations left over from
  // the old sync-loop bug. Runs once per page load after sign-in (idempotent —
  // the server only deletes EMPTY conversations and always keeps the most
  // recently updated one). Conversations with messages are never touched, and
  // a user's current "New question" chat is never wiped.
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
          console.log(`[server-sync] Cleaned up ${data.deleted} duplicate empty conversations`);
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

  async function callChatApi(question, history, options = {}) {
    console.log('[callChatApi] Starting API call to /api/chat');
    
    // Add timeout to fetch call
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180000); // 3 minute timeout — full pipeline (classify + search + plan + draft + critique) can take 60-120s on free-tier LLMs
    
    try {
      const headers = await getAuthHeaders();
      const body = { question, history: history || [] };
      // Recoverable requests: tell the server which message to persist the
      // result into, so an answer computed after the tab closed isn't lost.
      if (options.conversationId) body.conversationId = options.conversationId;
      if (options.messageId) body.messageId = options.messageId;
      const res = await fetch("/api/chat", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
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
    // Don't flash a stale localStorage cache while the authoritative server
    // data is still loading (or before auth has resolved). Show a loading
    // placeholder instead of old/duplicate conversations from the write-behind
    // cache, which are replaced moments later by the server list.
    if (_serverLoadPending || (!_authSettled && window.firebaseAuth)) {
      el.historyList.innerHTML = "";
      const loading = document.createElement("div");
      loading.className = "history__empty";
      loading.textContent = "Loading…";
      el.historyList.appendChild(loading);
      return;
    }

    const query = (el.historySearch.value || "").trim().toLowerCase();
    el.historyList.innerHTML = "";

    // ── Search mode: render server search results (complete, not page-bound) ─
    if (query) {
      if (_searchLoading) {
        const loading = document.createElement("div");
        loading.className = "history__empty";
        loading.textContent = "Searching…";
        el.historyList.appendChild(loading);
        return;
      }
      if (!_searchResults.length) {
        const empty = document.createElement("div");
        empty.className = "history__empty";
        empty.textContent = "No matches.";
        el.historyList.appendChild(empty);
        return;
      }
      const list = document.createElement("ul");
      _searchResults.forEach((c) => list.appendChild(buildHistoryRow(c)));
      el.historyList.appendChild(list);
      return;
    }

    // ── Normal mode: loaded pages, newest first ────────────────────────────
    const sorted = [...state.conversations].sort(
      (a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt)
    );

    if (!sorted.length) {
      const empty = document.createElement("div");
      empty.className = "history__empty";
      empty.textContent = "No questions yet.";
      el.historyList.appendChild(empty);
      return;
    }

    const list = document.createElement("ul");
    sorted.forEach((c) => list.appendChild(buildHistoryRow(c)));
    el.historyList.appendChild(list);

    // ── Load more (older conversations) ────────────────────────────────────
    if (_listHasMore || _listLoadingMore) {
      const moreBtn = document.createElement("button");
      moreBtn.type = "button";
      moreBtn.className = "history__load-more";
      moreBtn.textContent = _listLoadingMore ? "Loading…" : "Load more";
      moreBtn.disabled = _listLoadingMore;
      moreBtn.addEventListener("click", loadMoreConversations);
      el.historyList.appendChild(moreBtn);
    }
  }

  // Debounced search-box input. Clears results immediately when empty;
  // otherwise searches all conversations server-side.
  function onSearchInput() {
    const q = (el.historySearch.value || "").trim();
    clearTimeout(_searchDebounce);
    if (!q) {
      _searchToken += 1;
      _searchResults = [];
      _searchLoading = false;
      renderHistory();
      return;
    }
    _searchLoading = true;
    renderHistory();
    _searchDebounce = setTimeout(() => {
      const token = ++_searchToken;
      searchConversations(q)
        .then((results) => {
          if (token !== _searchToken) return; // superseded by newer input
          _searchResults = results;
          _searchLoading = false;
          renderHistory();
        })
        .catch((err) => {
          if (token !== _searchToken) return;
          console.warn("[search] Search failed:", err.message);
          _searchResults = [];
          _searchLoading = false;
          renderHistory();
        });
    }, 300);
  }

  function buildHistoryRow(c) {
    const li = document.createElement("li");
    // Active highlight lives on the row so it spans the full list width.
    li.className = "history__row" + (c.id === state.activeId ? " is-active" : "");

    const btn = document.createElement("button");
    btn.className = "history__item";
    btn.type = "button";
    btn.dataset.id = c.id;
    if (state.isAgentBusy) btn.disabled = true;

    const titleSpan = document.createElement("span");
    titleSpan.className = "history__item-title";
    titleSpan.textContent = c.title;
    btn.appendChild(titleSpan);

    // Unread badge: any agent message the user hasn't seen yet (e.g. an answer
    // that finished in the background after they closed the tab).
    const hasUnread = (c.messages || []).some((m) => m.role === "agent" && m.unread === true);
    if (hasUnread) {
      const dot = document.createElement("span");
      dot.className = "history__unread-dot";
      dot.setAttribute("aria-label", "Unread answer");
      btn.appendChild(dot);
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

    return li;
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
    const convo =
      state.conversations.find((c) => c.id === id) ||
      _searchResults.find((c) => c.id === id);
    if (!convo) return;
    showConfirm({
      text: `Clear all messages in "${truncate(convo.title, 44)}"? This can't be undone.`,
      confirmLabel: "Clear chat",
      onConfirm: () => clearConversationMessages(id),
    });
  }

  function clearConversationMessages(id) {
    const convo = state.conversations.find((c) => c.id === id);
    if (!convo) {
      // Not loaded locally (e.g. a search result). Clear on the server; the
      // next load/refresh reflects it. Nothing to re-render locally.
      if (isServerMode()) {
        getServerAuthHeaders().then((headers) =>
          fetch(`/api/conversations/${encodeURIComponent(id)}/messages`, {
            method: "DELETE",
            headers,
          }).catch(() => {})
        );
      }
      return;
    }
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
    if (idx === -1) {
      // Not in the loaded pages (e.g. a search result). Delete on the server,
      // drop it from any search results, and reset the view if it was active.
      deleteConversationOnServer(id);
      _searchResults = _searchResults.filter((c) => c.id !== id);
      if (state.activeId === id || getConvoIdFromUrl() === id) {
        state.activeId = null;
        setUrlConvo(null);
        renderHistory();
        renderChat();
        updateClearChatButtonState();
      } else {
        renderHistory();
      }
      return;
    }

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
    hideChatStatus();
    updateClearChatButtonState();

    if (!convo || convo.messages.length === 0) {
      el.emptyState.style.display = "flex";
      renderTopbar();
      return;
    }

    el.emptyState.style.display = "none";

    // Order by when each message was actually created/sent (createdAt), never
    // by when it happened to be saved/synced. This guarantees a background-
    // completed answer always renders BELOW the user's question that prompted
    // it, regardless of how the server or localStorage returned the array.
    // (Array.prototype.sort is stable, so equal/missing createdAt keeps the
    // original relative order.)
    const orderedMessages = [...convo.messages].sort(
      (a, b) => (a.createdAt || 0) - (b.createdAt || 0)
    );

    orderedMessages.forEach((msg) => {
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

    // A server job still in flight (recoverable request): show "still working"
    // instead of misreporting it as incomplete, and poll once to pick up the
    // result when it lands.
    if (msg.pipelineStatus === "running") {
      body.appendChild(buildRunningEl(msg.createdAt));
      scheduleRunningPoll();
      return wrap;
    }

    const TERMINAL_STATUSES = ["done", "corpusEmpty", "error", "casual", "stopped", "needsInput", "safetyAck", "providersBusy"];
    if (!TERMINAL_STATUSES.includes(msg.status)) {
      // Never reached a terminal state (interrupted mid-request). Resolve it
      // honestly instead of fabricating an answer.
      finalizeStaleMessage(msg);
    }

    // Only render the step trace for statuses that actually had one live.
    // Casual, HITL clarifying questions, safety approvals, and provider-busy
    // fallbacks never showed a trace, so don't invent one on reload.
    const SHOW_TRACE = ["done", "corpusEmpty", "error", "stopped", "incomplete"].includes(msg.status);
    if (SHOW_TRACE) {
      // Render the SAME thinking component the live pipeline uses, in static
      // (finished) mode, so a reloaded/reopened chat looks identical to the
      // live "Thought for Xs" state — no separate bubble/card styling.
      if (window.BeUIThinkingState) {
        const traceContainer = document.createElement("div");
        new window.BeUIThinkingState(traceContainer, {
          variant: "Steps",
          static: true,
          elapsedMs: msg.thinkingElapsedMs || 0,
        });
        body.appendChild(traceContainer);
      } else {
        // Fallback if the component failed to load (legacy trace UI).
        body.appendChild(buildTraceElStatic(msg));
      }
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
    } else if (msg.status === "needsInput") {
      // Completed clarifying question — re-render the (still answerable) card.
      body.appendChild(buildNeedsInputCard(
        msg.needsInputQuestion || "Can you clarify?",
        msg.needsInputField,
        (answer) => submitQuestion(answer)
      ));
    } else if (msg.status === "safetyAck") {
      body.appendChild(buildSafetyApprovalStatic(msg));
    } else if (msg.status === "providersBusy") {
      body.appendChild(buildProvidersBusyStatic(msg));
    } else {
      body.appendChild(buildIncompleteEl(msg.createdAt));
    }

    return wrap;
  }

  function finalizeStaleMessage(msg) {
    // Safety net for messages that never reached a terminal state. First:
    // if a completed result is already stored, NEVER clobber it — mark the
    // message done and let the renderer show the saved answer. (Previously
    // this nulled msg.result before checking it, destroying completed data.)
    if (msg.result && (msg.result.lawMd || msg.result.actionsMd || (msg.result.sources && msg.result.sources.length))) {
      msg.status = "done";
      if (msg.steps) {
        msg.steps.forEach((s) => { if (s.state !== "done") s.state = "done"; });
      }
      return;
    }

    // Genuinely interrupted: mark incomplete without inventing an answer.
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

  // Confidence label must reflect EVIDENCE quality, not just writing quality.
  // evidence comes from the server's relevance/sufficiency gate.
  // Self-doubt phrases that prove a citation is weak. If the answer's own text
  // says a source "might be relevant" / "does not directly address", it must
  // never be labeled High confidence — even for legacy stored messages.
  const CLIENT_HEDGE_PATTERNS = [
    "might be relevant", "may be relevant", "could be relevant", "potentially relevant",
    "does not directly address", "do not directly address", "doesn't directly address",
    "don't directly address", "not directly address", "does not specifically address",
    "not directly related", "not directly applicable", "does not directly apply",
    "primarily deals with", "for a more direct application",
    "interpreted within that context",
    "not quite the right provision", "isn't quite the right", "not the right provision",
    "only defines", "based on the provided excerpts", "based on the excerpts provided",
  ];

  function responseHasHedging(r) {
    if (!r) return false;
    const text = ((r.lawMd || "") + " " + (r.actionsMd || "")).toLowerCase();
    return CLIENT_HEDGE_PATTERNS.some((p) => text.includes(p));
  }

  function confidenceFromEvidence(r) {
    const ev = r && r.evidence;
    if (!ev) {
      // Legacy responses (pre-gate). Still apply the hedge rule uniformly.
      if (responseHasHedging(r)) return { label: "Limited evidence", signal: 1 };
      return { label: r.escalate ? "High confidence" : "Good option", signal: r.escalate ? 3 : 2 };
    }
    // Practical/procedural answer — no statute needed, so confidence means
    // "clear practical guidance", not "legally sourced".
    if (ev.noSourcing) {
      return { label: "Practical guidance", signal: 2 };
    }
    // The server downgrades on hedging; also re-check locally for stored
    // messages that predate the server-side check.
    if (ev.sufficient === false || ev.hedged === true || responseHasHedging(r)) {
      return { label: "Limited evidence", signal: 1 };
    }
    if ((ev.sourceCount || 0) >= 2) {
      return { label: "High confidence", signal: 3 };
    }
    return { label: "Based on limited sources", signal: 2 };
  }

  function buildVerdictEl(r) {
    // Use BeUIRecommendationCard
    if (window.BeUIRecommendationCard) {
      const container = document.createElement("div");

      const conf = confidenceFromEvidence(r);
      // Insufficient evidence — including a hedging response — forces the
      // "consult a lawyer" recommendation, regardless of what the drafter said.
      const escalate =
        r.escalate ||
        (r.evidence && (r.evidence.sufficient === false || r.evidence.hedged === true)) ||
        responseHasHedging(r);

      const recommendation = new window.BeUIRecommendationCard(container, {
        options: [
          {
            body: escalate
              ? "This situation likely requires professional legal assistance. A lawyer can help you navigate the legal process and protect your rights."
              : "You can likely handle this yourself by following the steps outlined above. No lawyer needed for this situation.",
            short: escalate ? "Consult a lawyer" : "Handle yourself",
            signal: conf.signal,
            tone: escalate ? "var(--color-accent)" : "var(--color-success)",
            label: conf.label,
            cta: escalate ? "Find lawyer" : "Got it",
            ctaStyle: escalate ? "var(--color-accent)" : "var(--color-success)"
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
      updatedAt: Date.now(),
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

    const existing = state.conversations.find((c) => c.id === id);
    if (!existing) {
      // Not loaded yet (e.g. a server search result beyond the loaded pages).
      // Navigate to the URL; resolveUrl() will fetch it via the single-chat
      // endpoint and merge it into state.
      setUrlConvo(id);
      resolveUrl();
      closeMobileSidebar();
      return;
    }

    state.activeId = id;
    setUrlConvo(id);
    markConversationRead(id);
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

  // Clear the "unread" flag on a conversation's agent messages — the user has
  // now seen them. Returns true if anything changed (so callers can re-render).
  function markConversationRead(convoId) {
    const convo = state.conversations.find((c) => c.id === convoId);
    if (!convo) return false;
    let changed = false;
    for (const m of convo.messages) {
      if (m.role === "agent" && m.unread) {
        m.unread = false;
        changed = true;
        if (isServerMode()) syncMessageToServer(convoId, m);
      }
    }
    if (changed) saveState();
    return changed;
  }

  function ensureActiveConversation() {
    if (!getActiveConversation()) createConversation();
  }

  /* ------------------------------------------------------------------ */
  /* Contextual title generation                                         */
  /* ------------------------------------------------------------------ */
  function deriveTopicFromText(text) {
    // Build a title from the user's first message. Legal keywords map to a
    // category title; otherwise the message itself becomes the title so the
    // chat always reflects what it's actually about (never a fixed placeholder).
    const lower = String(text || "").toLowerCase();
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

    return titleFromFirstMessage(text);
  }

  // Derive a compact title from the first message itself (context, not a
  // generic placeholder like "Legal question").
  function titleFromFirstMessage(text) {
    const clean = String(text || "").trim().replace(/\s+/g, " ");
    if (!clean) return "New chat";

    const MAX_TITLE = 48;
    if (clean.length <= MAX_TITLE) {
      return clean.charAt(0).toUpperCase() + clean.slice(1);
    }

    // Cut at a word boundary so we don't split a word in half.
    const cut = clean.slice(0, MAX_TITLE);
    const lastSpace = cut.lastIndexOf(" ");
    return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
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
    _runningPolls = 0; // new pipeline → reset the bounded running-job poll budget
    ensureActiveConversation();
    const convo = getActiveConversation();

    const userMsg = { id: uid(), role: "user", content: text, createdAt: Date.now() };
    convo.messages.push(userMsg);
    convo.updatedAt = Date.now(); // keep the sidebar ordering stable for local chats

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
      // Build conversation history — last 18 messages (~9 exchanges) so an
      // early clarifying answer (e.g. an HITL jurisdiction reply) is retained.
      // Agent turns must carry REAL content: legal replies store their answer
      // in result.lawMd (agent messages have no `.content` field), casual
      // replies in casualReply, and HITL clarifying questions in
      // needsInputQuestion. (Previously agent legal replies mapped to "" —
      // the window existed but the agent's own answers weren't in it.)
      const recentMessages = convo.messages
        .filter(m => m.role === "user" || m.status === "done" || m.status === "casual" || m.status === "needsInput")
        .slice(-18)
        .map(m => ({
          role: m.role,
          content: m.content || m.casualReply || (m.result && m.result.lawMd) || m.needsInputQuestion || "",
        }));
      
      response = await callChatApi(question, recentMessages, {
        conversationId: convo.id,
        messageId: agentMsg.id,
      });
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

        // Persist a terminal status + the data needed to re-render this card
        // on reload. Previously the status stayed "thinking", so the static
        // renderer misread a COMPLETED exchange as "incomplete".
        agentMsg.status = "safetyAck";
        agentMsg.safetyAckQuestion = response.question || "";
        agentMsg.safetyAckContext = response.context || null;
        agentMsg.safetyAckToken = response.ackToken || null;

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
      
      // Persist a terminal status + the question/field so the clarifying card
      // survives reload (previously lost → "NOT SOURCED YET" on reload).
      agentMsg.status = "needsInput";
      agentMsg.needsInputQuestion = response.question || "";
      agentMsg.needsInputField = response.field || "";

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

      // Persist a terminal status + the busy message so it re-renders on
      // reload instead of being misread as incomplete.
      agentMsg.status = "providersBusy";
      agentMsg.providersBusyRetryAfter = response.retryAfter || 30;
      agentMsg.providersBusyLawMd = response.result?.lawMd || "All legal reasoning providers are currently busy.";
      agentMsg.providersBusyActionsMd = response.result?.actionsMd || "";
      
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
        variant: "Steps",
        // Real pipeline start time so "Thought for Xs" shows the actual
        // elapsed time instead of the component's hardcoded demo value.
        startedAt: agentMsg.startedAt
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
    // Persist the result IMMEDIATELY (before streaming) so that even a
    // mid-stream reload has the completed answer stored — the static renderer
    // then recovers it via finalizeStaleMessage's "has result" safety net
    // instead of showing "incomplete".
    saveState();
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
    // Freeze the thinking time NOW — this is the single source of truth for
    // "Thought for X.Xs", and it must never include streaming time.
    agentMsg.thinkingElapsedMs = Date.now() - agentMsg.startedAt;
    agentMsg.traceOpen = false;
    agentMsg.status = "streaming";

    // Replace the live (ticking) thinking component with a FROZEN static one
    // so the "Thought for X.Xs" header stays visible through streaming and
    // matches the reload render exactly. It is deliberately NOT tracked in
    // live.thinkingComponent, so finalizeAnswer won't destroy it.
    if (live.thinkingComponent) {
      const container = live.thinkingComponent.container;
      live.thinkingComponent.destroy();
      live.thinkingComponent = null;
      if (container && window.BeUIThinkingState) {
        new window.BeUIThinkingState(container, {
          variant: "Steps",
          static: true,
          elapsedMs: agentMsg.thinkingElapsedMs,
        });
      }
    }
    if (live.beuiStreaming) {
      live.beuiStreaming.destroy();
      live.beuiStreaming = null;
    }

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

    const wrap = buildNeedsInputCard(response.question, response.field, (answer) => {
      console.log('[renderNeedsInput] User answered:', answer);
      // With conversation history, server has context — just send the answer.
      submitQuestion(answer);
    });
    live.refs.body.appendChild(wrap);
    scrollChatToBottom();

    // Focus input
    const input = wrap.querySelector("input");
    setTimeout(() => input && input.focus(), 100);
  }

  // Builds the clarifying-question card. Used both live (renderNeedsInput) and
  // on static re-render after reload, so a completed HITL question is never
  // lost or shown as "not sourced".
  function buildNeedsInputCard(question, field, onAnswer) {
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

    const q = document.createElement("p");
    q.textContent = question || "Can you clarify?";
    q.style.cssText = `
      font-size: 14px;
      color: var(--color-text, #f5f5f2);
      margin: 0 0 12px 0;
      font-weight: 500;
    `;

    const inputRow = document.createElement("div");
    inputRow.style.cssText = "display: flex; gap: 8px;";

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = field === "jurisdiction" ? "e.g., Lagos State" : "Your answer";
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
      if (onAnswer) onAnswer(answer);
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitBtn.click();
    });

    inputRow.appendChild(input);
    inputRow.appendChild(submitBtn);
    wrap.appendChild(icon);
    wrap.appendChild(q);
    wrap.appendChild(inputRow);

    return wrap;
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

  // ── Static re-render builders for HITL/busy states (reload path) ────────
  // These mirror the live cards so a completed exchange re-renders identically
  // on reload instead of being misread as "incomplete".

  function buildSafetyApprovalStatic(msg) {
    const wrap = document.createElement("div");
    wrap.className = "safety-approval";
    wrap.style.cssText = `
      background: rgba(229, 72, 77, 0.08);
      border: 1px solid rgba(229, 72, 77, 0.35);
      border-radius: 10px;
      padding: 16px;
      margin: 12px 0;
    `;
    const message = (msg.safetyAckContext && msg.safetyAckContext.message) || msg.safetyAckQuestion || "This response could not be fully verified.";
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
            ${escapeHtml(message)}
          </div>
        </div>
      </div>
      <div style="display: flex; gap: 8px; justify-content: flex-end;">
        <button class="safety-ack-cancel" style="
          padding: 8px 16px; background: transparent;
          border: 1px solid var(--color-border, #2a2a2a);
          border-radius: 6px; color: var(--color-text-muted, #9a9a94);
          font-size: 13px; cursor: pointer;
        ">Dismiss</button>
        <button class="safety-ack-confirm" style="
          padding: 8px 16px; background: var(--color-danger, #e5484d);
          border: none; border-radius: 6px; color: white;
          font-size: 13px; font-weight: 600; cursor: pointer;
        ">I understand, show me</button>
      </div>
    `;

    wrap.querySelector(".safety-ack-cancel").addEventListener("click", () => {
      wrap.style.opacity = "0.5";
      wrap.querySelector(".safety-ack-confirm").disabled = true;
      wrap.querySelector(".safety-ack-cancel").disabled = true;
    });

    wrap.querySelector(".safety-ack-confirm").addEventListener("click", async () => {
      const confirmBtn = wrap.querySelector(".safety-ack-confirm");
      confirmBtn.disabled = true;
      confirmBtn.textContent = "Loading...";
      try {
        const headers = await getAuthHeaders();
        const res = await fetch("/api/chat/acknowledge", {
          method: "POST",
          headers,
          body: JSON.stringify({ ackToken: msg.safetyAckToken, acknowledged: true }),
        });
        const data = await res.json();
        if (data.acknowledged && data.result) {
          msg.result = data.result;
          msg.classification = data.classification;
          msg.status = "done";
          if (data.critique) msg.critique = data.critique;
          saveState();
          renderChat();
        } else {
          // Token expired after reload — honest fallback.
          confirmBtn.textContent = "Expired — ask again";
          confirmBtn.style.opacity = "0.5";
        }
      } catch (err) {
        console.error("[safetyAck] Static confirm failed:", err);
        confirmBtn.textContent = "Error — try again";
        confirmBtn.disabled = false;
      }
    });

    return wrap;
  }

  function buildProvidersBusyStatic(msg) {
    const wrap = document.createElement("div");
    wrap.className = "providers-busy";
    wrap.style.cssText = `
      background: var(--color-surface, #1a1a1a);
      border: 1px solid var(--color-border, #2a2a2a);
      border-radius: 10px;
      padding: 14px;
      margin: 12px 0;
    `;
    const retryAfter = msg.providersBusyRetryAfter || 30;
    const lawMd = msg.providersBusyLawMd || "All legal reasoning providers are currently busy.";

    const icon = document.createElement("div");
    icon.innerHTML = '<i class="fa-solid fa-hourglass-half" style="color: var(--color-accent, #f2b705); font-size: 18px;"></i>';
    icon.style.cssText = "margin-bottom: 8px;";

    const title = document.createElement("p");
    title.textContent = `Providers were busy — try again`;
    title.style.cssText = `font-size: 14px; color: var(--color-text, #f5f5f2); margin: 0 0 8px 0; font-weight: 600;`;

    const message = document.createElement("p");
    message.textContent = lawMd;
    message.style.cssText = `font-size: 13px; color: var(--color-text-muted, #9a9a94); margin: 0 0 8px 0; line-height: 1.5;`;

    wrap.appendChild(icon);
    wrap.appendChild(title);
    wrap.appendChild(message);

    if (msg.providersBusyActionsMd) {
      const steps = document.createElement("p");
      steps.innerHTML = msg.providersBusyActionsMd.replace(/\n/g, "<br>").replace(/^- /g, "• ");
      steps.style.cssText = `font-size: 13px; color: var(--color-text, #f5f5f2); margin: 0;`;
      wrap.appendChild(steps);
    }

    return wrap;
  }

  function buildIncompleteEl(createdAt) {
    const wrap = document.createElement("div");
    wrap.className = "answer";
    wrap.innerHTML = `
      <div class="answer-section">
        <div class="answer-section__head">
          <div class="answer-section__icon"><i class="fa-solid fa-circle-info"></i></div>
          <span class="answer-section__title">Response incomplete</span>
        </div>
        <div class="answer-section__text"><p>This response didn't finish processing. You can try asking again.</p></div>
      </div>
      <div class="msg__meta"><span class="msg__meta-text">Legal information, not legal advice · ${formatTime(createdAt)}</span></div>
    `;
    return wrap;
  }

  function buildRunningEl(createdAt) {
    const wrap = document.createElement("div");
    wrap.className = "answer";
    wrap.innerHTML = `
      <div class="answer-section">
        <div class="answer-section__head">
          <div class="answer-section__icon"><i class="fa-solid fa-hourglass-half"></i></div>
          <span class="answer-section__title">Still working on this</span>
        </div>
        <div class="answer-section__text"><p>The answer is still being prepared — it will appear here shortly.</p></div>
      </div>
      <div class="msg__meta"><span class="msg__meta-text">Legal information, not legal advice · ${formatTime(createdAt)}</span></div>
    `;
    return wrap;
  }

  // Poll a still-running server job until it reaches a terminal state (or the
  // budget runs out) so a reopen during processing picks up the finished
  // result without the user reloading. The budget is generous enough to cover
  // the worst recovery path (~5 min stale sweep + a full re-run), and it
  // resets whenever the user opens a different conversation.
  let _runningPollTimer = null;
  let _runningPolls = 0;
  let _runningPollForConvo = null;
  const _runningPollCap = 90;      // 90 × 8s ≈ 12 minutes
  const _runningPollIntervalMs = 8000;

  function hasRunningMessage(convoId) {
    const convo = state.conversations.find((c) => c.id === convoId);
    return !!(convo && convo.messages.some((m) => m.role === "agent" && m.pipelineStatus === "running"));
  }

  function scheduleRunningPoll() {
    if (_runningPollTimer || _runningPolls >= _runningPollCap) return;
    const convoId = state.activeId;
    if (!convoId) return;
    if (_runningPollForConvo !== convoId) {
      _runningPollForConvo = convoId;
      _runningPolls = 0; // opening a different chat resets the budget
    }
    _runningPollTimer = setTimeout(async () => {
      _runningPollTimer = null;
      _runningPolls += 1;
      if (!isServerMode()) return;
      if (!hasRunningMessage(convoId)) return; // resolved elsewhere — stop polling
      try {
        const result = await fetchConversationById(convoId);
        if (result.convo) {
          const idx = state.conversations.findIndex((c) => c.id === convoId);
          if (idx >= 0) state.conversations[idx] = result.convo;
          else state.conversations.push(result.convo);
          if (state.activeId === convoId) {
            // The user is watching this chat — a just-resolved answer is not unread.
            markConversationRead(convoId);
            renderChat();
          }
          saveState();
          renderHistory();
          if (hasRunningMessage(convoId)) scheduleRunningPoll(); // keep going
        }
      } catch (e) {
        console.warn("[poll] Running-job poll failed:", e.message);
        if (hasRunningMessage(convoId)) scheduleRunningPoll(); // transient error — retry (capped)
      }
    }, _runningPollIntervalMs);
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
        citations: false,    // citations are inline bold text + the Sources list — no injected chips
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
        // Replace the raw streamed text with the SAME markdown rendering the
        // reload path uses, so the completed live message matches the static
        // render (bullets, bold) instead of keeping the unformatted stream.
        refs.lawSection.textEl.innerHTML = renderMarkdown(r.lawMd);
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
              // Match the reload render exactly (numbered steps → bullets).
              refs.actionsSection.textEl.innerHTML = renderMarkdown(r.actionsMd);
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
    // A finished stream's content IS the final answer — do NOT destroy it.
    // (destroy() removes the rendered text; destroying here is what made the
    // "What you can do" steps vanish the instant the message completed.)
    // Just drop the reference. In-progress cleanup is handled by
    // stopGeneration() / finishWithError() for the abort paths.
    live.beuiStreaming = null;

    // NOTE: thinkingElapsedMs is frozen by collapseTrace() at the "thinking
    // complete" moment (right before the response starts streaming). Do NOT
    // recompute it here — finalizeAnswer runs AFTER streaming finishes, and
    // overwriting it would inflate the number to include the typing/streaming
    // time. The stored value must reflect only the thinking duration so the
    // live display and reload/static rendering agree.

    saveState();
    renderHistory();
    updateComposerState();
    updatePlanLabel();

    // The user watched this answer live → it is NOT unread. Clear the flag so
    // the server-persisted unread:true doesn't produce a spurious badge.
    agentMsg.unread = false;

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
  if (el.chatStatusHome) el.chatStatusHome.addEventListener("click", goHome);
  if (el.chatStatusSignin) el.chatStatusSignin.addEventListener("click", () => {
    if (window.firebaseAuth) openAuthModal();
  });
  if (el.chatStatusRetry) el.chatStatusRetry.addEventListener("click", resolveUrl);
  el.menuToggle.addEventListener("click", openMobileSidebar);
  el.sidebarClose.addEventListener("click", closeMobileSidebar);
  el.scrim.addEventListener("click", closeMobileSidebar);
  el.historySearch.addEventListener("input", onSearchInput);
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
      
      // Fallback: if Firebase doesn't load within 3 seconds, show the
      // disabled sign-in state. (No resolveUrl() here: in the no-Firebase
      // path _authSettled is already true and the URL was already resolved
      // synchronously in init(), so re-resolving would just re-render the
      // sidebar mid-interaction and could detach in-flight elements.)
      setTimeout(() => {
        if (!window.firebaseAuth) {
          console.warn("[auth] Firebase Auth isn't configured — sign-in disabled.");
          _authSettled = true;
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
      _authSettled = true;
      
      // If user changed (sign-in, sign-out, or account switch), reload conversations
      if (previousUserId !== newUserId) {
        console.log("[auth] User changed, reloading conversations");
        
        // Reset state for the new user
        state.conversations = [];
        state.activeId = null;
        state.questionsUsedToday = 0;
        
        // Load conversations for the new user (localStorage write-behind cache).
        // The URL — not localStorage, not the server — decides what is active.
        loadState();
        state.activeId = null;
        
        if (user) {
          // Authenticated: server data is authoritative. Keep the URL intact
          // and resolve it — if the URL references a chat, show a loading
          // state until the server load finishes; if it's the plain base URL,
          // show the welcome landing screen immediately (never a chat).
          _serverLoadPending = true;
          resolveUrl();
          migrateToServer()
            .then(() => cleanupDuplicates())
            .then(() => loadFromServer())
            .catch((err) => console.warn("[auth] Server load failed:", err.message))
            .then(() => {
              _serverLoadPending = false;
              resolveUrl();
            });
        } else {
          // Signed out: a URL pointing at a server conversation is no longer
          // resolvable — return to the empty landing state. Never auto-create
          // a chat, and never fabricate a replacement.
          setUrlConvo(null);
          renderHistory();
          renderChat();
          updateComposerState();
          updatePlanLabel();
        }
      } else {
        // Same user (including the initial anonymous state) — resolve whatever
        // the URL currently points at.
        resolveUrl();
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

  // Resolve the URL against known conversations. This is the single place that
  // decides what conversation (if any) is active from the URL:
  //   - no #chat/{id}      → empty landing state (never auto-creates a chat)
  //   - #chat/{id} exists  → open that conversation using its existing ID
  //   - #chat/{id} unknown → "Chat not found" (never creates/fabricates a chat)
  // While auth/server data is still loading, show a neutral loading state so a
  // server-backed conversation is never prematurely declared missing.
  function resolveUrl() {
    // Never re-render while a pipeline is streaming. The live UI is being
    // driven by runPipeline/streamAnswerSequence, and a re-render here would
    // wipe the in-flight answer and mark the message stale/incomplete. This
    // also prevents the no-Firebase auth fallback (3s) from clobbering an
    // answer that's still streaming.
    if (state.isAgentBusy) return;
    const urlId = getConvoIdFromUrl();

    if (!urlId) {
      _directFetchToken += 1; // invalidate any in-flight direct fetch
      state.activeId = null;
      renderHistory();
      renderChat();
      updateClearChatButtonState();
      return;
    }

    // Fast path: the chat is already loaded (server list or write-behind
    // cache). It was ownership-verified when it was fetched, so open it
    // directly without a redundant network call.
    //
    // BUT local state is only authoritative once auth has settled AND (for
    // signed-in users) the server list load has finished. Acting on the
    // stale write-behind cache while the server load is pending causes the
    // chat to render twice: once from cache, then again after loadFromServer
    // replaces local state (with a redundant single-chat GET when the server
    // list doesn't contain the chat). Gate it so exactly one load/render
    // happens per URL open.
    const localAuthoritative =
      !window.firebaseAuth || (_authSettled && !_serverLoadPending);

    if (localAuthoritative) {
      const convo = state.conversations.find((c) => c.id === urlId);
      if (convo) {
        _directFetchToken += 1; // cancel any in-flight direct fetch for another id
        state.activeId = convo.id; // use the persisted ID — never a new one
        markConversationRead(convo.id);
        renderHistory();
        renderChat();
        updateClearChatButtonState();
        return;
      }
    }

    state.activeId = null;
    if (_serverLoadPending || !_authSettled) {
      // Server data (or the auth state itself) is still resolving. Hold the
      // URL and show a neutral loading state; resolveUrl() runs again once
      // the load completes.
      renderLoadingChat();
      renderHistory(); // keep the sidebar consistent with the main area
      return;
    }

    // Signed out + chat URL → the user must authenticate before we can even
    // check ownership. Show a sign-in prompt, NOT a misleading "not found".
    // (A signed-out visitor can't own any chat, so "not found / not yours"
    // would be the wrong explanation.)
    const signedOut = !!(window.firebaseAuth && !window.firebaseAuth.currentUser);
    if (signedOut) {
      _directFetchToken += 1;
      showChatStatus(
        "Sign in to view this chat",
        "This chat is saved to an account. Sign in first so we can check whether it's yours.",
        { showSignIn: true }
      );
      renderHistory(); // resolve the sidebar to the empty/signed-out state
      return;
    }

    // Signed in, auth settled, server load finished, chat NOT in the loaded
    // list. Fetch it directly by ID — authoritative and independent of the
    // bulk list (works identically whether the user has 5 or 5,000 chats).
    if (isServerMode()) {
      if (_directFetchPending && _directFetchUrlId === urlId) {
        renderLoadingChat();
        renderHistory();
        return;
      }
      const token = ++_directFetchToken;
      _directFetchPending = true;
      _directFetchUrlId = urlId;
      renderLoadingChat();
      renderHistory();
      resolveDirectChat(urlId, token).finally(() => {
        if (token === _directFetchToken) {
          _directFetchPending = false;
          _directFetchUrlId = null;
        }
      });
      return;
    }

    // No Firebase (anonymous, local-only): there is nothing server-side to
    // fetch, so this ID genuinely isn't available to this visitor.
    renderNotFound();
    renderHistory(); // resolve the sidebar instead of leaving it on "Loading…"
  }

  // Resolve a direct chat URL via the single-chat endpoint and merge the
  // result into local state (never generating a new ID).
  async function resolveDirectChat(urlId, token) {
    try {
      const result = await fetchConversationById(urlId);
      if (token !== _directFetchToken) return; // superseded by newer navigation
      if (result.notFound) {
        renderNotFound();
        renderHistory();
        return;
      }
      if (!state.conversations.some((c) => c.id === urlId)) {
        state.conversations.push(result.convo);
      }
      state.activeId = urlId;
      markConversationRead(urlId);
      saveState();
      renderHistory();
      renderChat();
      updateClearChatButtonState();
    } catch (err) {
      if (token !== _directFetchToken) return;
      console.warn("[server-sync] Direct chat fetch failed:", err.message);
      showChatStatus(
        "Couldn't load this chat",
        "Something went wrong while loading it. Please try again.",
        { showRetry: true }
      );
      renderHistory();
    }
  }

  function showChatStatus(title, subtitle, { showHome = false, showSignIn = false, showRetry = false } = {}) {
    const status = el.chatStatus;
    if (!status) return;
    el.emptyState.style.display = "none";
    el.chatMessages.innerHTML = "";
    el.chatStatusTitle.textContent = title;
    el.chatStatusSubtitle.textContent = subtitle || "";
    el.chatStatusHome.style.display = showHome ? "inline-flex" : "none";
    if (el.chatStatusSignin) el.chatStatusSignin.style.display = showSignIn ? "inline-flex" : "none";
    if (el.chatStatusRetry) el.chatStatusRetry.style.display = showRetry ? "inline-flex" : "none";
    status.hidden = false;
    updateClearChatButtonState();
  }

  function hideChatStatus() {
    if (el.chatStatus) el.chatStatus.hidden = true;
  }

  function renderLoadingChat() {
    showChatStatus("Loading chat…", "Restoring your conversation.");
  }

  function renderNotFound() {
    showChatStatus("Chat not found", "This chat doesn't exist, was deleted, or belongs to a different account.", { showHome: true });
  }

  function goHome() {
    _directFetchToken += 1; // cancel any in-flight direct fetch
    setUrlConvo(null);
    state.activeId = null;
    renderHistory();
    renderChat();
    updateClearChatButtonState();
  }

  window.addEventListener("hashchange", resolveUrl);

  function init() {
    loadState();
    // The URL is the source of truth for what to open. Never clear it
    // preemptively and never auto-create a conversation from the base URL.
    state.activeId = null;
    // No Firebase = anonymous/localStorage only, so no server data is coming
    // and we can render history immediately. When Firebase exists, wait for
    // the auth callback (renderHistory shows a loading placeholder instead of
    // a stale cache that would otherwise flash).
    if (!window.firebaseAuth) _authSettled = true;
    resolveUrl();
    renderHistory();
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
