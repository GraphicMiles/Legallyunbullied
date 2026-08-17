/**
 * Read-only local corpus adapter for evaluation when Firestore quota is
 * unavailable. Production never enables this unless LOCAL_LEGAL_CORPUS=true.
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.join(__dirname, "..");
let byArea = null;

function splitSections(text) {
  const sections = [];
  let current = null;
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trimEnd();
    const match = line.trim().match(/^(?:section\s+)?(\d{1,4})[.．](?:\s|—|-)/i);
    if (match) {
      if (current && current.lines.join("\n").trim().length > 20) {
        sections.push({ section: current.section, text: current.lines.join("\n").trim() });
      }
      current = { section: match[1], lines: [line.trim()] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current && current.lines.join("\n").trim().length > 20) {
    sections.push({ section: current.section, text: current.lines.join("\n").trim() });
  }
  return sections;
}

function addFile(store, { file, act, practiceArea, jurisdiction = "Federal", sourceUrl = null }) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  for (const [index, section] of splitSections(text).entries()) {
    const seed = `${act}|${section.section}|${index}`;
    const id = `local-${crypto.createHash("sha1").update(seed).digest("hex").slice(0, 20)}`;
    const row = {
      id,
      provisionId: id,
      act,
      section: section.section,
      text: section.text,
      practice_area: practiceArea,
      jurisdiction,
      source_url: sourceUrl,
      local_eval: true,
    };
    if (!store.has(practiceArea)) store.set(practiceArea, []);
    store.get(practiceArea).push(row);
  }
}

function load() {
  if (byArea) return byArea;
  const store = new Map();
  const manifestPath = path.join(ROOT, "legal_sources", "manifest", "staged.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  for (const item of manifest) {
    const file = path.join(ROOT, "legal_sources", "federal_acts_bulk", "cleaned", `${item.slug}.txt`);
    addFile(store, {
      file,
      act: item.act || item.name,
      practiceArea: item.practice_area || "general",
      sourceUrl: item.sourceUrl || null,
    });
  }

  const extras = [
    ["constitution/1999-constitution-updated-5th-alteration-cleaned.txt", "Constitution of the Federal Republic of Nigeria 1999", "constitutional_rights", "Federal"],
    ["federal_acts/acja-2015-cleaned.txt", "Administration of Criminal Justice Act 2015", "criminal_rights", "Federal"],
    ["federal_acts/cybercrimes-act-2015-cleaned.txt", "Cybercrimes (Prohibition, Prevention, etc.) Act 2015", "criminal_offences", "Federal"],
    ["federal_acts_bulk/criminal-code-act.txt", "Criminal Code Act", "criminal_offences", "Federal"],
    ["federal_acts_bulk/advance-fee-fraud-and-other-fraud-related-offences-act.txt", "Advance Fee Fraud and Other Fraud Related Offences Act", "criminal_offences", "Federal"],
    ["federal_acts/labour-act-cap-l1-lfn-2004-cleaned.txt", "Labour Act", "employment", "Federal"],
    ["federal_acts/fccpa-2018-cleaned.txt", "Federal Competition and Consumer Protection Act 2018", "consumer_rights", "Federal"],
    ["federal_acts/vapp-2015-cleaned.txt", "Violence Against Persons (Prohibition) Act 2015", "criminal_rights", "Federal"],
    ["federal_acts/recovery-of-premises-act-cleaned.txt", "Recovery of Premises Act", "tenancy", "Federal"],
    ["federal_acts/nigerian-childs-right-act-2003-cleaned.txt", "Child Rights Act 2003", "family_law", "Federal"],
    ["federal_acts/sale-of-goods-act-1893-cleaned.txt", "Sale of Goods Act 1893", "contract", "Federal"],
    ["federal_acts/wills-act-1837-cleaned.txt", "Wills Act 1837", "family_law", "Federal"],
    ["state_laws/lagos-tenancy-law-2011-cleaned.txt", "Lagos State Tenancy Law 2011", "tenancy", "Lagos State"],
    ["state_laws/lagos-small-claims-practice-direction-cleaned.txt", "Lagos State Small Claims Court Practice Direction 2023", "contract", "Lagos State"],
  ];
  for (const [rel, act, practiceArea, jurisdiction] of extras) {
    addFile(store, { file: path.join(ROOT, "legal_sources", rel), act, practiceArea, jurisdiction });
  }
  byArea = store;
  console.log(`[local-corpus] Loaded ${[...store.values()].reduce((n, rows) => n + rows.length, 0)} provisions across ${store.size} practice areas`);
  return store;
}

function getLocalCategory(practiceArea) {
  return [...(load().get(practiceArea) || [])];
}

module.exports = { getLocalCategory, splitSections };
