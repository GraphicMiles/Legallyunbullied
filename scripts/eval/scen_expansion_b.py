#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Expansion pack B — consumer, cyber, land, human rights, other."""

CONSUMER = [
    {
        "id": "x-con-01", "category": "consumer_money", "title": "Mechanic wrecked the car",
        "tags": ["service", "consumer_remedy"],
        "turns": [
            "Mechanic collect my car for engine repair, since him finish am my car no still gree move like before, him dey frustrate me say I no sabi anything.",
            "I pay 350k already.",
            "Wetin law fit help me for this kain matter?"
        ],
        "expected": {"practice_area": ["consumer_rights", "contract"], "urgency_min": "Low", "escalate": False},
        "notes": "Service-defect claim; arbitration/small claims lane.",
    },
    {
        "id": "x-con-02", "category": "consumer_money", "title": "Online vendor took the money",
        "tags": ["online", "fraud_adjacent"],
        "turns": [
            "Instagram vendor collect 120k for goods, block me after I pay. I get chat logs and receipt.",
            "Where for law I go?",
            "Police or customer dispute?"
        ],
        "expected": {"practice_area": ["consumer_rights", "contract", "criminal_offences"], "urgency_min": "Medium", "escalate": False},
        "notes": "Online-fraud disambiguation; consumer_rights primary lane.",
    },
    {
        "id": "x-con-03", "category": "consumer_money", "title": "Loan app harassing my contacts",
        "tags": ["loan_app", "harassment", "privacy"],
        "turns": [
            "I borrow small money from one loan app, since that time dem dey message and call everybody for my contact list, tell them say I be thief. Wetin I fit do?",
            "Even my pastor don get the message.",
            "Any law against that?"
        ],
        "expected": {"practice_area": ["consumer_rights", "criminal_offences"], "urgency_min": "High", "escalate": True},
        "notes": "The loan-app harassment probe — Cap account corridor + cyber route adjacency.",
    },
    {
        "id": "x-con-04", "category": "consumer_money", "title": "DisCobilling wrong amounts",
        "tags": ["utility", "billing"],
        "turns": [
            "Electricity company bring bill wey be 3 times the usual — I complain 3 times, dem no talk anything, now dem say dem go disconnect me.",
            "No meter reading was done.",
            "Wetin regulator fit do for me?"
        ],
        "expected": {"practice_area": ["consumer_rights", "government_administration"], "urgency_min": "Low", "escalate": False},
        "notes": "NERC complaint route probe.",
    },
    {
        "id": "x-con-05", "category": "consumer_money", "title": "Failed bank transfer — money deducted",
        "tags": ["bank", "reversal"],
        "turns": [
            "I do transfer of 500k, the receiver no get am but my account don get debit, bank customer care line dey loop since two weeks now. Wetin I go do?",
            "Na one bank the both of us dey use.",
            "Which regulator I go?"
        ],
        "expected": {"practice_area": ["consumer_rights", "contract"], "urgency_min": "Medium", "escalate": False},
        "notes": "CBN/consumer dispute escalation ladder.",
    },
    {
        "id": "x-con-06", "category": "consumer_money", "title": "Betting company refuses my win",
        "tags": ["betting", "payout"],
        "turns": [
            "I win 2.5 million naira for bet platform, dem suspend my account say na 'examination' and dem no pay. Anyone I fit complain to?",
            "Dem say I violate terms, but na normal bet.",
            "I fit sue dem?"
        ],
        "expected": {"practice_area": ["consumer_rights", "contract", "company_business"], "urgency_min": "Medium", "escalate": False},
        "notes": "New-economy consumer dispute; contract lane adjacency.",
    },
]

CYBER = [
    {
        "id": "x-cyber-01", "category": "cyber_privacy", "title": "Ex-boyfriend leaked my nude photos",
        "tags": ["revenge_porn", "critical", "safety"],
        "turns": [
            "My ex-boyfriend don post my naked pictures for group chat and some websites and he say he go send to my family. I don tell police and dem say na 'criminal matter', dem no gree treat am. Wetin I go do?",
            "He dey threaten to post more.",
            "How I save myself now?"
        ],
        "expected": {"practice_area": ["criminal_offences", "criminal_rights"], "urgency_min": "Critical", "escalate": True},
        "notes": "Non-consensual intimate image — maximum safety; cyber-offence lane.",
    },
    {
        "id": "x-cyber-02", "category": "cyber_privacy", "title": "Account hacked — savings gone",
        "tags": ["fraud", "hack"],
        "turns": [
            "My bank account don cool down completely today — OTP scam, transfer out of everything, 3.2 million naira. Wetin I go do first?",
            "The bank say I will make request, and make request na complaint. Wetin now?",
            "Wetin make I do immediately?"
        ],
        "expected": {"practice_area": ["criminal_offences", "consumer_rights"], "urgency_min": "Critical", "escalate": True},
        "notes": "Financial fraud + cyber; wet-urgency immediate-steps check (bank freeze priority).",
    },
    {
        "id": "x-cyber-03", "category": "cyber_privacy", "title": "WhatsApp cloned — contacts defrauded",
        "tags": ["impersonation", "fraud"],
        "turns": [
            "Somebody don clone my WhatsApp and him dey message all my contacts say dem should send money to a certain account. Wetin I go do now?",
            "People don don already send money.",
            "How I report am?"
        ],
        "expected": {"practice_area": ["criminal_offences"], "urgency_min": "High", "escalate": True},
        "notes": "Impersonation fraud; cyber-offences + immediate damage-control guidance.",
    },
]

