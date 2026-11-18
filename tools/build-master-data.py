#!/usr/bin/env python3
# Build upstream/derived/hajime-master.json from the pinned game master-data dump
# (upstream/gakumasu-diff, see sources.lock.json). Only the tables GHL needs for the
# produce-side systems are extracted: support cards (skills per level, events),
# memory abilities, P-items (challenge / event rewards), the produce trigger/effect
# vocabulary, exam status enchants referenced by them, and every produce card's
# effect groups (for card-category triggers).
#
# Usage: python3 -I scripts/build-master-data.py <gakumasu-diff dir> <out.json>
# The input is downloaded third-party data: it is parsed with yaml.CSafeLoader only
# (no object construction) and never executed.
import json
import os
import subprocess
import sys

import yaml

SRC, OUT = sys.argv[1], sys.argv[2]
LOADER = getattr(yaml, "CSafeLoader", yaml.SafeLoader)
_cache = {}


def T(name):
    if name not in _cache:
        with open(os.path.join(SRC, name + ".yaml"), encoding="utf-8") as f:
            _cache[name] = yaml.load(f, Loader=LOADER) or []
    return _cache[name]


def text(descs):
    return "".join(d.get("text", "") for d in (descs or []) if d.get("text"))


def low(enum, prefix):
    return enum[len(prefix):].lower() if enum and enum.startswith(prefix) else enum


TYPE = {"SupportCardType_Vocal": "vocal", "SupportCardType_Dance": "dance", "SupportCardType_Visual": "visual", "SupportCardType_Assist": "assist"}
RARITY = {"SupportCardRarity_Ssr": "SSR", "SupportCardRarity_Sr": "SR", "SupportCardRarity_R": "R"}
PLAN = {"ProducePlanType_Common": "free", "ProducePlanType_Plan1": "sense", "ProducePlanType_Plan2": "logic", "ProducePlanType_Plan3": "anomaly"}

out = {"meta": {}, "supportCards": {}, "levelLimits": {}, "skills": {}, "triggers": {}, "effects": {}, "events": {}, "suggestions": {},
       "memoryAbilities": {}, "produceItems": {}, "itemEffects": {}, "enchants": {}, "examEffects": {}, "examTriggers": {}, "cards": {}, "cardSearches": {}}
