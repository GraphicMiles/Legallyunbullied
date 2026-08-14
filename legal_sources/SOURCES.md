# Legal source manifest

Every document here was downloaded from a named, checkable source — no scraped/unknown-origin PDFs. Retrieval date for everything below: **2026-08-14**.

None of these have been ingested into Firestore yet. Extraction quality was spot-checked (see notes) but full review/cleanup is still pending — treat `.txt` files as a starting point for ingestion, not a finished corpus.

## constitution/

| File | Source | Notes |
|---|---|---|
| `1999-constitution-nhrc.pdf` | [National Human Rights Commission](https://www.nigeriarights.gov.ng/files/publications/1999%20CONSTITUTION%20OF%20THE%20FRN.pdf) | Original 1999 text (Cap. C23 LFN 2004 consolidation). Extracted cleanly (235 pages, ~516k chars). Good for cross-checking against the updated version below. |
| `1999-constitution-updated-5th-alteration-plac.pdf` | [PLAC](https://placng.org/i/wp-content/uploads/2023/11/Constitution-of-the-Federal-Republic-of-Nigeria-1999-Updated.pdf) | Updated through the 1st–5th Alterations (2010–2023). **This is the one that should back "current law" retrieval** — the NHRC copy above is the original text only, useful for historical/diff purposes, not as the live source of truth. Extracted cleanly (280 pages, ~493k chars). |

⚠️ Both Constitution files contain Schedules (e.g. the Exclusive Legislative List) with their own numbered list items that **reuse plain numbers already used by real sections** (e.g. a Schedule item "35." exists alongside the actual s.35, Right to Personal Liberty — completely different content). Use `scripts/ingest.js --stop-at "SCHEDULE"` (or the actual heading text immediately before the Schedules begin in each file) before ingesting, or review chunk output carefully. The ingestion script's doc-ID scheme is collision-safe either way (see `scripts/ingest.js`), but ingesting Schedule noise as if it were operative statute text would still be low-quality data.

## federal_acts/

| File | Source | Notes |
|---|---|---|
| `labour-act-cap-l1-lfn-2004-plac.pdf` | [PLAC Laws of Nigeria](https://lawsofnigeria.placng.org/laws/L1.pdf) | Extracted cleanly (80 pages, ~198k chars). |
| `acja-2015.pdf` | [policinglaw.info](https://www.policinglaw.info/assets/downloads/2015_Administration_of_Criminal_Justice_Act.pdf) | Administration of Criminal Justice Act 2015. Extracted cleanly (292 pages, ~447k chars). Also has a trailing Schedule of Forms (Form H, E, K, L...) — same numbering-collision caveat as the Constitution; use `--stop-at` before the Schedule when ingesting. |
| `national-industrial-court-act-2006.txt` | [PLAC Laws of Nigeria (print view)](https://placng.org/lawsofnigeria/print.php?sn=411) | No standalone PDF found from an official source. Saved as verbatim text (not manually re-typed/paraphrased) covering Parts I–II in full plus the Interpretation and Citation sections (54–55) — the procedural Parts III–VI (court sittings, referees, registrar admin) were intentionally left out as low-relevance to the employment-dispute questions this corpus needs to answer. Cross-check against an official Gazette copy before treating a section number here as authoritative. |

## state_laws/

| File | Source | Notes |
|---|---|---|
| `lagos-tenancy-law-2011-official.pdf` | [Lagos State Ministry of Justice](http://lagosministryofjustice.org/wp-content/uploads/2022/01/Tenancy-Law-2011.pdf) | Official government source. Extracted cleanly (13 pages, ~35k chars). |
| `lagos-small-claims-practice-direction-2023.pdf` | [Lagos MEPB](https://lagosmepb.org/wp-content/uploads/17122025-SMALL-CLAIMS-COURT-PRACTICE-DIRECTIONS-WITH-PEBEC-EDITS.pdf) | This is the **revised** Practice Direction (with PEBEC edits), more current than the original 2018 version — used deliberately instead of the 2018 text. Extracted cleanly (35 pages, ~62k chars). |

## regulations/, case_law/

Empty placeholders — no sources identified/downloaded yet for these categories.

## Not yet sourced

- A general federal "Contract Act" doesn't really exist as a single codified statute in Nigeria — contract law here is largely common-law-based plus scattered statutory provisions (e.g. Sale of Goods Act, Statute of Frauds as received English law). The "contract" practice area's grounding should probably lean on the Small Claims Practice Direction (procedure) rather than a single contract-law Act; worth a deliberate decision before ingesting anything under `practice_area: contract`.
