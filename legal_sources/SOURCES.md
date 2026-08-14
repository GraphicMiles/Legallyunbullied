# Legal source manifest

Every document here was downloaded from a named, checkable source — no scraped/unknown-origin PDFs. Retrieval date for everything below: **2026-08-14**.

## Ingestion status: all four practice areas are live in Firestore

| Practice area | Sections | Act(s) |
|---|---|---|
| `tenancy` | 47 | Lagos Tenancy Law 2011 |
| `employment` | 103 | Labour Act (Cap. L1 LFN 2004) · National Industrial Court Act 2006 |
| `criminal_rights` | 491 | Administration of Criminal Justice Act 2015 |
| `contract` | 17 | Lagos Magistrates' Courts Practice Direction on Small Claims 2023 |

For each Act, the `-cleaned.txt` file (not the raw pdf-parse `.txt`) is what was actually ingested — it trims Gazette headers, Arrangement-of-Sections tables of contents, and trailing Schedules/Forms, all of which reuse plain numbers that would otherwise either collide with or dilute real section citations. See per-document notes below for exactly what was trimmed from each.

### Retrieval at this scale: keyword pre-filter, not blind context-stuffing

ACJA 2015 alone is 491 sections — far too many to hand an LLM on every question. `server/legalCorpus.js` fetches every provision for a practice area (cheap — Firestore reads), then if there are more than ~40, narrows to provisions whose text contains at least one keyword the classification step extracted from the question (falls back to the unfiltered set if no keyword matches, so a bad keyword guess never means zero grounding). Verified directly: a detention-related question's keywords correctly surfaced ss.293–294 (the actual detention time-limit provisions) out of all 491 sections, whereas an unfiltered request would have silently returned an arbitrary early slice (ss.1–40) that doesn't cover detention at all.

## constitution/

