#!/usr/bin/env node
/**
 * Read-only corpus parity check.
 *
 * Prints a per-practice-area table comparing:
 *   - LOCAL     : provisions the repo's checked-in corpus can serve
 *   - FIRESTORE : provisions in the live legal_provisions collection
 *
 * Reports, never writes. Exit codes:
 *   0 — check ran (parity summary printed; mismatches are reported, not fatal)
 *   1 — local corpus failed to load, or an area is empty in BOTH stores
 *   2 — Firestore is not configured/reachable, so only the local side was checked
 */
const path = require("path");
process.env.LOCAL_LEGAL_CORPUS = process.env.LOCAL_LEGAL_CORPUS || "true";

const { PRACTICE_AREA_KEYS } = require(path.join(__dirname, "..", "server", "practiceAreas"));
const { getLocalCategory } = require(path.join(__dirname, "..", "server", "localLegalCorpus"));
const { getFirestore } = require(path.join(__dirname, "..", "server", "firebaseAdmin"));

(async () => {
  const localCounts = {};
  let localTotal = 0;
  for (const area of PRACTICE_AREA_KEYS) {
    let n = 0;
    try {
      const rows = getLocalCategory(area);
      n = Array.isArray(rows) ? rows.length : 0;
    } catch (err) {
      console.error(`[verify] Local corpus failed for "${area}":`, err.message);
      process.exitCode = 1;
    }
    localCounts[area] = n;
    localTotal += n;
  }

  const db = getFirestore();
  const fsCounts = {};
  let fsTotal = 0;
  let firestoreChecked = false;

  if (db) {
    try {
      for (const area of PRACTICE_AREA_KEYS) {
        const snap = await db.collection("legal_provisions").where("practice_area", "==", area).count().get();
        const n = snap.data().count;
        fsCounts[area] = n;
        fsTotal += n;
      }
      firestoreChecked = true;
    } catch (err) {
      console.error("[verify] Firestore count query failed:", err.message);
      process.exitCode = 2;
    }
  } else {
    console.warn("[verify] Firestore not configured — checking local corpus only.");
    process.exitCode = 2;
  }

  const pad = (s, n) => String(s).padEnd(n);
  console.log("\npractice_area".padEnd(28), pad("LOCAL", 8), pad("FIRESTORE", 10), "DELTA");
  console.log("-".repeat(52));
  for (const area of PRACTICE_AREA_KEYS) {
    const local = localCounts[area];
    const remote = firestoreChecked ? fsCounts[area] : "?";
    const delta = firestoreChecked ? fsCounts[area] - local : "?";
    console.log(pad(area, 28), pad(local, 8), pad(remote, 10), delta);
  }
  console.log("-".repeat(52));
  console.log(pad("TOTAL", 28), pad(localTotal, 8), pad(firestoreChecked ? fsTotal : "?", 10), firestoreChecked ? fsTotal - localTotal : "?");

  const emptyBoth = PRACTICE_AREA_KEYS.filter((a) => localCounts[a] === 0 && (!firestoreChecked || fsCounts[a] === 0));
  if (emptyBoth.length) {
    console.error(`\n[verify] EMPTY in both stores: ${emptyBoth.join(", ")}`);
    process.exitCode = 1;
  }

  if (firestoreChecked && fsTotal !== localTotal) {
    console.log(`\n[verify] Note: stores differ by ${Math.abs(fsTotal - localTotal)} provisions. ` +
      "Local corpus and Firestore are expected to drift (local is the eval/fallback copy); " +
      "investigate only areas where one side is zero.");
  }
})().catch((err) => {
  console.error("[verify] Fatal:", err.message);
  process.exit(1);
});
