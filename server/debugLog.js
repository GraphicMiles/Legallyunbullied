/**
 * Server-side debug ring buffer.
 *
 * Captures console.log / console.warn / console.error into a bounded,
 * redacted in-memory buffer so the in-app debug panel can pull recent server
 * logs without digging through the host dashboard. Nothing is written to
 * disk; the buffer is lost on restart (Render keeps the durable copy).
 *
 * Privacy/secret safety: the same redaction rules as the client panel —
 * bearer tokens, API keys, and GitHub PATs never enter the buffer.
 */

const MAX_ENTRIES = 500;
const entries = [];
let seq = 0;
let patched = false;

function redact(str) {
  return String(str)
    .replace(/Bearer\s+[A-Za-z0-9._\-+=\/]+/gi, "Bearer [redacted]")
    .replace(/("?(?:authorization|password|idToken|api[_-]?key|token)"?\s*[:=]\s*")[^"]+/gi, "$1[redacted]")
    .replace(/([?&](?:key|api[_-]?key)=)[^&]+/gi, "$1[redacted]")
    .replace(/ghp_[A-Za-z0-9]{20,}/g, "[redacted-token]")
    .replace(/\b[0-9a-f]{2}(?::[0-9a-f]{2}){5}\b/gi, "[redacted-mac]");
}

function serialize(arg) {
  if (arg == null) return String(arg);
  if (typeof arg === "string") return redact(arg);
  if (arg instanceof Error) return redact(arg.stack || `${arg.name}: ${arg.message}`);
  if (typeof arg === "object") {
    try {
      return redact(JSON.stringify(arg, (k, v) => {
        if (/pass|token|authorization|secret|api[_-]?key/i.test(k)) return "[redacted]";
        if (typeof v === "string" && v.length > 2000) return v.slice(0, 2000) + "…";
        return v;
      }));
    } catch {
      return "[unserializable]";
    }
  }
  return redact(String(arg));
}

function push(level, args) {
  seq += 1;
  const message = Array.from(args).map(serialize).join(" ").slice(0, 1500);
  entries.push({ id: seq, ts: new Date().toISOString(), level, message });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
}

/** Patch console.* exactly once; originals still write to stdout/Render logs. */
function attach() {
  if (patched) return;
  patched = true;
  for (const level of ["log", "info", "warn", "error"]) {
    const orig = console[level].bind(console);
    console[level] = function (...args) {
      try { push(level === "log" || level === "info" ? "info" : level, args); } catch { /* never break logging */ }
      return orig(...args);
    };
  }
  push("info", ["[debugLog] server log capture attached"]);
}

function snapshot(limit) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 200, 1), MAX_ENTRIES);
  return entries.slice(-n);
}

module.exports = { attach, snapshot, MAX_ENTRIES };
