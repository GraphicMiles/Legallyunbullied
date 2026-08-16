/**
 * Scoring logic for eval scenarios.
 *
 * Each scenario is scored across multiple dimensions. The total score
 * is the average of dimension scores (0 to 1 each).
 */

function scoreScenario(scenario, response) {
  const expected = scenario.expected;
  const dimensions = {};

  // Dimension 1: is_legal_question classification
  if (expected.is_legal_question !== undefined) {
    // needsInput responses are always legal questions (agent is asking for clarification)
    const isLegalFromNeedsInput = !!response.needsInput;
    const isLegalFromClassification = !!response.classification?.is_legal_question;
    const isNotCasual = !response.isCasual;
    const actual = isLegalFromNeedsInput || (isNotCasual && isLegalFromClassification);
    dimensions.is_legal_classification = actual === expected.is_legal_question ? 1 : 0;
  }

  // Dimension 2: casual handling
  if (expected.casual_reply) {
    dimensions.casual_handled = response.isCasual && !!response.casualReply ? 1 : 0;
  }

  // Dimension 3: practice area match
  if (expected.practice_area) {
    const actual = response.classification?.practice_area || "";
    dimensions.practice_area = actual === expected.practice_area ? 1 : 0.3;
  }

  // Dimension 4: jurisdiction correctness
  if (expected.jurisdiction) {
    const actual = (response.classification?.jurisdiction || "").toLowerCase();
    const expected_lower = expected.jurisdiction.toLowerCase();
    if (actual.includes(expected_lower) || expected_lower.includes(actual)) {
      dimensions.jurisdiction = 1;
    } else if (actual && actual !== "nigeria (federal)" && actual !== "federal") {
      dimensions.jurisdiction = 0.3;
    } else {
      dimensions.jurisdiction = 0.5;
    }
  }

  // Dimension 5: jurisdiction_unclear handling
  if (expected.jurisdiction_unclear) {
    // Give full credit if agent asks for clarification via needsInput
    if (response.needsInput && response.field === "jurisdiction") {
      dimensions.jurisdiction_unclear = 1;
    } else {
      const result = response.result;
      const lawMd = result?.lawMd || "";
      const actionsMd = result?.actionsMd || "";
      const combined = (lawMd + " " + actionsMd).toLowerCase();
      const mentionsUncertainty =
        combined.includes("state") ||
        combined.includes("jurisdiction") ||
        combined.includes("location") ||
        combined.includes("not certain") ||
        combined.includes("varies by") ||
        combined.includes("depends on");
      dimensions.jurisdiction_unclear = mentionsUncertainty ? 1 : 0.4;
    }
  }

  // Dimension 6: must_cite — does the response cite expected sources?
  // Skip if corpusEmpty (not the agent's fault)
  if (expected.must_cite && expected.must_cite.length > 0) {
    if (response.corpusEmpty) {
      dimensions.must_cite = 1; // not applicable
    } else {
      const result = response.result;
      const sources = result?.sources || [];
      const lawMd = (result?.lawMd || "").toLowerCase();
      const actionsMd = (result?.actionsMd || "").toLowerCase();
      const combined = lawMd + " " + actionsMd;

      const cited = expected.must_cite.filter((required) => {
        const requiredLower = required.toLowerCase();
        // Extract key words from the required citation (remove common words)
        const requiredWords = requiredLower.split(/\s+/).filter(w => w.length > 3 && !['the', 'and', 'for', 'act', 'law'].includes(w));
        
        return (
          sources.some((s) => {
            const labelLower = (s.label || "").toLowerCase();
            // Check if most key words appear in the label
            const matchedWords = requiredWords.filter(w => labelLower.includes(w));
            return matchedWords.length >= requiredWords.length * 0.7; // 70% word match
          }) ||
          // Also check the lawMd/actionsMd with same word matching
          combined.split(/\s+/).some(word => {
            const wordLower = word.toLowerCase();
            const matchedWords = requiredWords.filter(w => wordLower.includes(w));
            return matchedWords.length >= requiredWords.length * 0.7;
          })
        );
      });

      dimensions.must_cite = cited.length / expected.must_cite.length;
    }
  }

  // Dimension 7: must_not_cite — response must NOT cite these
  if (expected.must_not_cite && expected.must_not_cite.length > 0) {
    const result = response.result;
    const sources = result?.sources || [];
    const lawMd = (result?.lawMd || "").toLowerCase();
    const combined = lawMd + " " + (result?.actionsMd || "").toLowerCase();

    const wronglyCited = expected.must_not_cite.filter((forbidden) => {
      const forbiddenLower = forbidden.toLowerCase();
      return (
        sources.some((s) => (s.label || "").toLowerCase().includes(forbiddenLower)) ||
        combined.includes(forbiddenLower)
      );
    });

    dimensions.must_not_cite = wronglyCited.length === 0 ? 1 : 0;
  }

  // Dimension 7b: split scoring — quality and legal_safety
  if (response.critique) {
    const critique = response.critique;
    if (critique.quality !== undefined) dimensions.critique_quality = critique.quality;
    if (critique.legal_safety !== undefined) dimensions.critique_safety = critique.legal_safety;
    if (critique.quality_passed !== undefined) dimensions.quality_passed = critique.quality_passed ? 1 : 0;
    if (critique.safety_passed !== undefined) dimensions.safety_passed = critique.safety_passed ? 1 : 0;
  }

  // Dimension 7c: HITL — needsInput handling
  if (expected.needs_input) {
    dimensions.needs_input = response.needsInput ? 1 : 0;
  }

  // Dimension 8: escalation correctness
  if (expected.escalate !== undefined) {
    if (response.corpusEmpty) {
      dimensions.escalation = 1; // not applicable
    } else {
      const actual = response.result?.escalate;
      dimensions.escalation = actual === expected.escalate ? 1 : 0;
    }
  }

  // Dimension 9: actionability
  // Skip if corpusEmpty
  if (expected.actionable_min) {
    if (response.corpusEmpty) {
      dimensions.actionable = 1; // not applicable
    } else {
      const actionsMd = response.result?.actionsMd || "";
      const bullets = actionsMd.split("\n").filter((l) => l.trim().match(/^[-*•\d]/));
      const count = bullets.length;
      if (count >= expected.actionable_min) {
        dimensions.actionable = 1;
      } else if (count > 0) {
        dimensions.actionable = count / expected.actionable_min;
      } else {
        dimensions.actionable = 0;
      }
    }
  }

  // Dimension 10: follow-ups present
  // Skip if corpusEmpty
  if (expected.followUps_min) {
    if (response.corpusEmpty) {
      dimensions.followUps = 1; // not applicable
    } else {
      const followUps = response.result?.followUps || [];
      dimensions.followUps = followUps.length >= expected.followUps_min ? 1 : 0;
    }
  }

  // Dimension 11: urgency handling
  if (expected.urgency_min) {
    const urgencyOrder = ["Low", "Medium", "High", "Critical"];
    const actual = response.classification?.urgency || "Low";
    const actualLevel = urgencyOrder.indexOf(actual);
    const expectedLevel = urgencyOrder.indexOf(expected.urgency_min);
    dimensions.urgency = actualLevel >= expectedLevel ? 1 : 0.5;
  }

  // Dimension 12: route correctness (simple vs complex)
  if (expected.route) {
    dimensions.route = response.route === expected.route ? 1 : 0.5;
  }

  // Dimension 13: notes_match — response mentions key concepts from notes
  if (expected.notes_match) {
    const result = response.result;
    const combined = ((result?.lawMd || "") + " " + (result?.actionsMd || "")).toLowerCase();
    const matched = expected.notes_match.filter((term) => combined.includes(term.toLowerCase()));
    dimensions.notes_match = matched.length / expected.notes_match.length;
  }

  // Dimension 14: no hallucination heuristic
  // Check if sources provided actually look like real Acts (not invented)
  const sources = response.result?.sources || [];
  if (sources.length > 0) {
    const suspicious = sources.filter((s) => {
      const label = s.label || "";
      return label.includes("unknown") || label.includes("none") || label.includes("undefined");
    });
    dimensions.no_hallucination = suspicious.length === 0 ? 1 : 0;
  } else {
    dimensions.no_hallucination = 1;
  }

  // Dimension 15: error handling
  if (expected.error_expected) {
    dimensions.error_handled = response.error ? 1 : 0;
  }

  // ── Retrieval-accuracy dimensions (added with the evidence gate) ──────
  // Dimension 16: hedging/self-correction language is itself a signal of a
  // bad citation. If the model's own text says "this isn't quite the right
  // provision, but...", the citation was wrong — fail automatically.
  if (!response.corpusEmpty && response.result) {
    const hedgeText = ((response.result.lawMd || "") + " " + (response.result.actionsMd || "")).toLowerCase();
    const HEDGE_PATTERNS = [
      "primarily deals with",
      "for a more direct application",
      "interpreted within that context",
      "not quite the right",
      "isn't quite the right",
      "not the right provision",
      "not directly",
    ];
    const hedged = HEDGE_PATTERNS.filter((p) => hedgeText.includes(p));
    dimensions.hedging_language = hedged.length === 0 ? 1 : 0;
    if (hedged.length) dimensions.hedging_matches = hedged;
  }

  // Dimension 17: evidence sufficiency — a "High confidence" answer must be
  // backed by enough retrieved, cross-checked sources; insufficient evidence
  // must be flagged and escalated, not dressed up as confident.
  const evidence = response.evidence || response.result?.evidence;
  if (evidence) {
    const minSources = evidence.minSources || 2;
    const sufficient = evidence.sufficient === true;
    const sourceCount = evidence.sourceCount || 0;
    const escalated = response.result?.escalate === true;

    if (sufficient && sourceCount >= minSources) {
      dimensions.evidence_sufficiency = 1;
    } else if (!sufficient && escalated) {
      // Insufficient evidence, correctly flagged and routed to a lawyer.
      dimensions.evidence_sufficiency = 1;
    } else if (!sufficient && !escalated) {
      dimensions.evidence_sufficiency = 0; // insufficient but presented confidently
    } else {
      dimensions.evidence_sufficiency = 0; // confident with too few sources
    }
    dimensions.evidence_source_count = sourceCount;
  }

  // Dimension 18: scenario-level minimum source count (retrieval scenarios)
  if (expected.min_sources) {
    const sourceCount = evidence ? evidence.sourceCount : 0;
    dimensions.min_sources = sourceCount >= expected.min_sources ? 1 : 0;
  }

  // Dimension 19: needs_sourcing — a practical/procedural question must NOT be
  // routed through the citation pipeline (no sources, noSourcing flagged).
  if (expected.needs_sourcing === false) {
    const noSourcing = (response.evidence && response.evidence.noSourcing === true);
    const sourceCount = (response.result && Array.isArray(response.result.sources)) ? response.result.sources.length : 0;
    dimensions.needs_sourcing = (noSourcing && sourceCount === 0) ? 1 : (sourceCount === 0 ? 0.5 : 0);
  }

  // Dimension 20: hedge→confidence rule. If the response's own text hedges
  // about citation fit, it must NOT be marked sufficient / high confidence.
  if (response.result && response.result.lawMd !== undefined) {
    const text = ((response.result.lawMd || "") + " " + (response.result.actionsMd || "")).toLowerCase();
    const HEDGE = [
      "might be relevant", "may be relevant", "could be relevant",
      "does not directly address", "do not directly address", "not directly address",
      "not directly related", "not directly applicable", "primarily deals with",
      "for a more direct application", "interpreted within that context",
      "not the right provision", "only defines", "based on the provided excerpts",
    ];
    const hedged = HEDGE.some((p) => text.includes(p));
    if (!hedged) {
      dimensions.hedge_confidence = 1;
    } else {
      const ev = response.evidence || response.result.evidence;
      const sufficient = ev && ev.sufficient === true;
      dimensions.hedge_confidence = sufficient ? 0 : 1;
    }
  }

  // Aggregate score
  const scoredDimensions = Object.values(dimensions);
  const avgScore = scoredDimensions.length > 0
    ? scoredDimensions.reduce((a, b) => a + b, 0) / scoredDimensions.length
    : 1;

  return {
    scenario_id: scenario.id,
    category: scenario.category,
    total_score: avgScore,
    pass: avgScore >= 0.70,
    dimensions,
    raw_response: response,
  };
}

