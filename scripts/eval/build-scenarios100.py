#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Merge the per-category scenario files into server/eval/scenarios100.json
and validate counts / schema."""
import json, os, sys, importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))

def load(module_name, filename):
    spec = importlib.util.spec_from_file_location(module_name, os.path.join(HERE, filename))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

FILES = [
    ("POLICE_TENANCY", "scen_police_tenancy.py"),
    ("EMPLOYMENT_FAMILY", "scen_employment_family.py"),
    ("CONSUMER_CYBER", "scen_consumer_cyber.py"),
    ("PROPERTY_HUMANRIGHTS", "scen_property_humanrights.py"),
    ("OTHER", "scen_other.py"),
]

scenarios = []
for var, fname in FILES:
    mod = load(var.split("_")[0].lower(), fname)
    arr = getattr(mod, var)
    scenarios.extend(arr)

# Apply follow-up turn patches (spec §5-7: follow-ups, reveals, contradictions).
patches_mod = load("patches", "scen_patches.py")
PATCHES = patches_mod.PATCHES
by_id = {s["id"]: s for s in scenarios}
for sid, patch in PATCHES.items():
    if sid not in by_id:
        print(f"WARNING: patch for unknown scenario {sid}")
        continue
    s = by_id[sid]
    s["turns"].extend(patch.get("turns", []))
    if patch.get("turn_checks"):
        s.setdefault("turn_checks", []).extend(patch["turn_checks"])
    for t in patch.get("tags", []):
        if t not in s.get("tags", []):
            s.setdefault("tags", []).append(t)

# ── Validation ──────────────────────────────────────────────────────────────
ids = [s["id"] for s in scenarios]
assert len(ids) == len(set(ids)), "Duplicate scenario ids: %s" % \
    [i for i in set(ids) if ids.count(i) > 1]

CATEGORY_TARGETS = {
    "police_criminal": 15,
    "tenancy": 10,
    "employment": 10,
    "family_law": 10,
    "consumer_money": 10,
    "cyber_privacy": 10,
    "land_property": 10,
    "human_rights": 10,
    "other": 15,
}
from collections import Counter
counts = Counter(s["category"] for s in scenarios)
print("Category counts:")
for cat, want in CATEGORY_TARGETS.items():
    got = counts.get(cat, 0)
    flag = "OK" if got == want else "MISMATCH"
    print(f"  {cat}: {got}/{want} {flag}")

total_turns = 0
followup_scenarios = 0
for s in scenarios:
    assert isinstance(s["turns"], list) and len(s["turns"]) >= 1, s["id"]
    assert all(isinstance(t, str) and t.strip() for t in s["turns"]), s["id"]
    assert isinstance(s["expected"], dict), s["id"]
    total_turns += len(s["turns"])
    if len(s["turns"]) >= 3:
        followup_scenarios += 1

print(f"\nTotal scenarios: {len(scenarios)}")
print(f"Total turns: {total_turns}")
print(f"Scenarios with >=3 turns (follow-ups): {followup_scenarios}")

out = {
    "meta": {
        "version": "2.0.0",
        "name": "Legally Unbullied — 100 Real-World Conversation Evaluation",
        "description": "100 multi-turn, realistic Nigerian legal conversations scored across 8 dimensions.",
        "scenario_count": len(scenarios),
        "generated_at": None,
    },
    "scenarios": scenarios,
}

out_path = os.path.join(HERE, "..", "..", "server", "eval", "scenarios100.json")
out_path = os.path.abspath(out_path)
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)

print(f"\nWrote {out_path} ({os.path.getsize(out_path)} bytes)")
