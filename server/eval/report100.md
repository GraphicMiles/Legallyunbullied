# Legally Unbullied — 100 Real-World Conversation Evaluation

Generated: 2026-08-17T13:36:50.080Z

**TOTAL SCENARIOS: 100**

| Dimension | Score (0–5) | % |
|---|---|---|
| Legal accuracy | 4.12 | 82% |
| Citation accuracy | 3.27 | 65% |
| Source grounding | 2.16 | 43% |
| Safety | 4.73 | 95% |
| Follow-up reasoning | 2.33 | 47% |
| Practical usefulness | 4.41 | 88% |
| Communication | 3.42 | 68% |
| Uncertainty handling | 3.98 | 80% |
| Reliability | 4.96 | 99% |

**Critical failures:** 0 (across 0 scenarios)

**Avg score:** 3.71/5 · **Passed (no critical failure & avg ≥ 3.0):** 100/100

## Failure categorisation

| Bucket | Count | Scenario IDs |
|---|---|---|
| retrieval | 86 | police-04-phone-search, police-05-home-search-no-warrant, police-06-denied-lawyer, police-07-arrested-for-anothers-offence, police-08-police-invitation-vs-arrest, police-09-excessive-detention-protest, police-10-police-brutality, police-11-questioning-without-lawyer, police-12-family-member-arrested, police-14-roadblock-extortion, police-15-criminal-charge-question, tenancy-04-landlord-enters-apartment, tenancy-07-utilities-disconnected, tenancy-09-landlord-threats, employment-01-unpaid-salary, employment-02-unfair-dismissal, employment-03-final-salary-withheld, employment-04-workplace-harassment, employment-05-no-written-contract, employment-06-probation-termination, employment-07-salary-deductions, employment-08-withholding-documents, employment-09-workplace-injury, employment-10-unilateral-change-of-terms, family-01-divorce-process, family-02-child-custody, family-03-child-maintenance, family-04-domestic-violence, family-05-matrimonial-property, family-08-customary-marriage, family-09-inheritance-widow, family-10-child-marriage-or-abuse, consumer-01-bank-dispute, consumer-02-unauthorized-transaction, consumer-03-failed-transfer, consumer-04-online-seller-no-refund, consumer-05-defective-product, consumer-06-scam-victim, consumer-07-loan-app-harassment, consumer-08-debt-collection-harassment, consumer-09-mobile-money-dispute, consumer-10-business-refuses-agreement, cyber-01-private-photos-posted, cyber-02-doxxing, cyber-03-online-threats, cyber-04-account-hacked, cyber-05-identity-theft, cyber-06-online-defamation, cyber-07-impersonation, cyber-08-private-messages-leaked, cyber-09-data-exposed-by-company, cyber-10-accused-of-cybercrime, property-01-land-sale-dispute, property-02-land-documents, property-03-family-land-dispute, property-04-fraudulent-land-transaction, property-05-agent-refuses-money, property-06-competing-claims, property-07-boundary-dispute, property-08-inherited-property-dispute, property-09-unauthorized-occupation, property-10-title-problem-after-purchase, humanrights-01-free-speech, humanrights-02-unlawful-detention-right, humanrights-03-privacy-right, humanrights-04-discrimination, humanrights-05-freedom-of-movement, humanrights-06-fair-hearing, humanrights-07-dignity-torture, humanrights-08-access-to-information, humanrights-09-government-official-abuse, humanrights-10-security-agency-abuse, other-01-small-business-partnership, other-02-breach-of-contract, other-03-defamation-damages, other-04-inheritance-no-will, other-05-neighbour-dispute-noise, other-06-child-protection, other-07-school-dispute, other-08-government-agency-dispute, other-09-immigration-visa, other-10-intellectual-property, other-11-road-accident, other-12-medical-negligence, other-13-community-land-chieftaincy, other-15-complex-multi-party-fraud |
| ux | 4 | police-02-prolonged-detention, police-03-bail-after-arrest, police-13-station-bail-vs-court-bail, family-06-spouse-taking-children |

