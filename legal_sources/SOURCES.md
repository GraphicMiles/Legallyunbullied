# Legal source manifest

Every document here was downloaded from a named, checkable source — no scraped/unknown-origin PDFs. Retrieval date for the original 5 flagship Acts + Constitution + Cybercrimes Act: **2026-08-14**. Retrieval date for the bulk PLAC federal compendium: **2026-08-14**.

## Current corpus size: 8,150 sections live in Firestore (verified via count() query)

| Source | Sections | Status |
|---|---|---|
| 5 flagship Acts (hand-cleaned, see table below) | 658 | Ingested |
| Constitution of the FRN 1999 (as altered through 5th Alteration) | 315 | Ingested |
| Bulk PLAC federal compendium — first tranche | ~7,177 (273 Acts) | Ingested |
| Bulk PLAC federal compendium — remaining tranche | ~5,766 (≈269 Acts), fully fetched+cleaned+staged | **Blocked on Firestore daily quota — see below, not yet ingested** |
| Cybercrimes (Prohibition, Prevention, etc.) Act 2015 | 101 sections | ✅ Ingested (as "Cybercrimes (Prohibition, Prevention, etc.) Act 2015") |
| Violence Against Persons (Prohibition) Act 2015 (VAPP) | 48 sections | ✅ Ingested 2026-08-16 — clean per-section text from lawglobalhub.com (official NAPTIP copy); criminal_rights, Federal |
| Recovery of Premises Law | 31 sections | ✅ Ingested 2026-08-16 — uniform Recovery of Premises law text (Kogi-issued edition, substantively identical to the federal Act); tenancy, Federal |
| Federal Competition and Consumer Protection Act 2018 (FCCPA) | 168 sections | ✅ Ingested 2026-08-16 — clean per-section text from lawglobalhub.com (official gazette is OCR-degraded); consumer_rights, Federal |
| Wills Act 1837 | 33 sections | ✅ Ingested 2026-08-16 — lawglobalhub.com per-section text; family_law, Federal |
| Child Rights Act 2003 | 278 sections | ✅ Ingested 2026-08-16 — lawglobalhub.com per-section text (replaced the truncated 99-section compendium copy); family_law, Federal |
| Sale of Goods Act 1893 | 53 sections | ✅ Ingested 2026-08-16 — lawglobalhub.com per-section text (source missing s.4, s.40–48); contract, Federal |

> Source limitation: lawglobalhub.com has no pages for Wills Act s.2/s.12 and Sale of Goods Act s.4/s.40–48 — those sections are absent rather than guessed.

### Why the bulk ingestion is incomplete right now

This session's indexing work (deleting and re-ingesting ~12,000 documents after a text-cleaning bug fix, plus verification queries that fetched entire large collections) burned through the Firestore project's **daily Spark (free-tier) quota** for both writes and reads. Confirmed directly: a raw authenticated REST call to the Firestore Commit endpoint returned `429 RESOURCE_EXHAUSTED` — the `firebase-admin` Node SDK was silently hanging instead of surfacing this error, which cost real debugging time before being traced to the actual cause. `scripts/bulk-ingest-firestore.js` and `scripts/ingest.js` now wrap every Firestore commit in an explicit 20-second timeout so this fails fast and loud next time instead of hanging.

**To finish**: either wait for the Spark plan's daily quota to reset (Firebase resets daily quotas around midnight Pacific Time) and re-run `node scripts/bulk-ingest-firestore.js` (it's resumable — `legal_sources/manifest/ingest_progress.json` tracks what's already in Firestore, so it picks up exactly where it left off), or upgrade the Firebase project to the **Blaze (pay-as-you-go) plan**, which removes the Spark daily caps entirely (Blaze still includes the same free monthly allowance underneath — a project at this document/query volume should stay at or near $0/month).

## Bulk PLAC federal compendium — practice-area distribution (ingested so far)

Auto-classified by an LLM pass over Act *titles only* (`scripts/classify-acts.js`), not hand-curated like the flagship 5 — see `server/practiceAreas.js` for the full 19-category taxonomy and descriptions. Distribution across all 542 successfully-fetched Acts (~12,943 sections once fully ingested):

