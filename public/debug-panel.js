/**
 * In-app debug panel — captures errors, console output, and network (fetch) calls.
 * Loaded as a classic script before app.js so hooks are in place first.
 * Toggle with the bug button or Ctrl/Cmd+Shift+D.
 */
(function () {
  "use strict";

  var MAX_LOGS = 500;
  var STORAGE_KEY = "lu.debug.logs.v1";
  var OPEN_KEY = "lu.debug.open";
  var FILTER_KEY = "lu.debug.filter";

  var logs = [];
  var filter = "all";
  var open = false;
  var unreadErrors = 0;
  var seq = 0;

  var orig = {
    error: console.error.bind(console),
    warn: console.warn.bind(console),
    log: console.log.bind(console),
    info: console.info ? console.info.bind(console) : console.log.bind(console),
    fetch: window.fetch.bind(window),
  };

  function nowIso() {
    var d = new Date();
    return d.toISOString();
  }

  function clock() {
    var d = new Date();
    return (
      String(d.getHours()).padStart(2, "0") +
      ":" +
      String(d.getMinutes()).padStart(2, "0") +
      ":" +
      String(d.getSeconds()).padStart(2, "0") +
      "." +
      String(d.getMilliseconds()).padStart(3, "0")
    );
  }

  function redact(str) {
    if (typeof str !== "string") return str;
    return str
      .replace(/Bearer\s+[A-Za-z0-9._\-+=\/]+/gi, "Bearer [redacted]")
      .replace(/("?(?:authorization|password|idToken|api[_-]?key|token)"?\s*[:=]\s*")[^"]+/gi, "$1[redacted]")
      .replace(/([?&](?:key|api[_-]?key)=)[^&]+/gi, "$1[redacted]")
      .replace(/ghp_[A-Za-z0-9]{20,}/g, "[redacted-token]");
  }

  function serializeArg(arg) {
    if (arg == null) return String(arg);
    if (typeof arg === "string") return redact(arg);
    if (arg instanceof Error) {
      return arg.stack || arg.name + ": " + arg.message;
    }
    if (typeof arg === "object") {
      try {
        return redact(JSON.stringify(arg, function (k, v) {
          if (/pass|token|authorization|secret|api[_-]?key/i.test(k)) return "[redacted]";
          if (typeof v === "string" && v.length > 4000) return v.slice(0, 4000) + "…";
          return v;
        }));
      } catch (e) {
        try { return String(arg); } catch (e2) { return "[unserializable]"; }
      }
    }
    return String(arg);
  }

  function persist() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(logs.slice(-200)));
    } catch (e) { /* quota */ }
  }

  function loadPersisted() {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) logs = parsed;
    } catch (e) { /* ignore */ }
    try {
      open = sessionStorage.getItem(OPEN_KEY) === "1";
      filter = sessionStorage.getItem(FILTER_KEY) || "all";
    } catch (e) { /* ignore */ }
  }

  function addLog(level, source, message, extra) {
    seq += 1;
    var entry = {
      id: seq,
      ts: nowIso(),
      clock: clock(),
      level: level,
      source: source || "",
      message: redact(String(message || "")),
      extra: extra ? redact(String(extra)) : "",
    };
    logs.push(entry);
    if (logs.length > MAX_LOGS) logs = logs.slice(-MAX_LOGS);
    persist();
    if (level === "error") unreadErrors += 1;
    renderIfReady();
    return entry;
  }

  function argsToMessage(args) {
    var parts = [];
    for (var i = 0; i < args.length; i++) parts.push(serializeArg(args[i]));
    return parts.join(" ");
  }

  console.error = function () {
    addLog("error", "console", argsToMessage(arguments));
    return orig.error.apply(console, arguments);
  };
  console.warn = function () {
    addLog("warn", "console", argsToMessage(arguments));
    return orig.warn.apply(console, arguments);
  };
  console.log = function () {
    addLog("info", "console", argsToMessage(arguments));
    return orig.log.apply(console, arguments);
  };
  console.info = function () {
    addLog("info", "console", argsToMessage(arguments));
    return orig.info.apply(console, arguments);
  };

  window.addEventListener("error", function (ev) {
    var msg = ev.message || "Uncaught error";
    var loc = "";
    if (ev.filename) loc = ev.filename + (ev.lineno != null ? ":" + ev.lineno : "");
    var extra = ev.error && ev.error.stack ? ev.error.stack : loc;
    addLog("error", "window", msg + (loc ? " @ " + loc : ""), extra);
  });

  window.addEventListener("unhandledrejection", function (ev) {
    var reason = ev.reason;
    var msg = serializeArg(reason);
    addLog("error", "promise", "Unhandled rejection: " + msg);
  });

  window.fetch = function (input, init) {
    var started = Date.now();
    var method = "GET";
    var url = "";
    try {
      if (typeof input === "string") url = input;
      else if (input && typeof input.url === "string") url = input.url;
      else url = String(input);
      if (init && init.method) method = String(init.method).toUpperCase();
      else if (input && input.method) method = String(input.method).toUpperCase();
    } catch (e) {
      url = "[unknown]";
    }

    addLog("push", "fetch", method + " " + url, "started");

    return orig.fetch(input, init).then(
      function (res) {
        var ms = Date.now() - started;
        var level = res.ok ? "push" : "error";
        var summary = method + " " + url + " → " + res.status + " " + (res.statusText || "");
        if (res.ok) {
          addLog(level, "fetch", summary, ms + "ms");
        } else {
          res.clone().text().then(function (body) {
            addLog(level, "fetch", summary, ms + "ms" + (body ? " · " + body.slice(0, 500) : ""));
          }).catch(function () {
            addLog(level, "fetch", summary, ms + "ms");
          });
        }
        return res;
      },
      function (err) {
        var ms = Date.now() - started;
        addLog("error", "fetch", method + " " + url + " failed: " + (err && err.message ? err.message : err), ms + "ms");
        throw err;
      }
    );
  };

  /* ------------------------------------------------------------------ */
  /* UI                                                                  */
  /* ------------------------------------------------------------------ */
  var root, listEl, badgeEl, countEl, filterEl;

  function matchesFilter(entry) {
    if (filter === "all") return true;
    if (filter === "error") return entry.level === "error";
    if (filter === "warn") return entry.level === "warn" || entry.level === "error";
    if (filter === "push") return entry.level === "push" || entry.source === "fetch";
    return true;
  }

  function levelClass(level) {
    if (level === "error") return "dbg-row--error";
    if (level === "warn") return "dbg-row--warn";
    if (level === "push") return "dbg-row--push";
    return "dbg-row--info";
  }

  function renderList() {
    if (!listEl) return;
    var visible = logs.filter(matchesFilter);
    var html = [];
    for (var i = 0; i < visible.length; i++) {
      var e = visible[i];
      html.push(
        '<div class="dbg-row ' + levelClass(e.level) + '">' +
          '<span class="dbg-time">' + escapeHtml(e.clock) + "</span>" +
          '<span class="dbg-lvl">' + escapeHtml(e.level) + "</span>" +
          '<span class="dbg-src">' + escapeHtml(e.source) + "</span>" +
          '<span class="dbg-msg">' + escapeHtml(e.message) +
            (e.extra ? '<span class="dbg-extra">' + escapeHtml(e.extra) + "</span>" : "") +
          "</span>" +
        "</div>"
      );
    }
    if (!html.length) {
      listEl.innerHTML = '<div class="dbg-empty">No ' + (filter === "all" ? "" : filter + " ") + "entries yet.</div>";
    } else {
      listEl.innerHTML = html.join("");
      listEl.scrollTop = listEl.scrollHeight;
    }
    updateBadge();
  }

  function updateBadge() {
    if (!badgeEl || !countEl) return;
    var errors = 0;
    for (var i = 0; i < logs.length; i++) if (logs[i].level === "error") errors += 1;
    countEl.textContent = String(errors);
    badgeEl.hidden = errors === 0 || open;
    var n = document.getElementById("dbg-stat");
    if (n) n.textContent = logs.length + " events · " + errors + " errors";
  }

  function renderIfReady() {
    if (root) renderList();
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function setOpen(next) {
    open = !!next;
    if (open) unreadErrors = 0;
    try { sessionStorage.setItem(OPEN_KEY, open ? "1" : "0"); } catch (e) {}
    if (!root) return;
    root.classList.toggle("is-open", open);
    updateBadge();
    if (open) renderList();
  }

  function setFilter(next) {
    filter = next || "all";
    try { sessionStorage.setItem(FILTER_KEY, filter); } catch (e) {}
    if (filterEl) {
      var btns = filterEl.querySelectorAll("[data-filter]");
      for (var i = 0; i < btns.length; i++) {
        btns[i].classList.toggle("is-active", btns[i].getAttribute("data-filter") === filter);
      }
    }
    renderList();
  }

  function copyLogs() {
    var visible = logs.filter(matchesFilter);
    var text = visible.map(function (e) {
      return "[" + e.ts + "] " + e.level.toUpperCase() + " " + e.source + " " + e.message + (e.extra ? " | " + e.extra : "");
    }).join("\n");
    function done() {
      var btn = document.getElementById("dbg-copy");
      if (!btn) return;
      var prev = btn.textContent;
      btn.textContent = "Copied";
      setTimeout(function () { btn.textContent = prev; }, 1200);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () {});
    }
  }

  function clearLogs() {
    logs = [];
    unreadErrors = 0;
    persist();
    renderList();
  }

  function mount() {
    if (document.getElementById("lu-debug-root")) return;

    var style = document.createElement("style");
    style.textContent = [
      "#lu-debug-root{position:fixed;z-index:99999;font-family:var(--font-sans,system-ui,sans-serif);pointer-events:none;}",
      "#lu-debug-root *{box-sizing:border-box;}",
      "#lu-debug-fab{pointer-events:auto;position:fixed;right:16px;bottom:16px;width:40px;height:40px;border-radius:10px;border:1px solid #2a2a2a;background:#161616;color:#f2b705;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.45);}",
      "#lu-debug-fab:hover{border-color:rgba(242,183,5,.45);background:#1c1c1c;}",
      "#lu-debug-fab i{font-size:15px;}",
      "#lu-debug-badge{position:absolute;top:-6px;right:-6px;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:#e5484d;color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;}",
      "#lu-debug-panel{pointer-events:auto;position:fixed;right:16px;bottom:64px;width:min(560px,calc(100vw - 24px));height:min(380px,calc(100vh - 96px));display:none;flex-direction:column;background:#121212;border:1px solid #2a2a2a;border-radius:12px;overflow:hidden;box-shadow:0 16px 48px rgba(0,0,0,.55);}",
      "#lu-debug-root.is-open #lu-debug-panel{display:flex;}",
      ".dbg-head{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid #1f1f1f;background:#161616;}",
      ".dbg-title{font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#f5f5f2;}",
      ".dbg-stat{font-size:11px;color:#6b6b66;margin-left:auto;font-variant-numeric:tabular-nums;}",
      ".dbg-filters{display:flex;gap:4px;padding:6px 10px;border-bottom:1px solid #1f1f1f;}",
      ".dbg-filters button,.dbg-head button{font:inherit;font-size:11px;font-weight:600;color:#9a9a94;background:transparent;border:1px solid #2a2a2a;border-radius:6px;padding:4px 8px;cursor:pointer;}",
      ".dbg-filters button.is-active{color:#14120a;background:#f2b705;border-color:#f2b705;}",
      ".dbg-filters button:hover,.dbg-head button:hover{border-color:rgba(242,183,5,.4);color:#f5f5f2;}",
      ".dbg-list{flex:1;overflow:auto;font-family:SFMono-Regular,Consolas,Menlo,monospace;font-size:11px;line-height:1.45;padding:6px 0;}",
      ".dbg-row{display:grid;grid-template-columns:88px 46px 64px 1fr;gap:8px;padding:4px 10px;border-bottom:1px solid #1a1a1a;align-items:start;}",
      ".dbg-row--error{background:rgba(229,72,77,.08);}",
      ".dbg-row--warn{background:rgba(242,183,5,.06);}",
      ".dbg-time{color:#6b6b66;font-variant-numeric:tabular-nums;}",
      ".dbg-lvl{font-weight:700;text-transform:uppercase;font-size:10px;letter-spacing:.04em;}",
      ".dbg-row--error .dbg-lvl{color:#e5484d;}",
      ".dbg-row--warn .dbg-lvl{color:#f2b705;}",
      ".dbg-row--push .dbg-lvl{color:#4cae6b;}",
      ".dbg-row--info .dbg-lvl{color:#9a9a94;}",
      ".dbg-src{color:#6b6b66;}",
      ".dbg-msg{color:#f5f5f2;word-break:break-word;white-space:pre-wrap;}",
      ".dbg-extra{display:block;color:#6b6b66;margin-top:2px;}",
      ".dbg-empty{color:#6b6b66;padding:24px 12px;text-align:center;}",
      "@media (max-width:600px){.dbg-row{grid-template-columns:72px 40px 1fr;}.dbg-src{display:none;}#lu-debug-panel{right:8px;left:8px;width:auto;bottom:60px;}}",
    ].join("");
    document.head.appendChild(style);

    root = document.createElement("div");
    root.id = "lu-debug-root";
    root.innerHTML =
      '<button type="button" id="lu-debug-fab" aria-label="Toggle debug panel" title="Debug log (Ctrl+Shift+D)">' +
        '<i class="fa-solid fa-bug"></i>' +
        '<span id="lu-debug-badge" hidden><span id="lu-debug-count">0</span></span>' +
      "</button>" +
      '<div id="lu-debug-panel" role="dialog" aria-label="Debug log">' +
        '<div class="dbg-head">' +
          '<span class="dbg-title">Debug</span>' +
          '<span class="dbg-stat" id="dbg-stat"></span>' +
          '<button type="button" id="dbg-copy">Copy</button>' +
          '<button type="button" id="dbg-clear">Clear</button>' +
          '<button type="button" id="dbg-close" aria-label="Close">Close</button>' +
        "</div>" +
        '<div class="dbg-filters" id="dbg-filters">' +
          '<button type="button" data-filter="all">All</button>' +
          '<button type="button" data-filter="error">Errors</button>' +
          '<button type="button" data-filter="warn">Warn</button>' +
          '<button type="button" data-filter="push">Push / net</button>' +
        "</div>" +
        '<div class="dbg-list" id="dbg-list"></div>' +
      "</div>";
    document.body.appendChild(root);

    listEl = document.getElementById("dbg-list");
    badgeEl = document.getElementById("lu-debug-badge");
    countEl = document.getElementById("lu-debug-count");
    filterEl = document.getElementById("dbg-filters");

    document.getElementById("lu-debug-fab").addEventListener("click", function () {
      setOpen(!open);
    });
    document.getElementById("dbg-close").addEventListener("click", function () { setOpen(false); });
    document.getElementById("dbg-copy").addEventListener("click", copyLogs);
    document.getElementById("dbg-clear").addEventListener("click", clearLogs);
    filterEl.addEventListener("click", function (ev) {
      var btn = ev.target.closest("[data-filter]");
      if (!btn) return;
      setFilter(btn.getAttribute("data-filter"));
    });

    document.addEventListener("keydown", function (ev) {
      if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && (ev.key === "D" || ev.key === "d")) {
        ev.preventDefault();
        setOpen(!open);
      }
    });

    setFilter(filter);
    setOpen(open);
    addLog("info", "debug", "Debug panel attached — logging errors, console, and fetch.");
  }

  loadPersisted();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