LAND = [
    {
        "id": "x-land-01", "category": "land_property", "title": "Forged land documents by family member",
        "tags": ["forgery", "family_land"],
        "turns": [
            "My uncle don sell my papa land using forged documents say the family quota him get. Inside those documents my own name and my brother no dey at all.",
            "We get the original from my papa's time.",
            "Which court fit nullify the sale?"
        ],
        "expected": {"practice_area": ["land_property", "family_law", "criminal_offences"], "urgency_min": "High", "escalate": True},
        "notes": "Compound forgery+succession case — classifier adjacency stress.",
    },
    {
        "id": "x-land-02", "category": "land_property", "title": "Developer disappeared with deposit",
        "tags": ["off_plan", "developer"],
        "turns": [
            "I pay 12 million naira deposit for off-plan apartment, construction no start after 2 years, developer no respond, dem dey shift time for beach. Wetin I go do?",
            "We get MOU for the project.",
            "Can I drag the developer for court?"
        ],
        "expected": {"practice_area": ["land_property", "contract", "company_business"], "urgency_min": "Medium", "escalate": True},
        "notes": "Off-plan consumer/property hybrid; auth high-relevance.",
    },
    {
        "id": "x-land-03", "category": "land_property", "title": "Boundary fight with neighbour",
        "tags": ["boundary", "neighbour"],
        "turns": [
            "My neighbour for village build fence encroach into our land by almost two metres. My papa warn dem 3 times, dem no shift.",
            "The land community land, share coterie.",
            "Wetin we go do for court?"
        ],
        "expected": {"practice_area": ["land_property", "general"], "urgency_min": "Low", "escalate": False},
        "notes": "Boundary dispute — low urgency; surveyor + customary court orientation.",
    },
    {
        "id": "x-land-04", "category": "land_property", "title": "Split-family C of O contest",
        "tags": ["c_of_o", "family_property"],
        "turns": [
            "Our father get one big C of O land for Ikeja before he die. Two of my siblings don obtain C of O doc for their own portion without we knowing — any way to challenge that?",
            "That thing wrong totally.",
            "Where I go report?"
        ],
        "expected": {"practice_area": ["land_property", "family_law"], "urgency_min": "Medium", "escalate": True},
        "notes": "C of O challenge; family land documentation fight.",
    },
    {
        "id": "x-land-05", "category": "land_property", "title": "Police-backed land grabbers",
        "tags": ["grabber", "safety", "violence"],
        "turns": [
            "Land grabbers wey get police protection for Igando enter our land the morning with gun and big cutlass, dem pursue the workers comot, dem dey build now. We fit do wetin?",
            "Police no answer emergency call.",
            "Our family dey afraid."
        ],
        "expected": {"practice_area": ["land_property", "criminal_rights", "criminal_offences"], "urgency_min": "Critical", "escalate": True},
        "notes": "Violent land grab — safety escalation; weapon-level harm.",
    },
    {
        "id": "x-land-06", "category": "land_property", "title": "Landlord into the land fight after tenant sale",
        "tags": ["title_defect", "fraud"],
        "turns": [
            "I buy a land from someone wey call himself 'agent', before I finish build two pillars my landlord bring document say the land na him family own and the agent no get right to sell. Wetin I fit do?",
            "All my money inside that land.",
            "How I recover am?"
        ],
        "expected": {"practice_area": ["land_property", "contract", "criminal_offences"], "urgency_min": "Medium", "escalate": True},
        "notes": "Title defect — bonafide purchaser probe.",
    },
]

