// Static guard for the safety-approval gate card.
// Catches the failure modes of the 2026-10-27 refactor that merged the two
// inline-styled implementations (live + reload paths) into one shared builder:
//   - inline card styles creeping back into app.js (live/reload drift)
//   - markup classes in the builder with no matching rule in the stylesheet
//   - wiring classes (.safety-ack-cancel / .safety-ack-confirm) lost from markup
//   - touch-target regression below the 44px floor
// Run: node scripts/check-safety-card.js  (also registered in scripts/run-tests.js)
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

// 1. Shared builder exists and both paths use it.
check(
  "buildSafetyApprovalCard defined",
  /function buildSafetyApprovalCard\(/.test(appJs)
);
check(
  "live path uses shared builder",
  /function renderSafetyApproval[\s\S]{0,400}buildSafetyApprovalCard\(/.test(
    appJs
  )
);
check(
  "reload path uses shared builder",
  /function buildSafetyApprovalStatic[\s\S]{0,400}buildSafetyApprovalCard\(/.test(
    appJs
  )
);

// 2. No inline card styles left in app.js (the old drift source).
const inlineCardStyles =
  appJs.match(/safety-approval[\s\S]{0,200}style\.cssText/g) || [];
check(
  "no inline cssText on safety-approval cards",
  inlineCardStyles.length === 0,
  `found ${inlineCardStyles.length}`
);
const inlineDangerBg = (appJs.match(/rgba\(229,\s*72,\s*77/g) || []).length;
check(
  "danger-tinted card background only in stylesheet",
  inlineDangerBg === 0,
  `found ${inlineDangerBg} inline rgba(229,72,77 in app.js`
);

// 3. Every class the builder emits has a rule in the stylesheet.
const builderMatch = appJs.match(
  /function buildSafetyApprovalCard\([\s\S]*?return wrap;/
);
check("builder source extractable", !!builderMatch);
const builderSrc = builderMatch ? builderMatch[0] : "";
const emitted = new Set();
for (const m of builderSrc.matchAll(/class="([^"]+)"/g)) {
  for (const cls of m[1].split(/\s+/)) {
    if (cls && !cls.includes("${")) emitted.add(cls);
  }
}
// FontAwesome glyph class is vendored elsewhere; skip external icon classes.
const toCheck = [...emitted].filter(
  (c) => c === "safety-approval" || c.startsWith("safety-approval__") || c.startsWith("safety-ack-")
);
check("builder emits classes", toCheck.length >= 8, [...emitted].join(","));
for (const cls of toCheck) {
  if (cls.startsWith("safety-ack-")) {
    // wiring classes are JS hooks; must exist in markup (set above) but
    // styling is optional — presence in markup is what we verify
    continue;
  }
  check(
    `stylesheet defines .${cls}`,
    new RegExp(`\\.${cls.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}[\\s,{:.]`).test(css)
  );
}
check(
  "markup keeps .safety-ack-cancel hook",
  builderSrc.includes("safety-ack-cancel")
);
check(
  "markup keeps .safety-ack-confirm hook",
  builderSrc.includes("safety-ack-confirm")
);

// 4. Touch targets and a11y.
check(
  "44px touch target on gate buttons",
  /\.safety-approval__btn\s*{[\s\S]*?min-height:\s*44px/.test(css)
);
check(
  "focus-visible ring on gate buttons",
  /\.safety-approval__btn:focus-visible/.test(css)
);
check(
  "reduced-motion override covers the card",
  /prefers-reduced-motion:\s*reduce[\s\S]*?\.safety-approval\b/.test(css)
);

// 5. Stylesheet still parses coarsely (brace balance).
const open = (css.match(/{/g) || []).length;
const close = (css.match(/}/g) || []).length;
check("stylesheet braces balanced", open === close, `${open} vs ${close}`);

// 6. index.html loads the stylesheet that carries the card.
const indexHtml = fs.readFileSync(
  path.join(root, "public", "index.html"),
  "utf8"
);
check(
  "index.html links beui-components.css",
  indexHtml.includes("styles/beui-components.css")
);

if (failures) {
  console.error(`\n${failures} safety-card check(s) failed`);
  process.exit(1);
}
console.log("\nsafety-card checks passed");
