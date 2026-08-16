# -*- coding: utf-8 -*-
"""Follow-up turn patches.

Adds 1-2 follow-up turns to scenarios so that >=50 of the 100 contain 2-4
follow-up turns (spec §5), and injects contradiction/reveal dynamics (spec §6-7).
`turns` are APPENDED in order. `turn_checks` (optional) give the scorer
per-turn assertions for follow-up reasoning / contradiction handling.
"""

PATCHES = {
    # ── POLICE ────────────────────────────────────────────────────────────
    "police-01-arrest-no-reason": {
        "turns": ["We don't know which station they carried him to."],
        "turn_checks": [{"turn": 3, "should_mention": ["station", "locate", "find"]}],
    },
    "police-02-prolonged-detention": {
        "turns": ["We no get money for lawyer. Is there anything we can do without paying?"],
        "turn_checks": [{"turn": 2, "should_mention": ["legal aid", "court", "fundamental rights"]}],
    },
    "police-03-bail-after-arrest": {
        "turns": ["How long does it usually take to get someone out on bail?"],
    },
    "police-04-phone-search": {
        "turns": ["They deleted some messages before giving me back the phone. Is that also wrong?"],
    },
    "police-05-home-search-no-warrant": {
        "turns": ["Can I sue them for what they carried away?"],
        "turn_checks": [{"turn": 2, "should_mention": ["fundamental rights", "court", "recover"]}],
    },
    "police-06-denied-lawyer": {
        "turns": [
            "I don't have a lawyer. How do I get one quickly?",
            "They are now saying if I write statement they will release me tonight.",
        ],
        "turn_checks": [{"turn": 1, "should_mention": ["lawyer", "legal aid", "NBA"]},
                        {"turn": 2, "should_mention": ["lawyer", "statement"]}],
    },
    "police-07-arrested-for-anothers-offence": {
        "turns": ["My dad is old and sick. Is there a way to get him out fast?"],
    },
    "police-08-police-invitation-vs-arrest": {
        "turns": ["Actually, I need to correct myself — they already arrested him this morning and he is in the cell now. I only just found out."],
        "turn_checks": [{"turn": 2, "should_mention": ["arrest", "detention", "bail"], "should_not_mention": ["invitation"]}],
        "tags": ["contradiction"],
    },
    "police-09-excessive-detention-protest": {
        "turns": ["Some human rights people came to the station but dem still no release am."],
    },
    "police-10-police-brutality": {
        "turns": ["Who do we report police misconduct to officially?"],
        "turn_checks": [{"turn": 2, "should_mention": ["complaint", "Police Service Commission", "report"]}],
    },
    "police-11-questioning-without-lawyer": {
        "turns": ["They say if I no write statement, I go sleep for cell."],
        "turn_checks": [{"turn": 1, "should_mention": ["lawyer", "statement"]}],
    },
    "police-12-family-member-arrested": {
        "turns": ["She is a student and this is her first time in any police matter."],
    },
    "police-13-station-bail-vs-court-bail": {
        "turns": ["They are now threatening to move him to prison if we don't pay more."],
        "turn_checks": [{"turn": 1, "should_mention": ["report", "complain", "unlawful"]}],
    },
    "police-14-roadblock-extortion": {
        "turns": ["They collected the 10k already. Can I still report it?"],
    },
    "police-15-criminal-charge-question": {
        "turns": ["What does 'taking a plea' mean exactly?"],
    },

    # ── TENANCY ───────────────────────────────────────────────────────────
    "tenancy-01-locks-changed": {
        "turns": ["I have nowhere to sleep tonight. What should I do right now?"],
        "turn_checks": [{"turn": 2, "should_mention": ["police", "report", "stay"]}],
    },
    "tenancy-02-rent-increase": {
        "turns": ["He now sent me a quit notice because I refused the new rent."],
    },
    "tenancy-03-eviction-notice": {
        "turns": ["Wait, I need to be honest — the notice was actually served only two weeks ago, not three months. Does that change anything?"],
        "turn_checks": [{"turn": 3, "should_mention": ["notice", "weeks", "valid"]}],
        "tags": ["contradiction"],
    },
    "tenancy-04-landlord-enters-apartment": {
        "turns": ["Can I change my own lock so he cannot enter again?"],
        "turn_checks": [{"turn": 1, "should_mention": ["lock", "exclusive possession", "allowed"]}],
    },
    "tenancy-05-deposit-not-returned": {
        "turns": ["Actually he returned 50k of it but is holding the remaining 100k for 'cleaning'."],
        "tags": ["contradiction"],
    },
    "tenancy-06-tenant-stops-paying": {
        "turns": ["The tenant has now packed out secretly and left the house empty but damaged."],
    },
    "tenancy-07-utilities-disconnected": {
        "turns": ["He says he will only restore it if I agree to move out in one week."],
    },
    "tenancy-08-verbal-agreement": {
        "turns": ["Do verbal agreements even count in court?"],
    },
    "tenancy-09-landlord-threats": {
        "turns": ["Should I report him to the police before anything happens or wait?"],
        "turn_checks": [{"turn": 1, "should_mention": ["report", "police", "protection"]}],
    },
    "tenancy-10-received-eviction-notice": {
        "turns": ["Can he really force me out if I don't leave in 7 days?"],
        "turn_checks": [{"turn": 1, "should_mention": ["court", "order", "lawful"]}],
    },

    # ── EMPLOYMENT ────────────────────────────────────────────────────────
    "employment-01-unpaid-salary": {
        "turns": ["What if I resign now — will I lose the unpaid salaries?"],
    },
    "employment-02-unfair-dismissal": {
        "turns": ["Actually, I need to correct myself — they did not give me any letter. My manager just called and said don't come back."],
        "turn_checks": [{"turn": 2, "should_mention": ["letter", "written", "oral"], "should_not_mention": ["termination letter"]}],
        "tags": ["contradiction"],
    },
    "employment-03-final-salary-withheld": {
        "turns": ["He says he will only pay if I sign a paper saying I won't sue."],
        "turn_checks": [{"turn": 1, "should_mention": ["sign", "lawyer", "claim"]}],
    },
    "employment-04-workplace-harassment": {
        "turns": ["If I report, can they sack me for it?"],
    },
    "employment-05-no-written-contract": {
        "turns": ["I lost my phone so I don't have the WhatsApp messages anymore."],
    },
    "employment-06-probation-termination": {
        "turns": ["My probation was supposed to end next week."],
    },
    "employment-07-salary-deductions": {
        "turns": ["He has done this to other staff too."],
    },
    "employment-08-withholding-documents": {
        "turns": ["Is there a law that says they must give me the certificate?"],
    },
    "employment-09-workplace-injury": {
        "turns": ["The factory owner is now saying the injury was my fault."],
    },
    "employment-10-unilateral-change-of-terms": {
        "turns": ["If I refuse the new terms, can they sack me?"],
    },

    # ── FAMILY ────────────────────────────────────────────────────────────
    "family-01-divorce-process": {
        "turns": ["How long does a divorce usually take in Nigeria?"],
    },
    "family-02-child-custody": {
        "turns": ["He has now taken the children to his mother's village without my permission."],
        "turn_checks": [{"turn": 1, "should_mention": ["custody", "court", "return"]}],
    },
    "family-03-child-maintenance": {
        "turns": ["Can I take him to court even though we were never married?"],
    },
    "family-04-domestic-violence": {
        "turns": [
            "I'm packing to leave now. Is there a safe place I can go or a number I can call?",
            "He is outside the house now and I am scared.",
        ],
        "turn_checks": [{"turn": 1, "should_mention": ["safe", "report", "police"]},
                        {"turn": 2, "should_mention": ["police", "safety", "call"]}],
    },
    "family-05-matrimonial-property": {
        "turns": ["We built another property together after marriage — what happens to that one?"],
    },
    "family-06-spouse-taking-children": {
        "turns": ["Actually, I misspoke — she has not collected the passports yet, she only threatened to take the children abroad."],
        "turn_checks": [{"turn": 2, "should_mention": ["threat", "prevent", "consent"], "should_not_mention": ["passport"]}],
        "tags": ["contradiction"],
    },
    "family-07-family-denying-access": {
        "turns": ["Is there any court we can approach, or do we need the mother's permission?"],
    },
    "family-08-customary-marriage": {
        "turns": ["So does he still need to divorce me properly, or can he just leave?"],
    },
    "family-09-inheritance-widow": {
        "turns": ["The family is now selling my late husband's land. Can I stop them quickly?"],
        "turn_checks": [{"turn": 1, "should_mention": ["court", "injunction", "lawyer"]}],
    },
    "family-10-child-marriage-or-abuse": {
        "turns": ["Who exactly should I report this to?"],
    },

    # ── CONSUMER ──────────────────────────────────────────────────────────
    "consumer-01-bank-dispute": {
        "turns": ["The bank said they are still 'investigating' and I should stop disturbing them."],
    },
    "consumer-02-unauthorized-transaction": {
        "turns": ["Actually, I just found out it was my younger brother that used my phone — he knows my PIN. Does that change what I can do?"],
        "turn_checks": [{"turn": 2, "should_mention": ["brother", "family", "police", "bank"]}],
        "tags": ["contradiction"],
    },
    "consumer-03-failed-transfer": {
        "turns": ["The bank now says the money has been reversed, but it is not reflecting in my account."],
    },
    "consumer-04-online-seller-no-refund": {
        "turns": ["The platform says I should resolve it with the seller directly."],
    },
    "consumer-05-defective-product": {
        "turns": ["Can I claim for the items that got burnt in my shop too?"],
        "turn_checks": [{"turn": 1, "should_mention": ["damages", "claim", "lawyer"]}],
    },
    "consumer-06-scam-victim": {
        "turns": ["Which agency handles this kind of fraud — is it the police or EFCC?"],
        "turn_checks": [{"turn": 1, "should_mention": ["EFCC", "police", "report"]}],
    },
    "consumer-07-loan-app-harassment": {
        "turns": ["I don't even remember taking any loan from them."],
    },
    "consumer-08-debt-collection-harassment": {
        "turns": ["They threatened to come to my office. What should I do if they show up?"],
    },
    "consumer-09-mobile-money-dispute": {
        "turns": ["The bank says because it was a POS agent, they are not responsible."],
    },
    "consumer-10-business-refuses-agreement": {
        "turns": ["She is now offering to refund only half. Should I accept?"],
    },

    # ── CYBER ─────────────────────────────────────────────────────────────
    "cyber-01-private-photos-posted": {
        "turns": ["Should I pay him or block him? I just want it to stop."],
        "turn_checks": [{"turn": 1, "should_mention": ["police", "report", "don't pay", "do not pay"]}],
    },
    "cyber-02-doxxing": {
        "turns": ["I have screenshots of everything. Who do I report to?"],
    },
    "cyber-03-online-threats": {
        "turns": ["The person just sent a message saying they are coming to my workplace today."],
        "turn_checks": [{"turn": 1, "should_mention": ["police", "report", "safety"]}],
    },
    "cyber-04-account-hacked": {
        "turns": ["The hacker is now asking my friends for money from my account."],
    },
    "cyber-05-identity-theft": {
        "turns": ["Should I also report to my bank?"],
    },
    "cyber-06-online-defamation": {
        "turns": ["Can I force them to remove the post?"],
        "turn_checks": [{"turn": 1, "should_mention": ["remove", "report", "lawyer"]}],
    },
    "cyber-07-impersonation": {
        "turns": ["I have reported the account but the platform has not removed it yet."],
    },
    "cyber-08-private-messages-leaked": {
        "turns": ["Actually, nothing has been leaked yet — they are only threatening to leak them if I don't pay."],
        "turn_checks": [{"turn": 1, "should_mention": ["threat", "blackmail", "report"]}],
        "tags": ["contradiction"],
    },
    "cyber-09-data-exposed-by-company": {
        "turns": ["How do I check if my BVN has been used for fraud?"],
    },
    "cyber-10-accused-of-cybercrime": {
        "turns": ["Should I hand over my laptop and phone to them?"],
        "turn_checks": [{"turn": 1, "should_mention": ["lawyer", "warrant", "refuse"]}],
    },

    # ── PROPERTY ──────────────────────────────────────────────────────────
    "property-01-land-sale-dispute": {
        "turns": ["The seller is now saying he never received my payment."],
        "turn_checks": [{"turn": 1, "should_mention": ["receipt", "evidence", "proof"]}],
    },
    "property-02-land-documents": {
        "turns": ["What is a search at the land registry and how do I do it?"],
    },
    "property-03-family-land-dispute": {
        "turns": ["Is it true that family land cannot be sold at all?"],
    },
    "property-04-fraudulent-land-transaction": {
        "turns": ["We are three buyers now. Who owns the land among us?"],
    },
    "property-05-agent-refuses-money": {
        "turns": ["The agent's office landlord says he has packed out and left the country."],
    },
    "property-06-competing-claims": {
        "turns": ["I have been farming there for 10 years. Does that give me any right?"],
    },
    "property-07-boundary-dispute": {
        "turns": ["The neighbour has started building on the disputed part."],
    },
    "property-08-inherited-property-dispute": {
        "turns": ["One brother has already sold part of the land without telling us."],
    },
    "property-09-unauthorized-occupation": {
        "turns": ["The squatters have been there over a year. Does that make it harder to remove them?"],
    },
    "property-10-title-problem-after-purchase": {
        "turns": ["I want my money back from the seller. How do I go about it?"],
    },

    # ── HUMAN RIGHTS ──────────────────────────────────────────────────────
    "humanrights-01-free-speech": {
        "turns": ["Can we sue the police for his arrest?"],
        "turn_checks": [{"turn": 1, "should_mention": ["fundamental rights", "court", "damages"]}],
    },
    "humanrights-02-unlawful-detention-right": {
        "turns": ["How do I start a fundamental rights case? Do I need a lawyer?"],
    },
    "humanrights-03-privacy-right": {
        "turns": ["I only found out because they quoted my messages during a meeting."],
    },
    "humanrights-04-discrimination": {
        "turns": ["I have been denied promotion 3 times while less qualified people got it."],
    },
    "humanrights-05-freedom-of-movement": {
        "turns": ["They say it's 'on the orders of the commissioner'. Does that make it legal?"],
    },
    "humanrights-06-fair-hearing": {
        "turns": ["They said the decision is final and I cannot appeal."],
        "turn_checks": [{"turn": 1, "should_mention": ["appeal", "fair hearing", "court"]}],
    },
    "humanrights-07-dignity-torture": {
        "turns": ["I am scared to report because the same officers are still around."],
        "turn_checks": [{"turn": 1, "should_mention": ["report", "medical", "lawyer", "protection"]}],
    },
    "humanrights-08-access-to-information": {
        "turns": ["They replied saying the information is 'classified'. Can they just say that?"],
    },
    "humanrights-09-government-official-abuse": {
        "turns": ["Which agency do we report an official to — EFCC or ICPC?"],
    },
    "humanrights-10-security-agency-abuse": {
        "turns": ["Some families want to protest. Is that safe?"],
    },

    # ── OTHER ─────────────────────────────────────────────────────────────
    "other-01-small-business-partnership": {
        "turns": ["Can I freeze the account before he takes everything?"],
    },
    "other-02-breach-of-contract": {
        "turns": ["The client is now saying my work was not up to standard."],
    },
    "other-03-defamation-damages": {
        "turns": ["Can they really get 50 million from me?"],
        "turn_checks": [{"turn": 1, "should_mention": ["depends", "lawyer", "court", "prove"]}],
    },
    "other-04-inheritance-no-will": {
        "turns": ["The first wife is claiming everything for her children alone."],
    },
    "other-05-neighbour-dispute-noise": {
        "turns": ["The police came once but did nothing. What else can I do?"],
    },
    "other-06-child-protection": {
        "turns": ["Can I report anonymously?"],
    },
    "other-07-school-dispute": {
        "turns": ["Can I also report the school to the Ministry of Education?"],
    },
    "other-08-government-agency-dispute": {
        "turns": ["I want my goods back or my money. Which court handles this?"],
    },
    "other-09-immigration-visa": {
        "turns": ["Can we stop his deportation while we sort the papers?"],
    },
    "other-10-intellectual-property": {
        "turns": ["The fakes are now selling more than my original product."],
    },
    "other-11-road-accident": {
        "turns": ["I found the danfo at the motor park. What should I do now?"],
    },
    "other-12-medical-negligence": {
        "turns": ["How do I get my mother's medical records from the hospital?"],
    },
    "other-13-community-land-chieftaincy": {
        "turns": ["The court already gave a judgement but one side is not obeying it."],
    },
    "other-14-court-procedure-newbie": {
        "turns": ["Do I need a lawyer to file the case, or can I do it myself?"],
    },
    "other-15-complex-multi-party-fraud": {
        "turns": ["We have a meeting tomorrow to decide next steps. What should we agree on?"],
    },
}
