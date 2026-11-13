/**
 * Deterministic ordering of candidate provisions, the way a careful lawyer
 * would sort them before reading:
 *
 *   1. Drop law from another state when the user's state is known.
 *   2. Drop provisions marked repealed (none are marked today; the field is read so it works once data exists).
 *   3. Order by level: Constitution, then Federal Act or the user's own state's law, then regulations.
 *   4. Within a level, the provision for the user's practice area comes first (specific over general).
 *   5. Ties keep their original relevance order.
 *
 * This is a DEFAULT. It does not resolve real conflicts between laws; the
 * answer prompt asks the model to say which rule prevails only from the excerpts,
 * and legal review is needed before this ordering is treated as settled law.
 */

const STATE_NAME = /\b(lagos|ogun|oyo|kano|rivers|abuja|fct|kaduna|delta|edo|enugu|anambra|imo|abia|akwa ibom|cross river|bayelsa|benue|plateau|niger|kwara|kogi|ekiti|osun|ondo|jigawa|katsina|kebbi|sokoto|zamfara|bauchi|gombe|adamawa|taraba|yobe|borno|nasarawa|kebbi|ebonyi)\b/i;

function stateOf(text) {
  const m = String(text || "").match(STATE_NAME);
  return m ? m[1].toLowerCase() : null;
}

/** Level of a provision: 0 constitution, 1 act (federal or the user's state), 2 regulation, 3 other. */
function levelOf(p, userState) {
  const act = String(p.act || "");
  if (/constitution/i.test(act)) return 0;
  const isRegulation = /\b(regulation|regulations|guidelines?|directive|rules?)\b/i.test(act);
  const jur = String(p.jurisdiction || "");
  const provinceState = stateOf(jur);
  if (isRegulation) return 2;
  if (!provinceState || jur === "Federal") return 1; // federal act
  if (userState && provinceState === userState) return 1; // the user's own state's law
  return 3;
}

/**
 * provisions: candidate rows (as returned by findProvisions / legalIndex).
 * classification: { jurisdiction, jurisdiction_status, practice_area }.
 * Returns { provisions, summary, dropped }.
 */
function rankForPrecedence(provisions, classification = {}) {
  const list = Array.isArray(provisions) ? provisions : [];
  const userState = classification.jurisdiction_status === "clear" ? stateOf(classification.jurisdiction) : null;
  const area = String(classification.practice_area || "");
  const dropped = [];
  const kept = [];

  for (const p of list) {
    if (String(p.in_force_status || p.status || "").toLowerCase() === "repealed") {
      dropped.push({ id: p.id || p.provisionId, reason: "repealed" });
      continue;
    }
    const provinceState = stateOf(p.jurisdiction);
    if (userState && provinceState && provinceState !== userState) {
      dropped.push({ id: p.id || p.provisionId, reason: "other state's law" });
      continue;
    }
    kept.push(p);
  }

  const indexed = kept.map((p, i) => ({
    p,
    i,
    level: levelOf(p, userState),
    specific: p.practice_area === area ? 0 : 1,
  }));
  indexed.sort((x, y) => x.level - y.level || x.specific - y.specific || x.i - y.i);
  const ordered = indexed.map((x) => x.p);

  return {
    provisions: ordered,
    dropped,
    summary: {
      applied: true,
      candidates: list.length,
      kept: ordered.length,
      droppedCount: dropped.length,
      droppedReasons: [...new Set(dropped.map((d) => d.reason))],
      topActs: [...new Set(ordered.slice(0, 3).map((p) => p.act))],
    },
  };
}

module.exports = { rankForPrecedence, levelOf, stateOf };
