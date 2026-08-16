# Legal Corpus — Ingestion Status

> Last updated: 2026-08-16

## Current State

| Metric | Value |
|---|---|
| Total acts in PLAC 2004 compendium | 547 |
| Ingested to Firestore | **545** (bulk) + 3 gap laws + 4 more coverage laws |
| Remaining in staging queue | **2** (low-relevance, optional) |
| Estimated total sections in Firestore | **14,384** (verified via count()) |
| Practice areas covered | 19/19 |

The bulk ingestion is essentially complete. Only 2 low-relevance acts remain un-ingested:

| Act | Practice Area | Reason |
|---|---|---|
| Treaty To Establish the African Union (Ratification and Enforcement) Act | general | Low relevance — international treaty ratification |
| World Meteorological Organisation (Protection) Act | general | Low relevance — specialised international org |

Neither is relevant to any eval scenario or typical user question. They can be ingested for completeness with:

```bash
node scripts/bulk-ingest-firestore.js
```

## Breakdown by Practice Area (Ingested)

| Practice Area | Acts Ingested |
|---|---|
| general | 186 |
| tax_finance | 71 |
| education | 47 |
| health | 37 |
| transport_traffic | 36 |
| land_property | 23 |
| company_business | 23 |
| government_administration | 22 |
| criminal_offences | 19 |
| environment | 14 |
| criminal_rights | 12 |
| employment | 10 |
| employment_labour_safety | 9 |
| family_law | 9 |
| immigration_citizenship | 7 |
| contract | 6 |
| intellectual_property | 6 |
| constitutional_rights | 5 |
| consumer_rights | 3 |
| **Total** | **545** |

## Laws Not in the PLAC Compendium (Gaps)

The PLAC "2004 Laws of Nigeria" compendium covers federal Acts. Several important laws are **not** in it and need separate sourcing:

### Critical Gaps (referenced by eval scenarios)

| Law | Practice Area | Why Needed | Status |
|---|---|---|---|
| **Lagos State Tenancy Law 2011** | tenancy | Primary law for Lagos eviction/rent questions — the most common tenancy scenario | ✅ Already hand-ingested (658 sections across 5 flagship Acts) |
| **Recovery of Premises Act** | tenancy | Governs eviction in Abuja/FCT (not covered by Lagos law) | ✅ Ingested 2026-08-16 (31 sections as "Recovery of Premises Law" — the uniform Recovery of Premises law text, substantively identical to the federal Act applicable in the FCT) |
| **Violence Against Persons (Prohibition) Act 2015 (VAPP)** | criminal_rights | Domestic violence, sexual assault scenarios | ✅ Ingested 2026-08-16 (48 sections, clean text from LawGlobal Hub) |
| **Federal Competition and Consumer Protection Act (FCCPA) 2018** | consumer_rights | Defective goods, unfair trade practices | ✅ Ingested 2026-08-16 (168 sections, clean text from LawGlobal Hub) |

> **Note on Recovery of Premises:** the freely available full-text copy of this uniform law is the Kogi State–issued edition (`KGSL 1 of 1991`), whose notice-to-quit provisions (weekly/monthly/quarterly/yearly periods and the 7-day notice of intention to recover possession) are identical to the federal 1945 Act that applies in the FCT. It is ingested under the name **"Recovery of Premises Law"** with jurisdiction **Federal** so Abuja/FCT tenancy questions retrieve it; if the verbatim federal Act text becomes available, it can be ingested alongside.

### Additional Coverage Laws (2026-08-16, for diverse user questions)

| Law | Practice Area | Sections | Covers |
|---|---|---|---|
| **Wills Act 1837** | family_law | 33 | Testate succession ("someone died — what happens to their property under a will") |
| **Child Rights Act 2003** | family_law | 278 | Child custody, best-interest principle, child protection (replaces the truncated 99-section compendium copy) |
| **Sale of Goods Act 1893** | contract | 53 | Buying/selling goods, defective goods, seller/buyer remedies |
| **Trade Marks Act** (kept existing) | intellectual_property | 69 | Brand/logo protection ("someone stole my brand") |

Source for all: LawGlobal Hub per-section text (clean; the site is missing a few sections — Wills s.2/s.12 and Sale of Goods s.4/s.40–48 — disclosed as a source limitation, the substantive core is present).

> **Honest limitation:** intestate succession (dying *without* a will) and most torts (negligence, defamation damages) are governed by **state law / common law**, not federal statute — those remain out of the corpus's reach and are handled by the "insufficient evidence → consult a lawyer" path.

### Minor Gaps (may already be in corpus under different names)

| Law | Practice Area | Notes |
|---|---|---|
| Companies and Allied Matters Act (CAMA) 2020 | company_business | Likely in corpus as "Companies and Allied Matters Act" — verify name match |
| Personal Income Tax Act (as amended) | tax_finance | Likely in corpus — verify |
| Federal High Court Act | general | Likely in corpus — verify |
| Administration of Criminal Justice Act (ACJA) 2015 | criminal_rights | ✅ Already hand-ingested as flagship Act |

### How to Source and Ingest Missing Laws

For each missing Act:

1. **Download** the PDF/text from:
   - PLAC: https://placng.org/lawsofnigeria/
   - Law Pavilion: https://www.lawpavilion.com
   - Nigeria Law: https://nigerialaw.org
   - Official gazettes

2. **Convert** PDF to text:
   ```bash
   node scripts/pdf-to-text.js --file legal_sources/federal_acts/<act-name>.pdf
   ```

3. **Review** the cleaned text — fix OCR noise, headers/footers

4. **Ingest** into Firestore:
   ```bash
   node scripts/ingest.js \
     --file legal_sources/federal_acts/<act-name>.txt \
     --act "<Full Act Name>" \
     --practice-area <area> \
     --jurisdiction "Federal"  # or "Lagos State" for state laws
   ```

## Hand-Reviewed Flagship Acts (Always Available)

These 5 Acts were individually reviewed and ingested first, with verified section boundaries:

1. **Lagos State Tenancy Law 2011** — tenancy
2. **Labour Act** — employment
3. **Administration of Criminal Justice Act (ACJA) 2015** — criminal_rights
4. **National Industrial Court Act 2006** — employment
5. **Lagos State Small Claims Court Practice Direction** — contract

Plus the **Constitution of the Federal Republic of Nigeria 1999 (as amended)** — constitutional_rights (315 sections, hand-verified).

## Scripts

| Script | Purpose |
|---|---|
| `scripts/pdf-to-text.js` | Convert PDF to cleaned text |
| `scripts/ingest.js` | Ingest a single Act into Firestore |
| `scripts/bulk-ingest-firestore.js` | Bulk ingest all staged Acts (resumable) |
| `scripts/bulk-fetch-clean.js` | Download + clean Acts from PLAC website |
| `scripts/classify-acts.js` | Bulk-classify Act titles into practice areas |

Progress tracked in: `legal_sources/manifest/ingest_progress.json`