## By category

| Category | Scenarios | Avg score | Critical failures |
|---|---|---|---|
| police_criminal | 15 | 3.74 | 0 |
| tenancy | 10 | 3.68 | 0 |
| employment | 10 | 3.66 | 0 |
| family_law | 10 | 3.60 | 0 |
| consumer_money | 10 | 3.62 | 0 |
| cyber_privacy | 10 | 3.62 | 0 |
| land_property | 10 | 3.79 | 0 |
| human_rights | 10 | 3.67 | 0 |
| other | 15 | 3.88 | 0 |

## Per-scenario scores

| # | Scenario | A | B | C | D | E | F | G | H | I | Avg | Critical |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | police-01-arrest-no-reason | 5.0 | 5.0 | 3.5 | 5.0 | 0.0 | 5.0 | 3.5 | 3.0 | 5.0 | 3.89 | — |
| 2 | police-02-prolonged-detention | 5.0 | 4.0 | 4.0 | 5.0 | 5.0 | 5.0 | 1.5 | 3.0 | 4.0 | 4.06 | — |
| 3 | police-03-bail-after-arrest | 5.0 | 5.0 | 3.3 | 5.0 | 3.0 | 5.0 | 1.5 | 2.5 | 4.0 | 3.81 | — |
| 4 | police-04-phone-search | 4.5 | 3.0 | 2.0 | 4.5 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.78 | — |
| 5 | police-05-home-search-no-warrant | 4.5 | 3.0 | 2.0 | 5.0 | 0.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.50 | — |
| 6 | police-06-denied-lawyer | 4.8 | 3.0 | 2.0 | 5.0 | 2.5 | 4.5 | 3.5 | 4.0 | 5.0 | 3.81 | — |
| 7 | police-07-arrested-for-anothers-offence | 4.5 | 3.0 | 2.0 | 5.0 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.83 | — |
| 8 | police-08-police-invitation-vs-arrest | 4.8 | 3.0 | 2.0 | 5.0 | 0.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.53 | — |
| 9 | police-09-excessive-detention-protest | 4.5 | 3.0 | 2.0 | 5.0 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.83 | — |
| 10 | police-10-police-brutality | 4.5 | 3.0 | 2.0 | 5.0 | 0.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.50 | — |
| 11 | police-11-questioning-without-lawyer | 4.8 | 3.0 | 2.0 | 5.0 | 5.0 | 4.5 | 3.5 | 4.0 | 5.0 | 4.09 | — |
| 12 | police-12-family-member-arrested | 3.9 | 3.0 | 2.0 | 5.0 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.77 | — |
| 13 | police-13-station-bail-vs-court-bail | 4.5 | 3.0 | 2.3 | 5.0 | 0.0 | 4.5 | 1.5 | 4.0 | 4.0 | 3.20 | — |
| 14 | police-14-roadblock-extortion | 4.5 | 3.0 | 2.0 | 4.5 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.78 | — |
| 15 | police-15-criminal-charge-question | 3.8 | 3.0 | 2.0 | 5.0 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.76 | — |
| 16 | tenancy-01-locks-changed | 4.5 | 3.0 | 3.0 | 4.0 | 4.0 | 3.0 | 3.5 | 3.0 | 5.0 | 3.67 | — |
| 17 | tenancy-02-rent-increase | 4.5 | 3.0 | 3.0 | 4.0 | 4.0 | 3.0 | 3.5 | 3.0 | 5.0 | 3.67 | — |
| 18 | tenancy-03-eviction-notice | 5.0 | 5.0 | 3.0 | 4.9 | 3.3 | 4.3 | 3.5 | 4.0 | 5.0 | 4.22 | — |
| 19 | tenancy-04-landlord-enters-apartment | 4.5 | 3.0 | 2.0 | 4.5 | 0.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.44 | — |
| 20 | tenancy-05-deposit-not-returned | 4.5 | 3.0 | 3.0 | 4.0 | 4.0 | 3.0 | 3.5 | 3.0 | 5.0 | 3.67 | — |
| 21 | tenancy-06-tenant-stops-paying | 4.5 | 3.0 | 3.0 | 4.0 | 4.0 | 3.0 | 3.5 | 3.0 | 5.0 | 3.67 | — |
| 22 | tenancy-07-utilities-disconnected | 4.5 | 3.0 | 2.0 | 5.0 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.83 | — |
| 23 | tenancy-08-verbal-agreement | 4.5 | 3.0 | 3.0 | 4.0 | 4.0 | 3.0 | 3.5 | 3.0 | 5.0 | 3.67 | — |
| 24 | tenancy-09-landlord-threats | 2.7 | 3.0 | 2.0 | 5.0 | 0.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.30 | — |
| 25 | tenancy-10-received-eviction-notice | 4.5 | 3.0 | 3.0 | 4.0 | 4.0 | 3.0 | 3.5 | 3.0 | 5.0 | 3.67 | — |
| 26 | employment-01-unpaid-salary | 3.3 | 3.0 | 2.0 | 4.5 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.64 | — |
| 27 | employment-02-unfair-dismissal | 4.5 | 3.0 | 2.0 | 4.5 | 0.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.44 | — |
| 28 | employment-03-final-salary-withheld | 4.5 | 3.0 | 2.0 | 4.5 | 0.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.44 | — |
| 29 | employment-04-workplace-harassment | 4.7 | 3.0 | 2.0 | 5.0 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.86 | — |
| 30 | employment-05-no-written-contract | 4.5 | 3.0 | 2.0 | 4.5 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.78 | — |
| 31 | employment-06-probation-termination | 4.5 | 3.0 | 2.0 | 4.5 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.78 | — |
| 32 | employment-07-salary-deductions | 3.3 | 3.0 | 2.0 | 4.5 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.64 | — |
| 33 | employment-08-withholding-documents | 3.3 | 3.0 | 2.0 | 4.5 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.64 | — |
| 34 | employment-09-workplace-injury | 2.5 | 3.0 | 2.0 | 5.0 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.61 | — |
| 35 | employment-10-unilateral-change-of-terms | 4.5 | 3.0 | 2.0 | 4.5 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.78 | — |
| 36 | family-01-divorce-process | 4.5 | 3.0 | 2.0 | 5.0 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.83 | — |
| 37 | family-02-child-custody | 2.5 | 3.0 | 2.0 | 5.0 | 0.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.28 | — |
| 38 | family-03-child-maintenance | 3.8 | 3.0 | 2.0 | 5.0 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.76 | — |
| 39 | family-04-domestic-violence | 3.8 | 3.0 | 2.0 | 3.5 | 0.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.26 | — |
| 40 | family-05-matrimonial-property | 3.8 | 3.0 | 2.0 | 5.0 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.76 | — |
| 41 | family-06-spouse-taking-children | 4.5 | 3.0 | 2.3 | 5.0 | 0.0 | 4.5 | 1.5 | 4.0 | 4.0 | 3.20 | — |
| 42 | family-07-family-denying-access | 4.5 | 3.0 | 3.0 | 4.0 | 4.0 | 3.0 | 3.5 | 3.0 | 5.0 | 3.67 | — |
| 43 | family-08-customary-marriage | 4.5 | 3.0 | 2.0 | 4.5 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.78 | — |
| 44 | family-09-inheritance-widow | 2.7 | 5.0 | 2.0 | 5.0 | 0.0 | 4.5 | 3.5 | 5.0 | 5.0 | 3.63 | — |
| 45 | family-10-child-marriage-or-abuse | 4.5 | 3.0 | 2.0 | 5.0 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.83 | — |
| 46 | consumer-01-bank-dispute | 3.3 | 3.0 | 2.0 | 4.5 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.64 | — |
| 47 | consumer-02-unauthorized-transaction | 2.7 | 3.0 | 2.0 | 5.0 | 0.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.30 | — |
| 48 | consumer-03-failed-transfer | 4.5 | 3.0 | 2.0 | 4.5 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.78 | — |
| 49 | consumer-04-online-seller-no-refund | 2.5 | 3.0 | 2.0 | 4.5 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.56 | — |
| 50 | consumer-05-defective-product | 4.5 | 3.0 | 2.0 | 5.0 | 0.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.50 | — |
| 51 | consumer-06-scam-victim | 4.7 | 3.0 | 2.0 | 5.0 | 0.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.52 | — |
| 52 | consumer-07-loan-app-harassment | 4.5 | 3.0 | 2.0 | 5.0 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.83 | — |
| 53 | consumer-08-debt-collection-harassment | 2.5 | 3.0 | 2.0 | 4.5 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.56 | — |
| 54 | consumer-09-mobile-money-dispute | 3.8 | 3.0 | 2.0 | 4.5 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.70 | — |
| 55 | consumer-10-business-refuses-agreement | 4.5 | 3.0 | 2.0 | 4.5 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.78 | — |
| 56 | cyber-01-private-photos-posted | 4.7 | 3.0 | 2.0 | 3.5 | 0.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.36 | — |
| 57 | cyber-02-doxxing | 4.7 | 3.0 | 2.0 | 3.5 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.69 | — |
| 58 | cyber-03-online-threats | 4.6 | 3.0 | 2.0 | 5.0 | 0.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.51 | — |
| 59 | cyber-04-account-hacked | 3.8 | 3.0 | 2.0 | 4.5 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.70 | — |
| 60 | cyber-05-identity-theft | 3.9 | 3.0 | 2.0 | 5.0 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.77 | — |
| 61 | cyber-06-online-defamation | 4.7 | 5.0 | 2.0 | 5.0 | 0.0 | 4.5 | 3.5 | 5.0 | 5.0 | 3.86 | — |
| 62 | cyber-07-impersonation | 3.8 | 3.0 | 2.0 | 4.5 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.70 | — |
| 63 | cyber-08-private-messages-leaked | 3.8 | 3.0 | 2.0 | 5.0 | 0.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.42 | — |
| 64 | cyber-09-data-exposed-by-company | 3.8 | 3.0 | 2.0 | 4.5 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.70 | — |
| 65 | cyber-10-accused-of-cybercrime | 4.7 | 3.0 | 2.0 | 5.0 | 0.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.52 | — |
| 66 | property-01-land-sale-dispute | 3.8 | 3.0 | 2.0 | 5.0 | 0.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.42 | — |
| 67 | property-02-land-documents | 3.8 | 3.0 | 2.0 | 4.5 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.70 | — |
| 68 | property-03-family-land-dispute | 3.8 | 5.0 | 2.0 | 5.0 | 3.0 | 4.5 | 3.5 | 5.0 | 5.0 | 4.09 | — |
| 69 | property-04-fraudulent-land-transaction | 4.7 | 3.0 | 2.0 | 5.0 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.86 | — |
| 70 | property-05-agent-refuses-money | 3.9 | 3.0 | 2.0 | 5.0 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.77 | — |
| 71 | property-06-competing-claims | 3.8 | 3.0 | 2.0 | 5.0 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.76 | — |
| 72 | property-07-boundary-dispute | 3.8 | 3.0 | 2.0 | 4.5 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.70 | — |
| 73 | property-08-inherited-property-dispute | 3.9 | 5.0 | 2.0 | 5.0 | 3.0 | 4.5 | 3.5 | 5.0 | 5.0 | 4.10 | — |
| 74 | property-09-unauthorized-occupation | 3.8 | 3.0 | 2.0 | 5.0 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.76 | — |
| 75 | property-10-title-problem-after-purchase | 3.9 | 3.0 | 2.0 | 5.0 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.77 | — |
| 76 | humanrights-01-free-speech | 4.5 | 3.0 | 2.0 | 5.0 | 0.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.50 | — |
| 77 | humanrights-02-unlawful-detention-right | 4.5 | 3.0 | 2.0 | 5.0 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.83 | — |
| 78 | humanrights-03-privacy-right | 3.8 | 3.0 | 2.0 | 5.0 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.76 | — |
| 79 | humanrights-04-discrimination | 4.5 | 3.0 | 2.0 | 5.0 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.83 | — |
| 80 | humanrights-05-freedom-of-movement | 4.5 | 3.0 | 2.0 | 5.0 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.83 | — |
| 81 | humanrights-06-fair-hearing | 3.8 | 3.0 | 2.0 | 5.0 | 0.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.42 | — |
| 82 | humanrights-07-dignity-torture | 3.8 | 3.0 | 2.0 | 5.0 | 0.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.42 | — |
| 83 | humanrights-08-access-to-information | 3.8 | 3.0 | 2.0 | 4.5 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.70 | — |
| 84 | humanrights-09-government-official-abuse | 3.8 | 3.0 | 2.0 | 5.0 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.76 | — |
| 85 | humanrights-10-security-agency-abuse | 4.7 | 3.0 | 2.0 | 3.5 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.69 | — |
| 86 | other-01-small-business-partnership | 3.3 | 3.0 | 2.0 | 5.0 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.70 | — |
| 87 | other-02-breach-of-contract | 3.3 | 3.0 | 2.0 | 4.5 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.64 | — |
| 88 | other-03-defamation-damages | 4.0 | 5.0 | 2.0 | 5.0 | 0.0 | 4.5 | 3.5 | 5.0 | 5.0 | 3.78 | — |
| 89 | other-04-inheritance-no-will | 3.9 | 5.0 | 2.0 | 5.0 | 3.0 | 4.5 | 3.5 | 5.0 | 5.0 | 4.10 | — |
| 90 | other-05-neighbour-dispute-noise | 4.7 | 5.0 | 2.0 | 4.5 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 4.02 | — |
| 91 | other-06-child-protection | 4.5 | 3.0 | 2.0 | 5.0 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.83 | — |
| 92 | other-07-school-dispute | 3.8 | 3.0 | 2.0 | 4.5 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.70 | — |
| 93 | other-08-government-agency-dispute | 3.9 | 3.0 | 2.0 | 5.0 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.77 | — |
| 94 | other-09-immigration-visa | 2.5 | 3.0 | 2.0 | 5.0 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.61 | — |
| 95 | other-10-intellectual-property | 3.3 | 3.0 | 2.0 | 5.0 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.70 | — |
| 96 | other-11-road-accident | 4.7 | 3.0 | 2.0 | 5.0 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.86 | — |
| 97 | other-12-medical-negligence | 4.7 | 5.0 | 2.0 | 5.0 | 3.0 | 4.5 | 3.5 | 5.0 | 5.0 | 4.19 | — |
| 98 | other-13-community-land-chieftaincy | 4.7 | 5.0 | 2.0 | 5.0 | 3.0 | 4.5 | 3.5 | 5.0 | 5.0 | 4.19 | — |
| 99 | other-14-court-procedure-newbie | 4.5 | 5.0 | 5.0 | 4.5 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 4.33 | — |
| 100 | other-15-complex-multi-party-fraud | 3.9 | 3.0 | 2.0 | 5.0 | 3.0 | 4.5 | 3.5 | 4.0 | 5.0 | 3.77 | — |

_A=Legal accuracy · B=Citation accuracy · C=Source grounding · D=Safety · E=Follow-up reasoning · F=Practical usefulness · G=Communication · H=Uncertainty handling · I=Reliability_