try:
    commit = subprocess.run(["git", "-C", SRC, "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
except Exception:
    commit = "unknown"
out["meta"] = {"schema": "ghl-hajime-master-v1", "source": "vertesan/gakumasu-diff", "commit": commit}

need_skills, need_triggers, need_effects, need_items, need_enchants, need_searches, need_events, need_sugg = set(), set(), set(), set(), set(), set(), set(), set()

# --- support cards
for sc in T("SupportCard"):
    out["supportCards"][sc["id"]] = {
        "name": sc["name"], "type": TYPE.get(sc["type"], sc["type"]), "rarity": RARITY.get(sc["rarity"], sc["rarity"]),
        "plan": PLAN.get(sc["planType"], sc["planType"]), "levelLimitId": sc.get("supportCardLevelLimitId", ""),
        "upgradePermil": sc.get("produceCardUpgradePermil", 0), "upgradeSearchId": sc.get("upgradeProduceCardSearchId", ""),
        "upgradeParamType": low(sc.get("produceCardUpgradeLessonParameterType", ""), "ProduceParameterType_"), "skills": [], "events": [],
    }
    if sc.get("upgradeProduceCardSearchId"):
        need_searches.add(sc["upgradeProduceCardSearchId"])
for r in T("SupportCardLevelLimit"):
    out["levelLimits"].setdefault(r["id"], []).append({"rank": r["rank"].replace("SupportCardLevelLimitRank_", ""), "levelLimit": r["levelLimit"]})
by_card_skill = {}
for tb in ["SupportCardProduceSkillLevelVocal", "SupportCardProduceSkillLevelDance", "SupportCardProduceSkillLevelVisual", "SupportCardProduceSkillLevelAssist"]:
    for r in T(tb):
        key = (r["supportCardId"], r["produceSkillId"])
        e = by_card_skill.setdefault(key, {"skillId": r["produceSkillId"], "order": r.get("order", 0), "levels": []})
        e["levels"].append([r["supportCardLevel"], r["produceSkillLevel"]])
        need_skills.add(r["produceSkillId"])
for (cid, _), e in by_card_skill.items():
    e["levels"].sort()
    if cid in out["supportCards"]:
        out["supportCards"][cid]["skills"].append(e)
for c in out["supportCards"].values():
    c["skills"].sort(key=lambda s: s["order"])
for r in T("ProduceEventSupportCard"):
    if r["supportCardId"] in out["supportCards"]:
        out["supportCards"][r["supportCardId"]]["events"].append({"number": r["number"], "cardLevel": r["supportCardLevel"], "detailId": r["produceStepEventDetailId"]})
        need_events.add(r["produceStepEventDetailId"])
for c in out["supportCards"].values():
    c["events"].sort(key=lambda e: e["number"])

# --- memory abilities
for m in T("MemoryAbility"):
    out["memoryAbilities"][m["id"]] = {"skillId": m["skillId"], "level": m["level"], "evaluation": m.get("evaluation", 0), "produceGroupIds": m.get("produceGroupIds", [])}
    need_skills.add(m["skillId"])

# --- skills
for s in T("ProduceSkill"):
    if s["id"] not in need_skills:
        continue
    pairs = []
    for k in (1, 2, 3):
        eff, trig = s.get(f"produceEffectId{k}"), s.get(f"produceTriggerId{k}")
        if eff:
            pairs.append({"trigger": trig or "", "effect": eff, "ratePermil": s.get(f"activationRatePermil{k}", 0)})
            need_effects.add(eff)
            if trig:
                need_triggers.add(trig)
    out["skills"].setdefault(s["id"], {})[str(s["level"])] = {
        "rarity": s.get("rarity", "").replace("SkillRarity_", ""), "plan": PLAN.get(s.get("planType"), s.get("planType")),
        "activationCount": s.get("activationCount", 0), "pairs": pairs, "text": text(s.get("produceDescriptions")),
    }

# --- P-items: challenge items + anything referenced by rewards (resolved after effects)
items_by_id = {}
for it in T("ProduceItem"):
    items_by_id.setdefault(it["id"], it)
    if it.get("isChallenge"):
        need_items.add(it["id"])

# --- events and suggestions
for e in T("ProduceStepEventDetail"):
    if e["id"] in need_events:
        out["events"][e["id"]] = {"effects": e.get("produceEffectIds", []), "suggestions": e.get("produceStepEventSuggestionIds", []),
                                  "suggestionType": e.get("suggestionType", ""), "text": text(e.get("produceDescriptions"))}
        need_effects.update(e.get("produceEffectIds", []))
        need_sugg.update(e.get("produceStepEventSuggestionIds", []))
for s in T("ProduceStepEventSuggestion"):
    if s["id"] in need_sugg:
        out["suggestions"][s["id"]] = {"effects": s.get("produceEffectIds", []), "alwaysSuccessful": s.get("alwaysSuccessful", True), "text": text(s.get("produceDescriptions"))}
        need_effects.update(s.get("produceEffectIds", []))

# --- effects (iterate to a fixed point: rewards can reference items whose effects reference more effects)
eff_rows = {e["id"]: e for e in T("ProduceEffect")}
item_eff_rows = {e["id"]: e for e in T("ProduceItemEffect")}
done_eff, done_item = set(), set()
while True:
    new = False
    for eid in list(need_effects - done_eff):
        done_eff.add(eid)
        e = eff_rows.get(eid)
        if not e:
            out["effects"][eid] = {"type": "MISSING"}
            continue
        rec = {"type": e["produceEffectType"].replace("ProduceEffectType_", ""), "min": e.get("effectValueMin", 0), "max": e.get("effectValueMax", 0)}
        if e.get("produceResourceType") and e["produceResourceType"] != "ProduceResourceType_Unknown":
            rec["resource"] = e["produceResourceType"].replace("ProduceResourceType_", "")
        if e.get("produceRewards"):
            rec["rewards"] = [{"type": r["resourceType"].replace("ProduceResourceType_", ""), "id": r.get("resourceId", ""), "level": r.get("resourceLevel", 0)} for r in e["produceRewards"]]
            for r in e["produceRewards"]:
                if r["resourceType"] == "ProduceResourceType_ProduceItem" and r.get("resourceId"):
                    need_items.add(r["resourceId"])
        if e.get("produceCardSearchId"):
            rec["cardSearch"] = e["produceCardSearchId"]
            need_searches.add(e["produceCardSearchId"])
        if e.get("produceExamStatusEnchantId"):
            rec["enchant"] = e["produceExamStatusEnchantId"]
            need_enchants.add(e["produceExamStatusEnchantId"])
        if e.get("produceStepEventDetailId"):
            rec["eventDetail"] = e["produceStepEventDetailId"]
        if e.get("pickRangeType") and e["pickRangeType"] != "ProducePickRangeType_Unknown":
            rec["pick"] = [e["pickRangeType"].replace("ProducePickRangeType_", ""), e.get("pickCountMin", 0), e.get("pickCountMax", 0)]
        out["effects"][eid] = rec
        new = True
    for iid in list(need_items - done_item):
        done_item.add(iid)
        it = items_by_id.get(iid)
        if not it:
            continue
        out["produceItems"][iid] = {"name": it["name"], "rarity": it.get("rarity", "").replace("ProduceItemRarity_", ""), "plan": PLAN.get(it.get("planType"), it.get("planType")),
                                    "fireLimit": it.get("fireLimit", 0), "fireInterval": it.get("fireInterval", 0), "trigger": it.get("produceTriggerId", ""), "itemEffects": it.get("produceItemEffectIds", []),
                                    "isChallenge": bool(it.get("isChallenge")), "text": text(it.get("produceDescriptions"))}
        if it.get("produceTriggerId"):
            need_triggers.add(it["produceTriggerId"])
        for ieid in it.get("produceItemEffectIds", []):
            ie = item_eff_rows.get(ieid)
            if not ie:
                continue
            rec = {"type": ie.get("effectType", "").replace("ProduceItemEffectType_", ""), "turn": ie.get("effectTurn", 0)}
            if ie.get("produceEffectId"):
                rec["produceEffect"] = ie["produceEffectId"]
                need_effects.add(ie["produceEffectId"])
            if ie.get("produceExamStatusEnchantId"):
                rec["enchant"] = ie["produceExamStatusEnchantId"]
                need_enchants.add(ie["produceExamStatusEnchantId"])
            out["itemEffects"][ieid] = rec
        new = True
    if not new:
        break

for t in T("ProduceTrigger"):
    if t["id"] in need_triggers:
        out["triggers"][t["id"]] = t["phaseType"].replace("ProducePhaseType_", "")

# --- exam status enchants -> exam triggers / effects
need_exam_eff, need_exam_trig = set(), set()
for x in T("ProduceExamStatusEnchant"):
    if x["id"] in need_enchants:
        out["enchants"][x["id"]] = {"examTrigger": x.get("produceExamTriggerId", ""), "examEffects": x.get("produceExamEffectIds", [])}
        need_exam_eff.update(x.get("produceExamEffectIds", []))
        if x.get("produceExamTriggerId"):
            need_exam_trig.add(x["produceExamTriggerId"])
for x in T("ProduceExamEffect"):
    if x["id"] in need_exam_eff:
        out["examEffects"][x["id"]] = {k: v for k, v in x.items() if k != "id" and v not in ("", 0, [], None, False) and not k.startswith("produceDescription")}
for x in T("ProduceExamTrigger"):
    if x["id"] in need_exam_trig:
        out["examTriggers"][x["id"]] = {k: v for k, v in x.items() if k != "id" and v not in ("", 0, [], None, False) and not k.startswith("produceDescription")}

# --- card searches and every produce card's effect groups and customization limit (maxCustomizeCount: the levels of
# its customizations together, over the produce)
for c in T("ProduceCardSearch"):
    if c["id"] in need_searches:
        out["cardSearches"][c["id"]] = {k: v for k, v in c.items() if k != "id" and v not in ("", 0, [], None, False) and not k.startswith("produceDescription")}
for c in T("ProduceCard"):
    key = f'{c["id"]}#{c.get("upgradeCount", 0)}'
    out["cards"][key] = {"name": c["name"], "rarity": c.get("rarity", "").replace("ProduceCardRarity_", ""), "plan": PLAN.get(c.get("planType"), c.get("planType")),
                         "category": c.get("category", "").replace("ProduceCardCategory_", ""), "effectGroups": [g.replace("effect_group-visible-", "").replace("-000", "") for g in c.get("effectGroupIds", [])],
                         "maxCustomize": c.get("maxCustomizeCount", 0)}

os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
print(json.dumps({k: len(v) for k, v in out.items() if k != "meta"}), out["meta"]["commit"][:7], os.path.getsize(OUT))
