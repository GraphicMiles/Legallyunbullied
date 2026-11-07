#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Expansion pack C — top up to ~500 question turns."""

TOPUP = [
    {
        "id": "x-prop-01", "category": "land_property", "title": "Compulsory acquisition, tiny compensation",
        "tags": ["compulsory_acquisition", "government"],
        "turns": [
            "Government compulsorily acquire our family land at Ikorodu for road project. Dem offer us amount wey no reach half the market price. Wetin law wey Nigeria obey say?",
            "Wetin I fit challenge?",
            "How long the process take?"
        ],
        "expected": {"practice_area": ["land_property", "constitutional_rights", "government_administration"], "urgency_min": "Medium", "escalate": True},
        "notes": "Land Use Act/compensation probe — sparse corpus area; honesty test.",
    },
    {
        "id": "x-tax-01", "category": "other", "title": "FIRS arbitrary assessment",
        "tags": ["tax", "arbitrary_assessment"],
        "turns": [
            "FIRS send me assessment of 18 million for my small business wey I never even make near that money — pure fabrication. When I appeal dem no do anything, dem threaten to freeze my account. Wetin I go do?",
            "Wetin remedies I get?",
            "Which court handles these matters?"
        ],
        "expected": {"practice_area": ["tax_finance", "government_administration"], "urgency_min": "High", "escalate": True},
        "notes": "Tax-arbiter lane — corpus thin; escalation + honesty.",
    },
    {
        "id": "x-imm-01", "category": "other", "title": "Expired passport — child stuck abroad",
        "tags": ["passport", "consular", "urgency"],
        "turns": [
            "My child wey follow me go Cameroon for holiday, him passport don expire and wetin we go do quick make we no strand. The consulate dey move slow. Wetin fit happen if him stay without valid passport?",
            "Wetin we fit do now?",
            "Any urgency weh authorities go help in kain situation?"
        ],
        "expected": {"practice_area": ["immigration_citizenship", "government_administration"], "urgency_min": "High", "escalate": False},
        "notes": "Consular-emergency adjacency; urgency-vs-package calibration probe.",
    },
]

EXPANSION_C = TOPUP