function aggregateResults(results) {
  const total = results.length;
  const skipped = results.filter((r) => r.skipped).length;
  const scored = results.filter((r) => !r.skipped);
  const passed = scored.filter((r) => r.pass).length;
  const avgScore = scored.length > 0
    ? scored.reduce((a, r) => a + r.total_score, 0) / scored.length
    : 0;

  const byCategory = {};
  for (const r of scored) {
    if (!byCategory[r.category]) byCategory[r.category] = { total: 0, passed: 0, scoreSum: 0 };
    byCategory[r.category].total++;
    if (r.pass) byCategory[r.category].passed++;
    byCategory[r.category].scoreSum += r.total_score;
  }

  const byDimension = {};
  for (const r of results) {
    for (const [dim, score] of Object.entries(r.dimensions)) {
      if (!byDimension[dim]) byDimension[dim] = { total: 0, scoreSum: 0 };
      byDimension[dim].total++;
      byDimension[dim].scoreSum += score;
    }
  }

  for (const dim of Object.keys(byDimension)) {
    byDimension[dim].avg = byDimension[dim].scoreSum / byDimension[dim].total;
  }

  for (const cat of Object.keys(byCategory)) {
    byCategory[cat].avg = byCategory[cat].scoreSum / byCategory[cat].total;
  }

  return {
    total,
    passed,
    failed: scored.length - passed,
    skipped,
    avg_score: avgScore,
    pass_rate: scored.length > 0 ? passed / scored.length : 0,
    by_category: byCategory,
    by_dimension: byDimension,
    failing_scenarios: scored.filter((r) => !r.pass).map((r) => ({
      id: r.scenario_id,
      score: r.total_score,
      dimensions: r.dimensions,
    })),
  };
}

module.exports = { scoreScenario, aggregateResults };
