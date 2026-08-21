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

function validateDraftResult(result) {
  const errors = [];
  if (!result || typeof result !== "object" || Array.isArray(result)) return { valid: false, errors: ["draft_not_object"] };
  if (typeof result.lawMd !== "string" || !result.lawMd.trim()) errors.push("lawMd_required");
  if (typeof result.actionsMd !== "string" || !result.actionsMd.trim()) errors.push("actionsMd_required");
  if (typeof result.escalate !== "boolean") errors.push("escalate_boolean_required");
  if (typeof result.escalateReason !== "string") errors.push("escalateReason_required");
  if (!Array.isArray(result.followUps)) errors.push("followUps_array_required");
  if (!Array.isArray(result.provisionIds) || result.provisionIds.length === 0) errors.push("provisionIds_required");
  if (!Array.isArray(result.claims) || result.claims.length === 0) errors.push("claims_required");
  else {
    result.claims.forEach((claim, index) => {
      if (!claim || typeof claim.text !== "string" || !claim.text.trim()) errors.push(`claim_${index + 1}_text_required`);
      if (!Array.isArray(claim?.provisionIds) || claim.provisionIds.length === 0) errors.push(`claim_${index + 1}_provisionIds_required`);
    });
  }
  return { valid: errors.length === 0, errors };
}

function buildLookup(provisions) {
  const byId = new Map();
  for (const p of provisions || []) {
    const id = provisionId(p);
    if (id) byId.set(id, p);
  }
  return { byId };
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
  for (const claim of result?.claims || []) for (const id of claim?.provisionIds || []) add(id);

  // The model never controls public source labels, excerpts, or URLs. A source
  // object is accepted only when it carries a retrieved provision ID.
  for (const source of result?.sources || []) {
    const direct = source?.provisionId || source?.id;
    if (direct) add(direct);
    else if (source?.label || source?.url || source?.sourceUrl) unknown.push("untrusted_model_source");
  }

  return { valid: [...new Set(requested)], unknown: [...new Set(unknown)] };
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

function findUnverifiedInlineCitations(result, lookup) {
  const raw = `${result?.lawMd || ""}\n${result?.actionsMd || ""}`.replace(/\[\[[^\]]+\]\]/g, "");
  const allowedActs = [...lookup.byId.values()].map((p) => normalize(p.act)).filter(Boolean);
  const allowedSections = new Set([...lookup.byId.values()].map((p) => normalize(p.section)).filter(Boolean));
  const unknown = [];

  const actPattern = /\b([A-Z][A-Za-z0-9()'’&., -]{2,100}?\s(?:Act|Law|Constitution)(?:\s+\d{4})?)\b/g;
  for (const match of raw.matchAll(actPattern)) {
    const candidate = normalize(match[1]);
    if (!allowedActs.some((act) => act === candidate || act.includes(candidate) || candidate.includes(act))) {
      unknown.push(`act:${match[1].trim()}`);
    }
  }

  // Accept an optional letter suffix ("section 25A" — common in Nigerian
  // statutes) plus parenthesised subsection levels. A citation matches when it
  // is equal to a retrieved section OR differs only by subsection granularity
  // ("s. 25" vs retrieved "25(1)(a)", and vice versa) — the retrieved
  // provision's text contains those subsections, so citing a finer/coarser
  // level of the SAME numbered section is still grounded. A different number
  // never matches.
  const sectionPattern = /\b(?:sections?|s\.)\s*(\d+[A-Za-z]?(?:\s*\([a-z0-9]+\))*)/gi;
  const sectionGrounded = (candidate) => {
    if (allowedSections.has(candidate)) return true;
    for (const allowed of allowedSections) {
      if (allowed.startsWith(candidate + " ") || candidate.startsWith(allowed + " ")) return true;
    }
    return false;
  };
  for (const match of raw.matchAll(sectionPattern)) {
    const candidate = normalize(match[1]);
    if (!sectionGrounded(candidate)) unknown.push(`section:${match[1].trim()}`);
  }
  return [...new Set(unknown)];
}

/** Resolve citations exclusively from evidence retrieved for this run. */
function verifyAndResolveCitations(result, provisions) {
  if (!result) return { valid: false, reason: "Draft result missing.", unknownIds: [], verifiedIds: [] };

  const schema = validateDraftResult(result);
  const lookup = buildLookup(provisions);
  const requested = collectRequestedIds(result, lookup);
  const used = new Set(requested.valid);
  const tokenUnknown = [];
  const inlineUnknown = findUnverifiedInlineCitations(result, lookup);

  result.lawMd = resolveCitationTokens(result.lawMd, lookup, used, tokenUnknown);
  result.actionsMd = resolveCitationTokens(result.actionsMd, lookup, used, tokenUnknown);

  const unknownIds = [...new Set([...requested.unknown, ...tokenUnknown])];
  const verifiedIds = [...used].filter((id) => lookup.byId.has(id));

  result.claims = Array.isArray(result.claims) ? result.claims.map((claim, index) => {
    const ids = [...new Set((claim?.provisionIds || []).map(String))];
    const bad = ids.filter((id) => !lookup.byId.has(id));
    return {
      claimId: String(claim?.claimId || `claim-${index + 1}`),
      text: String(claim?.text || ""),
      provisionIds: ids.filter((id) => lookup.byId.has(id)),
      evidenceLink: bad.length || !ids.length ? "unsupported" : "retrieved",
    };
  }) : [];

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
      sourceStatus: p.source_status || p.sourceStatus || null,
      reviewed: p.reviewed === true,
    };
  });

  const unsupportedClaims = result.claims.filter((claim) => claim.evidenceLink !== "retrieved");
  const valid = schema.valid && verifiedIds.length > 0 && unknownIds.length === 0 && inlineUnknown.length === 0 && unsupportedClaims.length === 0;
  const verification = {
    valid,
    schemaErrors: schema.errors,
    verifiedIds,
    unknownIds,
    unverifiedInlineCitations: inlineUnknown,
    unsupportedClaimIds: unsupportedClaims.map((claim) => claim.claimId),
    reason: valid
      ? "Every citation and claim reference resolves to evidence retrieved for this run."
      : !schema.valid ? `Draft schema invalid: ${schema.errors.join(", ")}`
        : inlineUnknown.length ? "The draft contained Act/section citations outside verified citation tokens."
          : unknownIds.length ? "The draft referenced evidence that was not retrieved for this run."
            : unsupportedClaims.length ? "One or more claims did not reference retrieved evidence."
              : "The draft did not reference any retrieved provision.",
  };
  result.citationVerification = verification;
  return verification;
}

module.exports = {
  requiredSourceCount,
  validateDraftResult,
  verifyAndResolveCitations,
  officialLabel,
  provisionId,
  findUnverifiedInlineCitations,
};