| File | Source | Notes |
|---|---|---|
| `1999-constitution-nhrc.pdf` | [National Human Rights Commission](https://www.nigeriarights.gov.ng/files/publications/1999%20CONSTITUTION%20OF%20THE%20FRN.pdf) | Original 1999 text (Cap. C23 LFN 2004 consolidation). Extracted cleanly (235 pages, ~516k chars). Good for cross-checking against the updated version below. **Not yet ingested.** |
| `1999-constitution-updated-5th-alteration-plac.pdf` | [PLAC](https://placng.org/i/wp-content/uploads/2023/11/Constitution-of-the-Federal-Republic-of-Nigeria-1999-Updated.pdf) | Updated through the 1st–5th Alterations (2010–2023). **This is the one that should back "current law" retrieval** — the NHRC copy above is the original text only, useful for historical/diff purposes, not as the live source of truth. Extracted cleanly (280 pages, ~493k chars). **Not yet ingested** — no `general` practice-area questions have been tested against it. |

⚠️ Both Constitution files contain Schedules (e.g. the Exclusive Legislative List) with their own numbered list items that **reuse plain numbers already used by real sections** (e.g. a Schedule item "35." exists alongside the actual s.35, Right to Personal Liberty — completely different content). Use `scripts/ingest.js --stop-at "SCHEDULE"` (or the actual heading text immediately before the Schedules begin in each file) before ingesting. The Arrangement-of-Sections table of contents at the top will also need trimming, same as every other document below.

## federal_acts/

| File | Source | Notes |
|---|---|---|
| `labour-act-cap-l1-lfn-2004-plac.pdf` → `-cleaned.txt` | [PLAC Laws of Nigeria](https://lawsofnigeria.placng.org/laws/L1.pdf) | **Ingested** (`practice_area: employment`, `jurisdiction: Federal`, 90 sections). Cleaning: trimmed the Arrangement-of-Sections ToC, dropped the trailing SCHEDULE (transitional/saving provisions), stripped `[Issue 1]` and page-marker (`-- N of 80 --`) artifacts, and removed repeated running-header noise (`CAP.Ll` / `Labour Act` appearing as standalone lines mid-paragraph from page breaks). |
| `acja-2015.pdf` → `-cleaned.txt` | [policinglaw.info](https://www.policinglaw.info/assets/downloads/2015_Administration_of_Criminal_Justice_Act.pdf) | **Ingested** (`practice_area: criminal_rights`, `jurisdiction: Federal`, 491 sections — see the keyword-filter note above, this one's too large to hand to the model unfiltered). Cleaning: trimmed the Arrangement-of-Sections ToC and the entire First Schedule of Forms (which starts with "FORM NO. I" right after s.495's Citation clause — form templates aren't statute text and would otherwise pollute retrieval). |
| `national-industrial-court-act-2006.txt` → `-cleaned.txt` | [PLAC Laws of Nigeria (print view)](https://placng.org/lawsofnigeria/print.php?sn=411) | **Ingested** (`practice_area: employment`, `jurisdiction: Federal`, 13 sections). No standalone PDF found from an official source. Saved as verbatim text (not manually re-typed/paraphrased) covering Parts I–II in full plus the Interpretation and Citation sections (54–55) — the procedural Parts III–VI (court sittings, referees, registrar admin) were intentionally left out as low-relevance to the employment-dispute questions this corpus needs to answer. The Arrangement-of-Sections ToC at the top was trimmed before ingestion (it was initially missed and produced 61 junk chunks instead of the real 13 — caught and fixed before this became a permanent Firestore record). Cross-check against an official Gazette copy before treating a section number here as authoritative. |

## state_laws/

| File | Source | Notes |
|---|---|---|
| `lagos-tenancy-law-2011-official.pdf` → `-cleaned.txt` | [Lagos State Ministry of Justice](http://lagosministryofjustice.org/wp-content/uploads/2022/01/Tenancy-Law-2011.pdf) | **Ingested** (`practice_area: tenancy`, `jurisdiction: Lagos State`, 47 sections). Cleaning: trimmed the Gazette header + Arrangement-of-Sections ToC (entries reuse section numbers 1–49 as plain TOC lines), stripped page markers, and corrected one specific extraction artifact in s.16 — the source PDF's own text layer had a duplicated mid-sentence clause ("...may cause the tenant to **As soon as the term or interest on any premises has been determined by a** be served with a written notice..."), almost certainly a column-reflow glitch in the original PDF, not an error on our end. Corrected by removing the duplicated fragment; verify against the original PDF if this section's exact wording matters for a specific case. |
| `lagos-small-claims-practice-direction-2023.pdf` → `-cleaned.txt` | [Lagos MEPB](https://lagosmepb.org/wp-content/uploads/17122025-SMALL-CLAIMS-COURT-PRACTICE-DIRECTIONS-WITH-PEBEC-EDITS.pdf) | **Ingested** (`practice_area: contract`, `jurisdiction: Lagos State`, 17 sections — Articles 1–17 only; Interpretation/Citation/Commencement and the Forms appendix were trimmed). This is the **revised** Practice Direction (with PEBEC edits), more current than the original 2018 version — used deliberately instead of the 2018 text. Structural quirk: this document numbers by "ARTICLE N" on its own line followed by a title line, not the "N. Title" convention every other source here uses — the cleaning step merged those into "N. TITLE" so the standard section-splitting regex would work. |

## regulations/, case_law/

Empty placeholders — no sources identified/downloaded yet for these categories.

## Not yet sourced / not yet ingested

- **Constitution**: downloaded and extraction-quality-checked, but not yet ingested into the `general` practice area (see the Schedule-collision warning above — needs the `--stop-at` trim applied and verified before it goes into Firestore).
- A general federal "Contract Act" doesn't really exist as a single codified statute in Nigeria — contract law here is largely common-law-based plus scattered statutory provisions (e.g. Sale of Goods Act, Statute of Frauds as received English law). The `contract` practice area is currently grounded only in the Small Claims Practice Direction (procedure, not substantive contract law) — fine for "how do I sue for this" questions, not for "is this contract enforceable" questions. Worth a deliberate decision on what substantive source to add before leaning on this practice area for anything beyond small-claims procedure.