| practice_area | Acts (approx.) | Notes |
|---|---|---|
| `general` | 188 | Catch-all — institutional/agency-establishment Acts and anything not clearly matching another category |
| `tax_finance` | 71 | Income tax, VAT, customs, banking/CBN regulation |
| `education` | 47 | Schools, universities, examinations boards |
| `health` | 37 | Medical practice, hospitals, drug/food safety |
| `transport_traffic` | 36 | Road traffic, aviation, maritime/admiralty, rail |
| `land_property` | 23 | Land ownership/registration (Land Use Act, etc.) |
| `company_business` | 23 | CAMA, business registration, insolvency |
| `government_administration` | 22 | Agency/parastatal establishment Acts |
| `criminal_offences` | 18 | Substantive offence definitions (fraud, terrorism, trafficking, etc. — excludes ACJA, which is `criminal_rights`) |
| `environment` | 14 | Pollution control, environmental protection |
| `criminal_rights` | 12 | Arrest/bail/procedure (adds to ACJA 2015, already in `criminal_rights`) |
| `employment` | 10 | Adds to Labour Act/NICA, already in `employment` |
| `family_law` | 9 | Marriage, custody, succession, child rights |
| `employment_labour_safety` | 9 | Occupational safety, workmen's compensation, pensions |
| `immigration_citizenship` | 7 | Visas, deportation, citizenship, passports |
| `intellectual_property` | 6 | Copyright, trademarks, patents |
| `contract` | 6 | Adds to the Small Claims Practice Direction, already in `contract` |
| `constitutional_rights` | 5 | (The Constitution itself is ingested separately, see above, not part of this bulk set) |
| `consumer_rights` | 3 | Consumer protection, competition |

### Data-quality approach for the bulk corpus (automated, not hand-reviewed per-Act)

`scripts/lib/textClean.js`'s `autoClean()` generically handles the same class of problems that were fixed by hand for the flagship 5 Acts, at 550-document scale:
1. **ToC-vs-body disambiguation**: detects "runs" of increasing section numbers — a restart back down to 1/2 after climbing much higher marks a new run — and picks the real body using content density (a ToC entry is a bare title; a real section has substantive prose), which works across both PDF- and HTML-sourced text without depending on one specific markup convention.
2. **`[Commencement]` clause cut**: Nigerian statutes conventionally place a bracketed commencement clause between the ToC and the real numbered sections; cutting there removes most ToC noise outright in the common case, tolerating a stray mismatched closing paren seen in a few source scrapes.
3. **Trailing Schedule/Rules/Subsidiary Legislation cut**: stops at explicit markers (`SCHEDULE`, `ORDER <roman numeral>`, `APPENDIX`, `SUBSIDIARY LEGISLATION`, etc.) — but only when the *matched line is itself short* (≤40 chars), specifically to avoid a real bug found and fixed during this work: a mid-sentence reference like "...specified in the **second schedule** to this Act" was initially matching the same trigger as a real "SECOND SCHEDULE" heading and cutting the Cybercrimes Act off after only 39 of its ~59 real sections.
4. Doc IDs include a running index (not just Act + section number), so even a residual Schedule/Rules numbering collision that slips through is non-destructive (no silent overwrite of a real section with the same number).

**Spot-checked quality**: of 542 unique Acts with an extractable text layer (3 PDFs appear to be scanned images with no text layer — logged and skipped, not ingested), ~84% produced a perfectly clean, monotonically-increasing section sequence starting at section 1. The remaining ~16% still captured real, correctly-labeled section content — they just occasionally missed the Act's first section or two (usually just "Short title"/"Interpretation" boilerplate, not the substantive provisions) or had a minor numbering hiccup, due to one-off formatting inconsistencies in specific source documents (e.g. a ToC entry escaping its normal `<ol>` tag, or an OCR misread of "1." as "I."). This is a deliberate engineering trade-off given the true scale (~550 structurally-inconsistent historical government documents from different eras/scanners) — not the same individual hand-review given to the 5 flagship Acts below. Full per-Act stats (section count, monotonic flag, first/last section number) are in `legal_sources/manifest/staged.json`.

## The 5 flagship Acts (fully hand-reviewed) — ingested

| Practice area | Sections | Act(s) |
|---|---|---|
| `tenancy` | 47 | Lagos Tenancy Law 2011 |
| `employment` | 103 | Labour Act (Cap. L1 LFN 2004) · National Industrial Court Act 2006 |
| `criminal_rights` | 491 | Administration of Criminal Justice Act 2015 |
| `contract` | 17 | Lagos Magistrates' Courts Practice Direction on Small Claims 2023 |

For each Act, the `-cleaned.txt` file (not the raw pdf-parse `.txt`) is what was actually ingested — it trims Gazette headers, Arrangement-of-Sections tables of contents, and trailing Schedules/Forms, all of which reuse plain numbers that would otherwise either collide with or dilute real section citations. See per-document notes below for exactly what was trimmed from each.

### Retrieval at this scale: keyword pre-filter, not blind context-stuffing

