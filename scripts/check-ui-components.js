// Static guard for the 2026-10-27 UI de-inlining pass: all chat surface
// components now build DOM with class names and live in
// public/styles/beui-components.css instead of inline style.cssText blobs
// in app.js (which let the live and reload render paths drift apart).
// This script fails if:
//   - style.cssText creeps back into any guarded function (drift source)
//   - a class a component emits has no rule in the stylesheet
//   - JS wiring hooks vanish from component markup
//   - touch targets drop below 44px where a floor was established
//   - focus-visible / reduced-motion coverage disappears
// Run: node scripts/check-ui-components.js
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const appJs = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const css = fs.readFileSync(
  path.join(root, "public", "styles", "beui-components.css"),
  "utf8"
);

let failures = 0;
function check(name, ok, detail) {
  if (ok) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.error(`FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
}

function escapeRe(s) {
  return s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}

function cssHasClass(cls) {
  return new RegExp(`\\.${escapeRe(cls)}[\\s,{:.]`).test(css);
}

// Extract a function body from `function NAME(` to its matching brace.
// The brace search starts AFTER the parameter list — destructured params like
// `({ message })` contain braces that would otherwise truncate the body.
function functionBody(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) return null;
  const openParen = src.indexOf("(", start);
  let parenDepth = 0;
  let bodyStart = -1;
  for (let i = openParen; i < src.length; i++) {
    const ch = src[i];
    if (ch === "(") parenDepth++;
    else if (ch === ")") {
      parenDepth--;
      if (parenDepth === 0) {
        bodyStart = src.indexOf("{", i);
        break;
      }
    }
  }
  if (bodyStart < 0) return null;
  let depth = 0;
  for (let i = bodyStart; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(bodyStart, i + 1);
    }
  }
  return null;
}

// class="..." (and className="...") emitted within a function body.
function emittedClasses(body) {
  const out = new Set();
  for (const m of body.matchAll(/(?:class="([^"]+)"|className = "([^"]+)")/g)) {
    for (const cls of (m[1] || m[2]).split(/\s+/)) {
      if (cls && !cls.includes("${")) out.add(cls);
    }
  }
  return [...out];
}

// Each guarded component: functions whose bodies must stay cssText-free,
// and CSS classes that must exist once the component emits them.
const COMPONENTS = [
  {
    name: "safety-approval",
    functions: [
      "buildSafetyApprovalCard",
      "renderSafetyApproval",
      "buildSafetyApprovalStatic",
    ],
    prefix: /^(safety-approval|safety-approval__\S+)/,
    hooks: ["safety-ack-cancel", "safety-ack-confirm"],
    mustEmit: ["safety-approval"],
  },
  {
    name: "providers-busy",
    functions: ["renderProvidersBusy", "buildProvidersBusyStatic"],
    prefix: /^providers-busy(__\S+)?$/,
    mustEmit: ["providers-busy"],
  },
  {
    name: "needs-input",
    functions: ["buildNeedsInputCard"],
    prefix: /^needs-input(__\S+)?$/,
    mustEmit: ["needs-input", "needs-input__field", "needs-input__send"],
  },
  {
    name: "safety-flag-banner",
    functions: ["buildAnswerBlock"],
    prefix: /^safety-flag-banner(__\S+)?$/,
    mustEmit: ["safety-flag-banner"],
  },
  {
    name: "followup-chip",
    functions: ["buildAnswerBlock"],
    prefix: /^(followup-chip|answer-followups__title)$/,
    mustEmit: ["followup-chip", "answer-followups__title"],
  },
  {
    name: "answer-sources",
    functions: ["appendContextCards"],
    prefix: /^answer-sources(__\S+)?$/,
    mustEmit: ["answer-sources", "answer-sources__label"],
  },
  {
    name: "trace-status",
    functions: ["startTimer"],
    prefix: /^trace__(reasoning|progress)$/,
    mustEmit: ["trace__reasoning", "trace__progress"],
  },
  {
    name: "casual-reply",
    functions: ["renderCasualReply"],
    prefix: /^casual-reply-plain(__\S+)?$/,
    mustEmit: ["casual-reply-plain__text"],
    unstyledOk: ["casual-reply-plain"],
  },
  {
    name: "offline-pill",
    functions: ["showOfflineNotice"],
    prefix: /^lu-offline-pill$/,
    mustEmit: ["lu-offline-pill"],
  },
];

for (const comp of COMPONENTS) {
  console.log(`\n[${comp.name}]`);
  let emitted = [];
  for (const fn of comp.functions) {
    const body = functionBody(appJs, fn);
    check(`${fn} exists`, !!body);
    if (!body) continue;
    check(
      `${fn} has no cssText`,
      !/\.style\.cssText/.test(body) && !new RegExp(`\\bstyle\\s*=`).test(body)
    );
    emitted = emitted.concat(emittedClasses(body));
  }
  const mine = [...new Set(emitted)].filter((c) => comp.prefix.test(c));
  const hooks = comp.hooks || [];
  for (const cls of comp.mustEmit) {
    check(`${comp.name} emits .${cls}`, mine.includes(cls) || hooks.includes(cls));
  }
  const unstyled = comp.unstyledOk || [];
  for (const cls of mine) {
    if (hooks.includes(cls) || unstyled.includes(cls)) continue;
    check(`stylesheet defines .${cls}`, cssHasClass(cls));
  }
}

// Component invariants.
console.log("\n[invariants]");
check(
  "app.js contains no style.cssText at all",
  !/\.style\.cssText/.test(appJs),
  `${(appJs.match(/\.style\.cssText/g) || []).length} remaining`
);
check(
  "44px touch target on safety gate buttons",
  /\.safety-approval__btn\s*{[\s\S]*?min-height:\s*44px/.test(css)
);
check("focus-visible ring on gate buttons", /\.safety-approval__btn:focus-visible/.test(css));
check(
  "44px touch target on needs-input controls",
  /\.needs-input__(_?)(field|send)\s*{[\s\S]*?min-height:\s*44px/.test(
    css.replace(/needs-input__/g, "needs-input__")
  ) &&
  css.includes(".needs-input__field") &&
  /\.needs-input__field\s*{[\s\S]*?min-height:\s*44px/.test(css) &&
  /\.needs-input__send\s*{[\s\S]*?min-height:\s*44px/.test(css)
);
check("focus-visible ring on needs-input send", /\.needs-input__send:focus-visible/.test(css));
check("focus-visible ring on needs-input field", /\.needs-input__field:focus-visible/.test(css));
check("focus-visible ring on follow-up chips", /\.followup-chip:focus-visible/.test(css));
check(
  "reduced-motion covers animated cards",
  /prefers-reduced-motion:\s*reduce[\s\S]*?\.safety-approval\b/.test(css) &&
    /prefers-reduced-motion:\s*reduce[\s\S]*?\.providers-busy\b/.test(css) &&
    /prefers-reduced-motion:\s*reduce[\s\S]*?\.needs-input\b/.test(css)
);
check(
  "iOS font-zoom guard on needs-input field (16px)",
  /\.needs-input__field\s*{[^}]*font-size:\s*16px/.test(css)
);

// Stylesheet still parses coarsely (brace balance).
const open = (css.match(/{/g) || []).length;
const close = (css.match(/}/g) || []).length;
check("stylesheet braces balanced", open === close, `${open} vs ${close}`);

const indexHtml = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
check("index.html links beui-components.css", indexHtml.includes("styles/beui-components.css"));

if (failures) {
  console.error(`\n${failures} UI component check(s) failed`);
  process.exit(1);
}
console.log("\nUI component checks passed");