HR = [
    {
        "id": "x-hr-01", "category": "human_rights", "title": "Agency refuses my FOI request",
        "tags": ["foi", "government"],
        "turns": [
            "I write one federal agency requesting documents about our community land acquisition for my association, dem no answer me nothing since 6 weeks. Any law force dem to respond?",
            "We get the community's interest for matter.",
            "Wetin remedy if dem refuse?"
        ],
        "expected": {"practice_area": ["government_administration", "constitutional_rights"], "urgency_min": "Low", "escalate": False},
        "notes": "FOI Act 2011 lane — administrative remedy ladder.",
    },
    {
        "id": "x-hr-02", "category": "human_rights", "title": "Okadas seized by task force — no receipt",
        "tags": ["seizure", "taskforce"],
        "turns": [
            "Task force seize our motorcycle this morning, no ticket, no receipt, say make we come pay inside their office. Wetin the law say?",
            "Dem dey break the seized motorcycles too.",
            "Where for law I go?"
        ],
        "expected": {"practice_area": ["government_administration", "transport_traffic", "constitutional_rights"], "urgency_min": "Medium", "escalate": False},
        "notes": "Taskforce-seizure probe; administrative law adjacency.",
    },
    {
        "id": "x-hr-03", "category": "human_rights", "title": "Political rally violently dispersed",
        "tags": ["assembly", "politics"],
        "turns": [
            "We get peaceful political gathering for our ward last Saturday, police tear-gassed we without warning and beat people pass. Wetin our right as citizens be?",
            "Anybody dem injure fit get remedy?",
            "Wetin we go do?"
        ],
        "expected": {"practice_area": ["constitutional_rights", "criminal_rights"], "urgency_min": "High", "must_cite": ["Constitution"], "escalate": True},
        "notes": "Assembly/safety + constitutional rights core lane.",
    },
    {
        "id": "x-hr-04", "category": "human_rights", "title": "Denying worship for ID reasons",
        "tags": ["religion", "discrimination"],
        "turns": [
            "School wey my pikin dey deny him entry because say him no wear hijab like the other students. Wetin the law say about that?",
            "The school na private mission school.",
            "Wetin I fit do?"
        ],
        "expected": {"practice_area": ["constitutional_rights", "education"], "urgency_min": "Medium", "escalate": False},
        "notes": "Religion/discrimination probe — education-adjacency classification stress.",
    },
]

OTHER = [
    {
        "id": "x-oth-01", "category": "other", "title": "School sent child home — increase in fees",
        "tags": ["education", "fees"],
        "turns": [
            "My child's school gree bar him because I no fit come up with new fees wey they no warn me about, say na 'self-funded school', so nothing applies. Wetin I go do?",
            "Any consumer angle to this?",
            "If they expel him, wetin I go get?"
        ],
        "expected": {"practice_area": ["education", "consumer_rights", "contract"], "urgency_min": "Medium", "escalate": False},
        "notes": "Mixed service/education probe; corporate-consumer interface.",
    },
    {
        "id": "x-oth-02", "category": "other", "title": "Visa stuck in processing 3 years",
        "tags": ["visa", "immigration"],
        "turns": [
            "I don apoly for British visa since 3 years, no refusal, no approval, no response. I been need to travel for work sickness emergency. Wetin I fit do?",
            "Wetin I fit do to unblock am?",
            "Wetin the law for Nigeria say about that?"
        ],
        "expected": {"practice_area": ["immigration_citizenship"], "urgency_min": "Medium", "escalate": False},
        "notes": "Immigration lane — corpus-thin area; honesty valued.",
    },
    {
        "id": "x-oth-03", "category": "other", "title": "Herdsmen livestock destroyed crops",
        "tags": ["agriculture", "property_damage"],
        "turns": [
            "Livestock wen unknown people lead enter my farm land for Benue, destroy the whole of my maize and rice for the season. I go wetin?",
            "Nobody sabi who lead the animals.",
            "Wetin remedy I get?"
        ],
        "expected": {"practice_area": ["land_property", "environment", "general"], "urgency_min": "High", "escalate": True},
        "notes": "North-central agricultural conflict — safety adjacency; major harm-to-livelihood.",
    },
    {
        "id": "x-oth-04", "category": "other", "title": "Surgery went wrong in private hospital",
        "tags": ["medical_negligence", "safety"],
        "turns": [
            "My wife do a surgery in a private hospital for Lagos, since then her condition buruk drives, doctors no give us explanation, only excuses. Wetin remedy we get?",
            "Na 4 million we pay.",
            "Wetin I fit do legally?"
        ],
        "expected": {"practice_area": ["health", "contract", "consumer_rights"], "urgency_min": "High", "escalate": True},
        "notes": "Medical negligence — malpractice reporting runway; health practice area.",
    },
    {
        "id": "x-oth-05", "category": "other", "title": "Airline lost my luggage with samples",
        "tags": ["air_travel", "carrier_liability"],
        "turns": [
            "My airline lost my bag for a trip to Ghana with 3 million naira worth of sample products for my small business. Complaint line dey loop for weeks, na baggage claim form dem send and nothing, still. Wetin remedy I get?",
            "The airline no call me back.",
            "Wetin law of aviation wey Nigeria obey for this?"
        ],
        "expected": {"practice_area": ["transport_traffic", "consumer_rights", "contract"], "urgency_min": "Medium", "escalate": False},
        "notes": "Montreal-Convention-ish lane — corpus thin; honesty + arbitration ladder.",
    },
    {
        "id": "x-oth-06", "category": "other", "title": "Blogger published false story about me",
        "tags": ["defamation", "media"],
        "turns": [
            "One online blogger write say I be fake doctor and na me kill one patient, but all na lie, and him no ever visit hospital or see any record. Wetin I go do?",
            "The story dey trend on X.",
            "Wetin I fit get as remedy?"
        ],
        "expected": {"practice_area": ["general", "consumer_rights", "contract"], "urgency_min": "Medium", "escalate": True},
        "notes": "Defamation — corpus-thin civil wrong; honesty + lawyer escalation.",
    },
]

