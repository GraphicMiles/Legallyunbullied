const HIGH_RISK_AREAS = new Set([
  "criminal_rights",
  "criminal_offences",
  "immigration_citizenship",
  "constitutional_rights",
  "family_law",
]);

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function provisionId(p) {
  return String(p?.provisionId || p?.id || "").trim();
}

function requiredSourceCount(classification) {
  const area = String(classification?.practice_area || "").toLowerCase();
  if (HIGH_RISK_AREAS.has(area)) return 2;
  const route = classification?.route || (classification?.complexity === "Low" ? "simple" : "complex");
  return route === "simple" ? 1 : 2;
}

function officialLabel(p) {
  return `${p.act || "Unknown Act"}${p.section ? `, s.${p.section}` : ""}`;
}

function buildLookup(provisions) {
  const byId = new Map();
  const byLegacyLabel = new Map();
  for (const p of provisions || []) {
    const id = provisionId(p);
    if (!id) continue;
    byId.set(id, p);
    const labels = [
      officialLabel(p),
      `${p.act || ""} section ${p.section || ""}`,
      `section ${p.section || ""} of ${p.act || ""}`,
    ];
    for (const label of labels) byLegacyLabel.set(normalize(label), id);
  }
  return { byId, byLegacyLabel };
}

function resolveLegacyLabel(label, lookup) {
  const normalized = normalize(label);
  if (!normalized) return null;
  if (lookup.byLegacyLabel.has(normalized)) return lookup.byLegacyLabel.get(normalized);

  // Backward-compatible exact authority matching for V1 model output. Both the
  // Act name and section must match; loose fuzzy labels are never accepted.
  for (const [id, p] of lookup.byId.entries()) {
    const act = normalize(p.act);
    const section = normalize(p.section);
    if (act && section && normalized.includes(act) && normalized.includes(section)) return id;
  }
  return null;
}

function collectRequestedIds(result, lookup) {
  const requested = [];
  const unknown = [];
  const add = (id) => {
    id = String(id || "").trim();
    if (!id) return;
    if (lookup.byId.has(id)) requested.push(id);
    else unknown.push(id);
  };

  for (const id of result?.provisionIds || []) add(id);
  for (const claim of result?.claims || []) {
    for (const id of claim?.provisionIds || []) add(id);
  }
  for (const source of result?.sources || []) {
    const direct = source?.provisionId || source?.id;
    if (direct) add(direct);
    else {
      const resolved = resolveLegacyLabel(source?.label, lookup);
      if (resolved) requested.push(resolved);
      else if (source?.label) unknown.push(`label:${source.label}`);
    }
  }

  return {
    valid: Array.from(new Set(requested)),
    unknown: Array.from(new Set(unknown)),
  };
}

function resolveCitationTokens(text, lookup, used, unknown) {
  return String(text || "").replace(/\[\[([^\]]+)\]\]/g, (_, rawId) => {
    const id = String(rawId || "").trim();
    const p = lookup.byId.get(id);
    if (!p) {
      unknown.push(id);
      return "[unsupported citation removed]";
    }
    used.add(id);
    return `**${officialLabel(p)}**`;
  });
}

/**
 * Enforce citation integrity at the server boundary.
 *
 * The model may select provision IDs, but it never controls displayed labels,
 * excerpts, URLs, or source metadata. Those are resolved from retrieved records.
 */
function verifyAndResolveCitations(result, provisions) {
  if (!result) return {
    valid: false,
    reason: "Draft result missing.",
    unknownIds: [],
    verifiedIds: [],
  };

  const lookup = buildLookup(provisions);
  const requested = collectRequestedIds(result, lookup);
  const used = new Set(requested.valid);
  const tokenUnknown = [];

  result.lawMd = resolveCitationTokens(result.lawMd, lookup, used, tokenUnknown);
  result.actionsMd = resolveCitationTokens(result.actionsMd, lookup, used, tokenUnknown);

  const unknownIds = Array.from(new Set([...requested.unknown, ...tokenUnknown]));
  const verifiedIds = [...used].filter((id) => lookup.byId.has(id));

  // Claims retain provenance and receive a deterministic linkage result. This
  // proves that their cited evidence was retrieved; semantic support remains a
  // separate safety/relevance decision and is never inferred from ID existence.
  if (Array.isArray(result.claims)) {
    result.claims = result.claims.map((claim, index) => {
      const ids = Array.from(new Set((claim?.provisionIds || []).map(String)));
      const bad = ids.filter((id) => !lookup.byId.has(id));
      return {
        claimId: String(claim?.claimId || `claim-${index + 1}`),
        text: String(claim?.text || ""),
        provisionIds: ids.filter((id) => lookup.byId.has(id)),
        evidenceLink: bad.length || !ids.length ? "unsupported" : "retrieved",
      };
    });
  }

  result.provisionIds = verifiedIds;
  result.sources = verifiedIds.map((id) => {
    const p = lookup.byId.get(id);
    return {
      provisionId: id,
      label: officialLabel(p),
      excerpt: String(p.text || "").slice(0, 400),
      jurisdiction: p.jurisdiction || null,
      sourceUrl: p.source_url || p.sourceUrl || null,
      sourceVersion: p.source_version || p.sourceVersion || null,
    };
  });

  const unsupportedClaims = (result.claims || []).filter((c) => c.evidenceLink !== "retrieved");
  const valid = verifiedIds.length > 0 && unknownIds.length === 0 && unsupportedClaims.length === 0;
  const verification = {
    valid,
    verifiedIds,
    unknownIds,
    unsupportedClaimIds: unsupportedClaims.map((c) => c.claimId),
    reason: valid
      ? "Every displayed citation resolves to evidence retrieved for this run."
      : unknownIds.length
        ? "The draft referenced evidence that was not retrieved for this run."
        : unsupportedClaims.length
          ? "One or more claims did not reference retrieved evidence."
          : "The draft did not reference any retrieved provision.",
  };
  result.citationVerification = verification;
  return verification;
}

module.exports = {
  requiredSourceCount,
  verifyAndResolveCitations,
  officialLabel,
  provisionId,
};
