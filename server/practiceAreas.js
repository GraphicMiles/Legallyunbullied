/**
 * Practice-area taxonomy shared by the classifier prompt (server/chatRoute.js),
 * the bulk ingestion pipeline (scripts/bulk-*.js), and anything else that needs
 * a canonical list of buckets legal_provisions are filed under.
 *
 * Expanded from the original 5-category MVP set once the corpus grew to cover
 * the ~550-Act PLAC "2004 Laws of Nigeria" federal compendium — a handful of
 * generic buckets can't retrieve precisely across that much subject-matter
 * breadth, so each category below is deliberately narrow and has a one-line
 * description the classifier prompt reuses verbatim.
 *
 * IMPORTANT: "tenancy", "employment", "criminal_rights", "contract", "general"
 * are the original 5 categories and already have real ingested data under
 * those exact string keys — do not rename them without a Firestore migration.
 */

const PRACTICE_AREAS = [
  {
    key: "tenancy",
    label: "Tenancy",
    description:
      "landlord/tenant disputes, rent, eviction, notice to quit (state tenancy laws, e.g. Lagos State)",
  },
  {
    key: "employment",
    label: "Employment",
    description: "firing, unpaid wages, workplace disputes (Labour Act / National Industrial Court)",
  },
  {
    key: "criminal_rights",
    label: "Criminal procedure & rights",
    description:
      "arrest, detention, bail, police conduct, criminal trial procedure (ACJA 2015 — procedure only, not definitions of specific crimes)",
  },
  {
    key: "criminal_offences",
    label: "Criminal offences",
    description:
      "definitions and penalties for specific crimes — theft, fraud, cybercrime, terrorism, money laundering, corruption, trafficking, firearms, drugs",
  },
  {
    key: "family_law",
    label: "Family law",
    description: "marriage, divorce, child custody, adoption, inheritance/succession, wills, child rights",
  },
  {
    key: "land_property",
    label: "Land & property",
    description:
      "land ownership, titles, registration, Certificate of Occupancy, compulsory acquisition (Land Use Act) — property beyond landlord/tenant renting",
  },
  {
    key: "contract",
    label: "Contracts & small claims",
    description: "civil debt/contract disputes, sale of goods, small claims court procedure",
  },
  {
    key: "company_business",
    label: "Company & business",
    description:
      "company registration, incorporation, directors' duties, partnerships, business names, insolvency/bankruptcy (CAMA and related)",
  },
  {
    key: "consumer_rights",
    label: "Consumer rights",
    description: "consumer protection, defective goods/services, unfair trade practices, competition",
  },
  {
    key: "constitutional_rights",
    label: "Constitutional & human rights",
    description:
      "fundamental rights and freedoms under the Constitution (life, liberty, expression, fair hearing, discrimination) and ratified human-rights treaties",
  },
  {
    key: "immigration_citizenship",
    label: "Immigration & citizenship",
    description: "visas, residency, deportation, citizenship, passports, cross-border travel",
  },
  {
    key: "tax_finance",
    label: "Tax & finance",
    description: "personal/company income tax, VAT, customs & excise, banking regulation, central bank rules",
  },
  {
    key: "intellectual_property",
    label: "Intellectual property",
    description: "copyright, trademarks, patents, industrial designs",
  },
  {
    key: "transport_traffic",
    label: "Transport & traffic",
    description: "road traffic offences and licensing, aviation, maritime/admiralty, rail, shipping",
  },
  {
    key: "education",
    label: "Education",
    description: "schools, universities, examinations, student/staff regulation in the education sector",
  },
  {
    key: "health",
    label: "Health",
    description: "medical practice regulation, hospitals, drugs and food safety (NAFDAC-type), public health",
  },
  {
    key: "employment_labour_safety",
    label: "Workplace safety & pensions",
    description: "occupational safety, workmen's compensation, pensions and social insurance (distinct from ordinary firing/wages disputes)",
  },
  {
    key: "environment",
    label: "Environment",
    description: "pollution control, environmental impact, natural resource protection",
  },
  {
    key: "government_administration",
    label: "Government & public administration",
    description:
      "establishment/powers of government agencies, parastatals, commissions, and public-service administration — not usually the direct subject of a personal legal question, kept for completeness",
  },
  {
    key: "general",
    label: "General",
    description:
      "anything that doesn't clearly and specifically match one of the above. Prefer this over force-fitting a loose match — an honest \"not covered yet\" beats a confident answer built on irrelevant sections.",
  },
];

const PRACTICE_AREA_KEYS = PRACTICE_AREAS.map((p) => p.key);

module.exports = { PRACTICE_AREAS, PRACTICE_AREA_KEYS };
