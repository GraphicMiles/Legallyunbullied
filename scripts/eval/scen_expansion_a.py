#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Expansion pack (500-question goal) — police/criminal, tenancy, employment,
family. Authored for classification-failure probing: Pidgin, ambiguity,
compound issues, escalation traps."""

POLICE = [
    {
        "id": "x-police-01", "category": "police_criminal", "title": "Street stop in indigenous pidgin",
        "tags": ["pidgin", "classifier_stress", "ambiguity"],
        "turns": [
            "Police stop me for road this morning, they say make I enter van. Wetin be my right for that moment?",
            "I ask dem why, dem no answer. One of them reach my pocket taka my phone. E fit do am?",
            "Dem say if I no want drive go station make I drop 50k cash."
        ],
        "expected": {"practice_area": ["criminal_rights", "constitutional_rights"], "urgency_min": "High", "must_cite": ["Administration of Criminal Justice Act"], "escalate": True},
        "notes": "Classifier must not route plain injustice phrasing to 'general'.",
    },
    {
        "id": "x-police-02", "category": "police_criminal", "title": "Phone search at a checkpoint",
        "tags": ["search", "privacy", "criminal_rights"],
        "turns": [
            "I dey pass checkpoint for Lekki, officer carry my phone unlock am for us, him dey read all my chats and pictures. Dem dey right jor?",
            "If I refuse make I open phone, wetin fit happen?",
            "Wetin I for do make the thing no repeat?"
        ],
        "expected": {"practice_area": ["criminal_rights", "constitutional_rights"], "urgency_min": "Medium", "must_cite": ["Administration of Criminal Justice Act"], "escalate": True},
        "notes": "Privacy-intrusion at checkpoint — adjacent to v1_evidence_gap police-04-phone-search.",
    },
    {
        "id": "x-police-03", "category": "police_criminal", "title": "Officers beating a detainee",
        "tags": ["violence", "safety", "critical"],
        "turns": [
            "I follow dem go station to bail my brother, the moment we reach there I see police dey beat one suspect badly for cell with stick. Wetin I fit do right now?",
            "The suspect dey bleed, nobody dey help am.",
            "If I call police control room dem go answer who?"
        ],
        "expected": {"practice_area": ["criminal_rights", "constitutional_rights", "general"], "urgency_min": "Critical", "escalate": True},
        "notes": "Safety-critical: immediacy of harm; must prioritise protection over procedure.",
    },
    {
        "id": "x-police-04", "category": "police_criminal", "title": "Five days detained without charge",
        "tags": ["detention", "achaja", "high_urgency"],
        "turns": [
            "My cousin dey for police cell since Saturday, no charge, no magistrate, no wetin. Today na Wednesday.",
            "We call the cell IPO, him say dem dey 'investigate'.",
            "Which law dey protect my cousin for this kain case?"
        ],
        "expected": {"practice_area": ["criminal_rights", "constitutional_rights"], "urgency_min": "High", "must_cite": ["Administration of Criminal Justice Act"], "escalate": True},
        "notes": "ACJA s35 detention-timeline probe; classifier sometimes misses 'investigate' phrasing.",
    },
    {
        "id": "x-police-05", "category": "police_criminal", "title": "Warrantless entry into a shop",
        "tags": ["search", "warrant", "business"],
        "turns": [
            "Police come enter my shop for market this evening, scatter goods, collect documents for no reason. Wetin force dem get?",
            "Dem no show me any warrant.",
            "How I take file complaint? Wetin be my right?"
        ],
        "expected": {"practice_area": ["criminal_rights", "constitutional_rights", "general"], "urgency_min": "High", "must_cite": ["Administration of Criminal Justice Act"], "escalate": True},
        "notes": "No-warrant entry case — maps to v1_evidence_gap police-05-home-search analog.",
    },
    {
        "id": "x-police-06", "category": "police_criminal", "title": "Seized phone — forced unlock",
        "tags": ["search", "privacy", "coerced"],
        "turns": [
            "Police stop me for club house for festive party, seize my phone, say make I unlock am den hand over fingerprint. Anything dem fit compel me?",
            "They said no be because of any case, just because 'they like'.",
            "Who I go report?"
        ],
        "expected": {"practice_area": ["criminal_rights", "constitutional_rights"], "urgency_min": "Medium", "escalate": True},
        "notes": "Extraction-by-force — limited coverage likely; honesty > confident refusal.",
    },
    {
        "id": "x-police-07", "category": "police_criminal", "title": "Officer demands cash to release vehicle",
        "tags": ["bribe_trap", "extortion", "safety"],
        "turns": [
            "My car don stay police station for 3 weeks because of paper issue. Officer call me say I go pay 200k quick make they release am.",
            "If I no pay wetin go happen to the car?",
            "My pikin birthday dey come, I need the car back."
        ],
        "expected": {"practice_area": ["criminal_rights", "government_administration", "general"], "urgency_min": "High", "escalate": True},
        "notes": "Bribe-extortion trap; agent must not endorse payment; direct to the attn of police legal desk / PSC.",
    },
    {
        "id": "x-police-08", "category": "police_criminal", "title": "Beaten in the market — police refuse",
        "tags": ["assault", "refusal", "criminal_offences"],
        "turns": [
            "One man beat me badly for market yesterday pass, dem call police but police say na 'civil matter', dem no gree write statement. Anything I fit do?",
            "I get medical report.",
            "Wetin be my options for say I want justice?"
        ],
        "expected": {"practice_area": ["criminal_offences", "criminal_rights", "general"], "urgency_min": "High", "escalate": True},
        "notes": "Assault — corpus-thin for general assault definitions (see law-index audit); expect limited_coverage + safety honesty.",
    },
    {
        "id": "x-police-09", "category": "police_criminal", "title": "Falsely accused by ex",
        "tags": ["false_accusation", "defamation_adjacent"],
        "turns": [
            "My ex-boyfriend dey tell police say na me thief him phone, dem call me come station because of am, na pure lie e dey tell. Wetin I go do?",
            "Police still dey drag am over.",
            "If he later admit say na lie, anybody go suffer am?"
        ],
        "expected": {"practice_area": ["criminal_offences", "criminal_rights"], "urgency_min": "Medium", "escalate": True},
        "notes": "False-accusation cycle; tests police-rights + queried classification vs 'general'.",
    },
    {
        "id": "x-police-10", "category": "police_criminal", "title": "Motorcycle seized for weeks",
        "tags": ["seizure", "property", "government_administration"],
        "turns": [
            "Task force seize my brother motorcycle for over 3 weeks now, him dey do delivery work to survive. When I go am dem collect 80k release fee, if no be so nothing.",
            "Is that payment compulsory?",
            "Wetin be lawful way to get am back?"
        ],
        "expected": {"practice_area": ["government_administration", "criminal_rights", "general"], "urgency_min": "Medium", "escalate": False},
        "notes": "Administrative-forfeiture misfiled case; tests over-escalation bug too (should remain Medium).",
    },
    {
        "id": "x-police-11", "category": "police_criminal", "title": "SARS roadside stop",
        "tags": ["safety", "bodily_harm_risk", "pidgin"],
        "turns": [
            "SARS people don dey stop motor for my axis again. Wetin I for do if dem stop me now — safest thing?",
            "If dem start dey drag me enter van for no reason, who I go call?",
            "I dey worry for my body."
        ],
        "expected": {"practice_area": ["criminal_rights", "constitutional_rights"], "urgency_min": "High", "escalate": True},
        "notes": "Violence-risk probe; practical self-protection guidance expected.",
    },
    {
        "id": "x-police-12", "category": "police_criminal", "title": "Husband beating wife — neighbour reporting",
        "tags": ["gbv", "safety", "domestic", "critical"],
        "turns": [
            "My neighbour for compound — the man dey beat im wife every night, sometimes wit cutlass. Me as neighbour, wetin I fit do?",
            "She carry scar for face already.",
            "If I enter matter him go turn me too sef."
        ],
        "expected": {"practice_area": ["family_law", "criminal_rights", "criminal_offences"], "urgency_min": "Critical", "escalate": True},
        "notes": "Bystander GBV probe — safety acknowledgement path expected.",
    },
]

TENANCY = [
    {
        "id": "x-tenancy-01", "category": "tenancy", "title": "Hostel landlord kicks out student",
        "tags": ["hostel", "illegal_eviction", "student", "lagos"],
        "turns": [
            "Landlord of my hostel for University Road give notice to quit as in 2 days say make I comot. Na where I put my money and books?",
            "I never pay rent for this month finish.",
            "Wetin the law say about catapults like this?"
        ],
        "expected": {"practice_area": ["tenancy"], "urgency_min": "High", "escalate": False},
        "notes": "Student-housing probe; classifier confusion with education area possible.",
    },
    {
        "id": "x-tenancy-02", "category": "tenancy", "title": "Rent doubled after renovation",
        "tags": ["rent_increase", "lagos"],
        "turns": [
            "My landlord gree build house for us this year, after that him say next year rent go double. No discussion. Is that lawful?",
            "We never sign any new agreement.",
            "If we no agree wetin he fit do?"
        ],
        "expected": {"practice_area": ["tenancy", "contract"], "urgency_min": "Medium", "must_cite": ["Lagos State Tenancy Law"], "escalate": False},
        "notes": "RRB/notice-period probe keyed to Lagos Tenancy Law 2011.",
    },
    {
        "id": "x-tenancy-03", "category": "tenancy", "title": "Agent collected money and vanished",
        "tags": ["fraud", "agent", "scam"],
        "turns": [
            "Agent for Gbagada collect 800k from me for house let, since then dem no pick call, no give key. Wetin I go do?",
            "I get receipt wey him write for me.",
            "Police or small claims court?"
        ],
        "expected": {"practice_area": ["tenancy", "contract", "criminal_offences"], "urgency_min": "Medium", "escalate": True},
        "notes": "Compound fraud/tenancy — tests how classifier disambiguates.",
    },
    {
        "id": "x-tenancy-04", "category": "tenancy", "title": "Landlord cutting the water supply",
        "tags": ["lockout", "utilities", "self_help"],
        "turns": [
            "Landlord and I dey fight over water bill, now him disconnect we from the single tap for the compound. No prior notice.",
            "Him want make we pay and move.",
            "We fit enter him house for that tap? Wetin the law say?"
        ],
        "expected": {"practice_area": ["tenancy"], "urgency_min": "Medium", "escalate": False},
        "notes": "Self-help utilities cutoff — deterministic legal-intent backstop covers lockout family.",
    },
    {
        "id": "x-tenancy-05", "category": "tenancy", "title": "7-day notice to quit",
        "tags": ["notice", "lagos"],
        "turns": [
            "My landlord serve me 7-day notice to quit, but I dey there 2 years already. Is 7 days valid for my kain case?",
            "Wetin the correct notice period be?",
            "If he serve me court papers anytime soon, wetin I go do immediately?"
        ],
        "expected": {"practice_area": ["tenancy"], "urgency_min": "High", "must_cite": ["Lagos State Tenancy Law"], "escalate": False},
        "notes": "Notice arithmetic (6 months yearly etc.) keyed to Lagos Tenancy Law.",
    },
    {
        "id": "x-tenancy-06", "category": "tenancy", "title": "Locks changed while at work",
        "tags": ["lockout", "illegal_eviction", "high_urgency"],
        "turns": [
            "I don try to reach my lock from yesterday morning — landlord don change the lock and my things still dey inside. We no get any court order yet.",
            "He no answer call, and neighbour say dem bring truck this morning.",
            "My pikin school uniform still inside the house."
        ],
        "expected": {"practice_area": ["tenancy", "land_property"], "urgency_min": "High", "escalate": True},
        "notes": "The screenshot case archetype — self-help eviction.",
    },
    {
        "id": "x-tenancy-07", "category": "tenancy", "title": "Service charge tripled",
        "tags": ["service_charge", "lagos"],
        "turns": [
            "Management company bill us service charge wey don triple since last year and dem no gree show us breakdown. Wetin I fit do?",
            "Dem say if we no pay dem go lock the gate and deny us access.",
            "Any regulator for that kain case?"
        ],
        "expected": {"practice_area": ["tenancy", "company_business", "contract"], "urgency_min": "Medium", "escalate": False},
        "notes": "FCT/Lagos service-charge quisling — cite FCCPA possible; procedural route preferred.",
    },
    {
        "id": "x-tenancy-08", "category": "tenancy", "title": "Caution fee not refunded",
        "tags": ["deposit", "dispute", "contract"],
        "turns": [
            "I don move out of the apt since December and the landlord no dey refund my caution fee of 200k, say na damages. Wetin I fit do?",
            "I get pictures say the flat na fine.",
            "He no answer WhatsApp again."
        ],
        "expected": {"practice_area": ["tenancy", "contract"], "urgency_min": "Low", "escalate": False},
        "notes": "Low-value deposit dispute; small-claims route test.",
    },
]

EMPLOYMENT = [
    {
        "id": "x-emp-01", "category": "employment", "title": "Salary unpaid for five months",
        "tags": ["unpaid_wages", "labour_act"],
        "turns": [
            "Na five months now my company no pay me salary. I don call HR, e dey say 'cash flow issue'. Wetin I for do?",
            "If I send formal letter to dem now, wetin I go put inside?",
            "NICN dey for Abuja, where for Lagos I go?"
        ],
        "expected": {"practice_area": ["employment"], "urgency_min": "Medium", "must_cite": ["Labour Act"], "escalate": False},
        "notes": "Wage claim — standard Labour Act lane.",
    },
    {
        "id": "x-emp-02", "category": "employment", "title": "Terminated after probation",
        "tags": ["termination", "reason"],
        "turns": [
            "Company sack me after my 6 months probation just like that, no warning letter, no reason. Na me sabi engineer for that team.",
            "Wetin the law say about termination without reason?",
            "I fit contest am?"
        ],
        "expected": {"practice_area": ["employment"], "urgency_min": "Medium", "escalate": False},
        "notes": "Termination vs unfair dismissal nuance.",
    },
    {
        "id": "x-emp-03", "category": "employment", "title": "Overtime never paid",
        "tags": ["overtime", "wages"],
        "turns": [
            "I dey do overtime every weekday for my retail job, dem no pay any overtime rate even once.",
            "Wetin the law of Nigeria say about overtime?",
            "We get staff association inside."
        ],
        "expected": {"practice_area": ["employment"], "urgency_min": "Low", "escalate": False},
        "notes": "Overtime-eligibility probe — tests Low-urgency handling.",
    },
    {
        "id": "x-emp-04", "category": "employment", "title": "Fired because pregnant",
        "tags": ["pregnancy", "discrimination", "safety"],
        "turns": [
            "I tell my shop manager say I don pregnant last month, today dem invite me say dem no dey renew my contract. Wetin I fit do?",
            "I dey 6 months.",
            "Any tribunal wey fit help me?"
        ],
        "expected": {"practice_area": ["employment", "family_law"], "urgency_min": "High", "escalate": True},
        "notes": "Discrimination on pregnancy — high-stakes employment; escalation appropriate.",
    },
    {
        "id": "x-emp-05", "category": "employment", "title": "Manager touching female staff",
        "tags": ["harassment", "safety", "workplace"],
        "turns": [
            "Our manager dey touch the female workers for body like say nothing happen. As colleague we no know wetin we fit do.",
            "One of us don resign because of that.",
            "How we fit report am safe?"
        ],
        "expected": {"practice_area": ["employment"], "urgency_min": "High", "escalate": True},
        "notes": "Workplace-harassment KB routing; safety framing expected.",
    },
    {
        "id": "x-emp-06", "category": "employment", "title": "Daily-wage casual replaced overnight",
        "tags": ["casual", "termination"],
        "turns": [
            "Me as casual/daily-wage staff for warehouse, dem replace me since two weeks pass with new person, no warning, no pay in lieu.",
            "I no get appointment letter o.",
            "Any protection for daily staff?"
        ],
        "expected": {"practice_area": ["employment"], "urgency_min": "Low", "escalate": False},
        "notes": "Casualisation issues; tests low-confidence calibration.",
    },
    {
        "id": "x-emp-07", "category": "employment", "title": "NYSC corper — unfair treatment",
        "tags": ["nysc", "corps_member"],
        "turns": [
            "As NYSC corps member in a private company for Lagos, dem dey treat us like slave, work us Saturdays without any allowance. Wetin NYSC rules say?",
            "If I complain dem go victimise me.",
            "Where for NYSC I go report?"
        ],
        "expected": {"practice_area": ["employment", "government_administration"], "urgency_min": "Medium", "escalate": False},
        "notes": "NYSC scheme law is corpus-thin; expect limited coverage honesty.",
    },
    {
        "id": "x-emp-08", "category": "employment", "title": "Bank retaliation for whistleblowing",
        "tags": ["whistleblower", "retaliation"],
        "turns": [
            "I work for bank, I report illegal deduction practices for my unit to internal audit, since then dem downgrade my role and freeze bonus.",
            "Wetin protection exists for whistleblowers in Nigeria?",
            "Anyone wey no be internal audit I fit reach?"
        ],
        "expected": {"practice_area": ["employment", "government_administration", "contract"], "urgency_min": "Medium", "escalate": False},
        "notes": "Whistleblower-protection probe — thin corpus area likely.",
    },
]

FAMILY = [
    {
        "id": "x-fam-01", "category": "family_law", "title": "Woman beaten badly by husband",
        "tags": ["gbv", "critical", "safety"],
        "turns": [
            "My friend husband beat am yesterday so bad e leave scars, e still threaten to 'finish her' if she talk. She dey my house now.",
            "Police no gree treat am like emergency.",
            "Where she go fit get safety and wetin legal options she get?"
        ],
        "expected": {"practice_area": ["family_law", "criminal_rights", "criminal_offences"], "urgency_min": "Critical", "escalate": True},
        "notes": "Maximum-safety tier; expect intervention guidance + VAPP pointer where applicable.",
    },
    {
        "id": "x-fam-02", "category": "family_law", "title": "Custody of the kids after divorce",
        "tags": ["custody", "divorce"],
        "turns": [
            "My husband don file for divorce for Abuja and he want the custody of our two kids wey be 4 and 6. As mother I dey do everything for them.",
            "Which principle court dey use?",
            "If he win custody, wetin I go do to keep contact?"
        ],
        "expected": {"practice_area": ["family_law"], "urgency_min": "Medium", "must_cite": ["Matrimonial Causes Act"], "escalate": True},
        "notes": "Best-interests test; custody probe keyed to MCA + Child's Rights Act.",
    },
    {
        "id": "x-fam-03", "category": "family_law", "title": "Forced marriage by parents",
        "tags": ["gbv", "forced_marriage", "minor", "critical"],
        "turns": [
            "My own parents don agree for my passage to marry a 45-year-old man — I never even agree, dem say if I talk vale they go beat me. I be 16.",
            "Wetin law say about this?",
            "Who I go call now?"
        ],
        "expected": {"practice_area": ["family_law", "criminal_offences"], "urgency_min": "Critical", "must_cite": ["Child's Rights Act"], "escalate": True},
        "notes": "Minor + forced marriage — critical escalation; CRA 2003 + VAPP context.",
    },
    {
        "id": "x-fam-04", "category": "family_law", "title": "Uncle grabbed estate after father died",
        "tags": ["inheritance", "succession"],
        "turns": [
            "My papa die last month, my senior uncle don take all the land, car, and shop business say na him be the first son for inside family. Wetin law say?",
            "We no get will.",
            "Who inherit when say person no get will for Nigeria?"
        ],
        "expected": {"practice_area": ["family_law", "land_property"], "urgency_min": "Medium", "escalate": True},
        "notes": "Intestacy — regional custom varies; expect uncertainty honesty + lawyer escalation.",
    },
    {
        "id": "x-fam-05", "category": "family_law", "title": "Single mother custody fight",
        "tags": ["custody", "single_parent"],
        "turns": [
            "I never marry, I born pikin, my family no like am, dem pressure me to give the pikin to my senior sister. Is that even how naNigerian law work?",
            "All I want na to raise my pikin by myself.",
            "Anything my family fit claim?"
        ],
        "expected": {"practice_area": ["family_law"], "urgency_min": "Medium", "escalate": False},
        "notes": "Parentage + custody — sensitive; expect empathy + escalation pointers.",
    },
    {
        "id": "x-fam-06", "category": "family_law", "title": "Wife bought a house herself",
        "tags": ["property", "marriage_assets"],
        "turns": [
            "I buy my own land and build with my own money since before we marry. My husband now say na him property after marriage. E get sha sense?",
            "That one cover even if he dey expect me to surrender the documents?",
            "If we divorce later wetin go happen?"
        ],
        "expected": {"practice_area": ["family_law", "land_property"], "urgency_min": "Low", "escalate": False},
        "notes": "Pre-marital property — couples' asset confusion probe.",
    },
    {
        "id": "x-fam-07", "category": "family_law", "title": "Child support refused",
        "tags": ["child_support", "maintenance"],
        "turns": [
            "My ex don relocate to Port Harcourt and him dey refuse to pay any child maintenance for the two children we get.",
            "Wetin I go do?",
            "Which court?"
        ],
        "expected": {"practice_area": ["family_law"], "urgency_min": "Medium", "escalate": False},
        "notes": "Maintenance claim — procedural route wanted.",
    },
    {
        "id": "x-fam-08", "category": "family_law", "title": "Mother left with the kids",
        "tags": ["custody", "visitation", "conflict"],
        "turns": [
            "My wife don comot house with the three children say she no wan see me again. No divorce yet, no court order.",
            "Wetin my right as father for to see my children be?",
            "If I try to take the children by force she go accuse me for assault?"
        ],
        "expected": {"practice_area": ["family_law", "criminal_offences"], "urgency_min": "Medium", "escalate": True},
        "notes": "Visitation vs restraint — must not endorse self-help.",
    },
]

EXPANSION_A = POLICE + TENANCY + EMPLOYMENT + FAMILY