EXPANSION_B = CONSUMER + CYBER + LAND + HR + OTHER

DEEP_DIVES = [
    {
        "id": "x-ref-01", "category": "other", "title": "Complex multi-wire fraud confession",
        "tags": ["fraud", "compound", "deep", "cross_area"],
        "turns": [
            "Guy wey I sabi come meet me say him get one business opportunity for importation, him show me documents and convince me to invest 5 million naira. After 3 weeks him no pick call again, I don go his office and na empty. Wetin I go do?",
            "One of him partner call me say the guy don collect from many people, dem dey plan to report am to police.",
            "The partner also suggest make we settle him out of court instead. Wetin I fit trust?",
            "If I go EFCC wetin information I go need to give dem?",
            "Wetin the kain multiple-victim situation mean for my 5 million — anything I go lose?"
        ],
        "expected": {"practice_area": ["criminal_offences", "contract", "consumer_rights", "general"], "urgency_min": "High", "escalate": True},
        "notes": "Deep multi-turn + settlement-pressure trap; tests follow-up reasoning over 5 turns.",
    },
    {
        "id": "x-ref-02", "category": "employment", "title": "Whole staff owed 8 months salaries",
        "tags": ["wages", "collective", "deep"],
        "turns": [
            "My company no pay salary for 8 months now, all of us about 40 staff. Management come so say make we keep patience, dem promise payment last year, no payment.",
            "Wetin we fit do collectively?",
            "If I complain alone dem go sack me — union angle get?",
            "Which courts wey dey handle kain cases for Nigeria?"
        ],
        "expected": {"practice_area": ["employment"], "urgency_min": "High", "escalate": True},
        "notes": "Collective wage claim + union recognition — deep compound follow-ups.",
    },
    {
        "id": "x-ref-03", "category": "family_law", "title": "Contested probate between siblings",
        "tags": ["probate", "inheritance", "deep"],
        "turns": [
            "My grandmother die and she leave will sharing her money between the children equally, but my uncle say him no accept the will because say him get bigger right as the first son.",
            "The family house dem share from the estate also. Wetin probate law say?",
            "My uncle dey threaten to go family set-up to reverse the will.",
            "How long probate normally take for Nigeria?"
        ],
        "expected": {"practice_area": ["family_law", "land_property"], "urgency_min": "Medium", "escalate": True},
        "notes": "Probate + customary pressure — deep inheritance probe.",
    },
    {
        "id": "x-ref-04", "category": "land_property", "title": "Long-running land grab escalation",
        "tags": ["land_grab", "escalation", "deep"],
        "turns": [
            "For 3 years now one land grabber claim say our family land be his own, him don build fence 3 times, each time tornado boom during the rainy season because the pillars dey obey him plan.",
            "Now him bring police to claim the land for himself say our family documents forged.",
            "Wetin I fit do legal now?",
            "And how I go coordinate with my siblings so we no scatter the case for court?",
            "If him no gree stop and wetin if he enter force?"
        ],
        "expected": {"practice_area": ["land_property", "criminal_rights"], "urgency_min": "High", "escalate": True},
        "notes": "Escalating land grab + forged documents + police misuse — hardest compound case.",
    },
]

EXPANSION_B = CONSUMER + CYBER + LAND + HR + OTHER + DEEP_DIVES