ACJA 2015 alone is 491 sections — far too many to hand an LLM on every question. `server/legalCorpus.js` fetches every provision for a practice area (cheap — Firestore reads), then if there are more than ~40, narrows to provisions whose text contains at least one keyword the classification step extracted from the question (falls back to the unfiltered set if no keyword matches, so a bad keyword guess never means zero grounding). Verified directly: a detention-related question's keywords correctly surfaced ss.293–294 (the actual detention time-limit provisions) out of all 491 sections, whereas an unfiltered request would have silently returned an arbitrary early slice (ss.1–40) that doesn't cover detention at all. Now that the bulk corpus has some practice areas (e.g. `general`, `tax_finance`) spanning thousands of sections across dozens of Acts, `RAW_FETCH_CAP` in `server/legalCorpus.js` was raised to 4000 to make sure the Firestore query itself doesn't silently truncate before the keyword filter even runs.

## constitution/

| File | Source | Notes |
|---|---|---|
| `1999-constitution-nhrc.pdf` | [National Human Rights Commission](https://www.nigeriarights.gov.ng/files/publications/1999%20CONSTITUTION%20OF%20THE%20FRN.pdf) | Original 1999 text (Cap. C23 LFN 2004 consolidation). Extracted cleanly (235 pages, ~516k chars). Good for cross-checking against the updated version below. Not ingested (superseded by the updated version for live retrieval). |
| `1999-constitution-updated-5th-alteration-plac.pdf` → `1999-constitution-updated-5th-alteration-cleaned.txt` | [PLAC](https://placng.org/i/wp-content/uploads/2023/11/Constitution-of-the-Federal-Republic-of-Nigeria-1999-Updated.pdf) | **Ingested** (`practice_area: constitutional_rights`, `jurisdiction: Federal`, 315 sections, ss.1–320). Updated through the 1st–5th Alterations (2010–2023) — this is the current-law version. Cleaning: located the exact character offset where the real Chapter I restarts after the Arrangement-of-Sections ToC (verified via the two literal occurrences of "Supremacy of the Constitution" — the ToC entry vs. the real section 1 body — 23,029 characters in), and where the real body ends before the trailing Schedules restart their own numbering (the second literal occurrence of "FIRST SCHEDULE", ~398,765 characters in, vs. the first occurrence which is still inside the ToC). Stripped repeated page-break markers (`-- N of 280 --`) and running headers. Verified: 315 sections, ss.1–320, monotonically increasing, no gaps in ordering. |

## federal_acts/ (flagship + individually-added)

| File | Source | Notes |
|---|---|---|
| `labour-act-cap-l1-lfn-2004-plac.pdf` → `-cleaned.txt` | [PLAC Laws of Nigeria](https://lawsofnigeria.placng.org/laws/L1.pdf) | **Ingested** (`practice_area: employment`, `jurisdiction: Federal`, 90 sections). Cleaning: trimmed the Arrangement-of-Sections ToC, dropped the trailing SCHEDULE (transitional/saving provisions), stripped `[Issue 1]` and page-marker (`-- N of 80 --`) artifacts, and removed repeated running-header noise (`CAP.Ll` / `Labour Act` appearing as standalone lines mid-paragraph from page breaks). |
| `acja-2015.pdf` → `-cleaned.txt` | [policinglaw.info](https://www.policinglaw.info/assets/downloads/2015_Administration_of_Criminal_Justice_Act.pdf) | **Ingested** (`practice_area: criminal_rights`, `jurisdiction: Federal`, 491 sections — see the keyword-filter note above, this one's too large to hand to the model unfiltered). Cleaning: trimmed the Arrangement-of-Sections ToC and the entire First Schedule of Forms (which starts with "FORM NO. I" right after s.495's Citation clause — form templates aren't statute text and would otherwise pollute retrieval). |
| `national-industrial-court-act-2006.txt` → `-cleaned.txt` | [PLAC Laws of Nigeria (print view)](https://placng.org/lawsofnigeria/print.php?sn=411) | **Ingested** (`practice_area: employment`, `jurisdiction: Federal`, 13 sections). No standalone PDF found from an official source. Saved as verbatim text (not manually re-typed/paraphrased) covering Parts I–II in full plus the Interpretation and Citation sections (54–55) — the procedural Parts III–VI (court sittings, referees, registrar admin) were intentionally left out as low-relevance to the employment-dispute questions this corpus needs to answer. The Arrangement-of-Sections ToC at the top was trimmed before ingestion (it was initially missed and produced 61 junk chunks instead of the real 13 — caught and fixed before this became a permanent Firestore record). Cross-check against an official Gazette copy before treating a section number here as authoritative. |
| `cybercrimes-act-2015.pdf` → `-cleaned.txt` | [PLAC](https://placng.org/i/wp-content/uploads/2019/12/CyberCrime_ProhibitionPreventionetc_Act_2015.pdf) | Downloaded and cleaned (39 of ~59 real sections captured cleanly — ss.19–58 — the exact same short-line "second schedule to this Act" false-positive that motivated the ≤40-char guard on `STOP_MARKERS_RE` was found and fixed on this document; it should re-clean more completely on the next `--reclean` pass but hasn't been re-verified since. **Not yet ingested — blocked on the Firestore daily quota, see the top of this file.** Would close the long-standing "cyberbullying/cybercrime questions return `general`+empty" gap once ingested, tagged `criminal_offences`. Note: the National Assembly passed a 2024 Amendment Act that specifically revised s.24 (the cyberstalking/harassment provision) — the version here is the original 2015 text only; treat s.24 as potentially superseded until the amendment is separately sourced and cross-checked. |

## state_laws/

| File | Source | Notes |
|---|---|---|
| `lagos-tenancy-law-2011-official.pdf` → `-cleaned.txt` | [Lagos State Ministry of Justice](http://lagosministryofjustice.org/wp-content/uploads/2022/01/Tenancy-Law-2011.pdf) | **Ingested** (`practice_area: tenancy`, `jurisdiction: Lagos State`, 47 sections). Cleaning: trimmed the Gazette header + Arrangement-of-Sections ToC (entries reuse section numbers 1–49 as plain TOC lines), stripped page markers, and corrected one specific extraction artifact in s.16 — the source PDF's own text layer had a duplicated mid-sentence clause ("...may cause the tenant to **As soon as the term or interest on any premises has been determined by a** be served with a written notice..."), almost certainly a column-reflow glitch in the original PDF, not an error on our end. Corrected by removing the duplicated fragment; verify against the original PDF if this section's exact wording matters for a specific case. |
| `lagos-small-claims-practice-direction-2023.pdf` → `-cleaned.txt` | [Lagos MEPB](https://lagosmepb.org/wp-content/uploads/17122025-SMALL-CLAIMS-COURT-PRACTICE-DIRECTIONS-WITH-PEBEC-EDITS.pdf) | **Ingested** (`practice_area: contract`, `jurisdiction: Lagos State`, 17 sections — Articles 1–17 only; Interpretation/Citation/Commencement and the Forms appendix were trimmed). This is the **revised** Practice Direction (with PEBEC edits), more current than the original 2018 version — used deliberately instead of the 2018 text. Structural quirk: this document numbers by "ARTICLE N" on its own line followed by a title line, not the "N. Title" convention every other source here uses — the cleaning step merged those into "N. TITLE" so the standard section-splitting regex would work. |

## federal_acts_bulk/ (the ~550-Act PLAC 2004 compendium)

Not enumerated individually here (see `legal_sources/manifest/staged.json` for the full per-Act manifest: source URL, PDF-vs-HTML, and cleaning stats). Full provenance: every Act came from `https://placng.org/lawsofnigeria/` — either a direct PDF link or the `print.php?sn=N` HTML view, enumerated via `legal_sources/manifest/placng_index.json` (a one-off scrape of the site's own paginated index, 69 pages, 546 raw entries / 542 unique Act names). See "Bulk-indexing the federal statute book" in the top-level `README.md` for the pipeline itself.

## regulations/, case_law/

Empty placeholders — no sources identified/downloaded yet for these categories.

## Not yet sourced / not yet ingested

- **Cybercrimes Act 2015**: downloaded, cleaned, staged — blocked on the Firestore daily quota (see top of this file).
- **Bulk PLAC compendium remaining ~269 Acts**: fetched, cleaned, staged — blocked on the Firestore daily quota (see top of this file).
- **2024 Cybercrimes Amendment Act** (revises s.24 specifically): not yet sourced.
- A general federal "Contract Act" doesn't really exist as a single codified statute in Nigeria — contract law here is largely common-law-based plus scattered statutory provisions (e.g. Sale of Goods Act, Statute of Frauds as received English law). The `contract` practice area's flagship source is Small Claims procedure only (not substantive contract law) — the bulk ingestion adds a handful more Acts tagged `contract` by the title-classifier, but none constitute a comprehensive substantive-contract-law source. Worth a deliberate decision on what to add before leaning on this practice area for anything beyond small-claims procedure.
- State laws beyond Lagos (tenancy/criminal-procedure/land laws for other major states — Abuja/FCT, Rivers, Kano, etc.) — out of scope for this round, which focused on completing federal coverage first per explicit user direction.
