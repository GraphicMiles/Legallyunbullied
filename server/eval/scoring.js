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
    const actual = !response.isCasual && !!response.classification?.is_legal_question;
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
    const result = response.result;
    const lawMd = result?.lawMd || "";
    const actionsMd = result?.actionsMd || "";
    const combined = (lawMd + " " + actionsMd).toLowerCase();
    const notes = (scenario.notes || "").toLowerCase();
    const mentionsUncertainty =
      combined.includes("state") ||
      combined.includes("jurisdiction") ||
      combined.includes("location") ||
      combined.includes("not certain") ||
      combined.includes("varies by") ||
      combined.includes("depends on");
    dimensions.jurisdiction_unclear = mentionsUncertainty ? 1 : 0.4;
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
        return (
          sources.some((s) => (s.label || "").toLowerCase().includes(requiredLower)) ||
          combined.includes(requiredLower)
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
