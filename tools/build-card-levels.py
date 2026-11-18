#!/usr/bin/env python3
# Build upstream/derived/hajime-card-levels.json: the engine definitions of the skill cards' levels 2 and 3 ("++", "+++"),
# which a support's スキルカードサポート reaches in a battle (rule SUPPORT-ASSIST, ruleset r11) and gakumas-tools has
# no cards for. gakumas-data holds level 0 and 1 (X, X+) in its DSL; the game's master data (ProduceCard, upgradeCount
# 0-3) holds every level. A level is derived from the level below it by applying the master data's differences between
# the two to the DSL: the stamina cost, the cost's value, and each effect's values, each in the one DSL term that encodes
# it (SLOTS). A difference with no slot, or with no single matching term, leaves that level underived; the engine then
# stops the card at its highest derived level.
#
# The same transform applied to level 0 -> 1 is checked against gakumas-data's own X+ (meta.validation): how often it
# reproduces the real "+" card, exactly or after dropping customization anchors.
#
# Usage: python3 -I scripts/build-card-levels.py <gakumasu-diff dir> <gakumas-data skill_cards.csv> <out.json>
#   e.g. python3 -I scripts/build-card-levels.py upstream/gakumasu-diff \
#          upstream/gakumas-tools/packages/gakumas-data/csv/skill_cards.csv upstream/derived/hajime-card-levels.json
# The inputs are third-party data: YAML is parsed with yaml.CSafeLoader only (no object construction) and nothing in
# them is executed. The output is derived game content: it stays in upstream/ (gitignored), like hajime-master.json.
import csv
import json
import os
import re
import subprocess
import sys
import unicodedata

import yaml

SRC, CSV, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
LOADER = getattr(yaml, "CSafeLoader", yaml.SafeLoader)
VERSION = 1


def load(name):
    with open(os.path.join(SRC, name + ".yaml"), encoding="utf-8") as f:
        return yaml.load(f, Loader=LOADER) or []


# Spelling differences between gakumas-tools and the game data (engine name -> game name), as src/content/master.ts.
ALIASES = {"ストレッチ談義": "ストレッチ談議", "愛をこめて": "愛を込めて", "月明りに包まれて": "月明かりに包まれて", "夢と現境界線": "夢と現の境界線"}


def strip(name):
    b = unicodedata.normalize("NFKC", name).rstrip("+")
    return ALIASES.get(b, b)


cards = load("ProduceCard")
# Every table a card level's battle fields can reach by id: its effects, their triggers, enchants, chained and grown effects.
TABLES = {}
for t in ("ProduceExamEffect", "ProduceExamTrigger", "ProduceExamStatusEnchant", "ProduceCardGrowEffect", "ProduceCardSearch", "ProduceCardStatusEnchant", "ProduceCardStatusEffect"):
    for r in load(t):
        TABLES.setdefault(r["id"], r)
master = {}
for r in cards:
    master.setdefault(strip(r["name"]), {})[r["upgradeCount"]] = r
with open(CSV, encoding="utf-8") as f:
    gt = list(csv.DictReader(f))
engine = {}
for r in gt:
    engine.setdefault(strip(r["name"]), {})["plus" if r["upgraded"] == "TRUE" else "base"] = r

COLUMNS = ("conditions", "cost", "actions", "effects", "limit")
# A card level's fields that act in a battle; the rest (name, art, evaluation, unlock level, customizations) do not.
BATTLE = ("stamina", "forceStamina", "costType", "costValue", "playProduceExamTriggerId", "playEffects", "playMovePositionType", "moveEffectTriggerType",
          "moveProduceExamEffectIds", "moveProduceExamTriggerIds", "isEndTurnLost", "isRestrict", "produceCardStatusEnchantId", "category", "planType", "rarity")
SKIP = {"id", "effectGroupIds", "hideIcon"}


def canon(v, depth=0):
    """A value with every id it holds replaced by the row it names (to depth 6), descriptions and ids left out."""
    if isinstance(v, str) and v in TABLES and depth < 6:
        return canon({k: x for k, x in TABLES[v].items()}, depth + 1)
    if isinstance(v, list):
        return [canon(x, depth) for x in v]
    if isinstance(v, dict):
        return {k: canon(x, depth) for k, x in v.items() if k not in SKIP and "escription" not in k}
    return v


def flat(v, path=(), out=None):
    out = {} if out is None else out
    if isinstance(v, dict):
        for k, x in v.items():
            flat(x, path + (k,), out)
    elif isinstance(v, list):
        out[path + ("#len",)] = len(v)
        for i, x in enumerate(v):
            flat(x, path + (i,), out)
    else:
        out[path] = v
    return out


def level(r):
    tree = canon({k: r.get(k) for k in BATTLE})
    return tree, flat(tree)


def node(tree, path):
    for k in path:
        tree = tree[k]
    return tree


def num(x):
    """A value as the DSL writes it: integers bare, decimals without trailing zeros."""
    if abs(x - round(x)) < 1e-9:
        return str(int(round(x)))
    return ("%.4f" % x).rstrip("0").rstrip(".")


END = r"(?=\s*(?:;|\}|$))"
# (effect type, field) -> (DSL variable or template, scale): the value's one DSL term. "{v}" is the number.
ADD = lambda var: (rf"(?<![\w.]){var}\+=(?P<v>-?\d+(?:\.\d+)?){END}", 1)
SLOTS = {
    ("ExamLesson", "effectValue1"): ADD("score"),
    ("ExamBlock", "effectValue1"): ADD("genki"),
    ("ExamCardPlayAggressive", "effectValue1"): ADD("motivation"),
    ("ExamReview", "effectValue1"): ADD("goodImpressionTurns"),
    ("ExamLessonBuff", "effectValue1"): ADD("concentration"),
    ("ExamParameterBuff", "effectTurn"): ADD("goodConditionTurns"),
    ("ExamParameterBuffMultiplePerTurn", "effectTurn"): ADD("perfectConditionTurns"),
    ("ExamFullPowerPoint", "effectValue1"): ADD("fullPowerCharge"),
    ("ExamStaminaConsumptionDown", "effectTurn"): ADD("halfCostTurns"),
    ("ExamStaminaRecoverFix", "effectValue1"): ADD("fixedStamina"),
    ("ExamStaminaConsumptionDownFix", "effectValue1"): ADD("costReduction"),
    ("ExamBlockFix", "effectValue1"): ADD("fixedGenki"),
    ("ExamAntiDebuff", "effectCount"): ADD("nullifyDebuff"),
    ("ExamPlayableValueAdd", "effectCount"): ADD("cardUsesRemaining"),
    ("ExamMultipleLessonBuffLesson", "effectValue1"): ADD("score"),
    ("ExamLessonAddMultipleParameterBuff", "effectValue1"): ADD("score"),
    ("ExamMultipleLessonBuffLesson", "effectValue2"): (r"(?<![\w.])concentrationMultiplier=(?P<v>\d+(?:\.\d+)?)" + END, 1000),
    ("ExamLessonAddMultipleParameterBuff", "effectValue2"): (r"(?<![\w.])goodConditionTurnsMultiplier=(?P<v>\d+(?:\.\d+)?)" + END, 1000),
    ("ExamEnthusiasticAdditive", "effectValue1"): (r"setEnthusiasmBonus\((?P<v>\d+(?:\.\d+)?)\)", 1),
    ("ExamBlockPerUseCardCount", "effectValue1"): (r"(?<![\w.])genki\+=(?P<v>\d+)\+cardsUsed\*", 1),
    ("ExamBlockPerUseCardCount", "effectValue2"): (r"(?<![\w.])genki\+=\d+\+cardsUsed\*(?P<v>\d+(?:\.\d+)?)" + END, 1),
    ("ExamStatusEnchant", "effectTurn"): (r"(?<![\w.])limit:(?P<v>\d+)", 1),
    # 元気+N with やる気 applied at 1 + v2/1000 times: "motivationMultiplier=1.5; genki+=20".
    ("ExamBlockAddMultipleAggressive", "effectValue1"): ADD("genki"),
    ("ExamBlockAddMultipleAggressive", "effectValue2"): (r"(?<![\w.])motivationMultiplier=(?P<v>\d+(?:\.\d+)?)" + END, 1000, 1),
}
# "score+=<var>*X": X is the permil / 1000, and "*1" is left out.
DEPEND = {
    "ExamLessonDependBlock": "genki",
    "ExamLessonDependExamReview": "goodImpressionTurns",
    "ExamLessonDependExamCardPlayAggressive": "motivation",
    "ExamLessonDependParameterBuff": "goodConditionTurns",
}
COST_VAR = {
    "ExamCostType_ExamReview": "goodImpressionTurns",
    "ExamCostType_ExamCardPlayAggressive": "motivation",
    "ExamCostType_ExamBlock": "genki",
    "ExamCostType_ExamLessonBuff": "concentration",
    "ExamCostType_ExamParameterBuff": "goodConditionTurns",
    "ExamCostType_ExamFullPowerPoint": "fullPowerCharge",
}


class Underived(Exception):
    pass


def sub_one(dsl, cols, pattern, old, new, scale=1, all_hits=None, offset=0, ordinal=None):
    """Replace the one DSL term `pattern` whose number is offset + old/scale with offset + new/scale.
    all_hits: the effect's hit count, when the DSL repeats the term once a hit ("score+=5; score+=5").
    ordinal: (i, n) when n top-level effects of the card hold the same value in the same kind of term: the i-th term then."""
    want = offset + old / scale
    hits = []
    for col in cols:
        for m in re.finditer(pattern, dsl[col]):
            if abs(float(m.group("v")) - want) < 1e-9:
                hits.append((col, m))
    if not hits:
        raise Underived(f"no term {pattern} = {num(want)}")
    if len(hits) > 1:
        if all_hits and len(hits) == all_hits and len({m.group(0) for _, m in hits}) == 1:
            pass
        elif ordinal and ordinal[1] == len(hits):
            hits = [hits[ordinal[0]]]
        else:
            raise Underived(f"{len(hits)} terms {pattern} = {num(want)}")
    for col in cols:
        spans = [m for c, m in hits if c == col]
        s = dsl[col]
        for m in reversed(spans):
            s = s[: m.start("v")] + num(offset + new / scale) + s[m.end("v") :]
        dsl[col] = s


# An effect a higher level adds, at the front or the end of the card's effects: its DSL term, for the simple kinds.
ADDED = {
    ("ExamBlock", "effectValue1"): "genki+={v}",
    ("ExamLesson", "effectValue1"): "score+={v}",
    ("ExamCardPlayAggressive", "effectValue1"): "motivation+={v}",
    ("ExamReview", "effectValue1"): "goodImpressionTurns+={v}",
    ("ExamPlayableValueAdd", "effectCount"): "cardUsesRemaining+={v}",
}


def added_term(effect):
    """The DSL of a plain top-level effect (one value, no trigger, chain or enchant), or None."""
    t = effect["effectType"].replace("ProduceExamEffectType_", "")
    if t == "ExamCardDraw":
        v = effect.get("effectValue1", 0)
        return "drawCard" if v == 1 else f"drawCard({v})" if v else None
    vals = {f: effect.get(f, 0) for f in ("effectValue1", "effectValue2", "effectTurn")}
    for (tt, f), tpl in ADDED.items():
        if tt != t:
            continue
        others = [x for k, x in vals.items() if k != f and x]
        v = effect.get(f, 0)
        if v and not others and not any(isinstance(x, (dict, list)) and x for k, x in effect.items() if k not in ("effectType",)):
            return tpl.format(v=num(v))
    return None


def apply_delta(src_dsl, lo, hi):
    """The DSL of master level `hi`, from the DSL of level `lo` (src_dsl) and the two master rows. Every battle field that
    differs between the two must be one the DSL encodes in a single term, or the level is underived."""
    tree_lo, flat_lo = level(lo)
    tree_hi, flat_hi = level(hi)
    dsl = dict(src_dsl)
    if set(flat_lo) != set(flat_hi):
        # One plain effect added at the front or the end ("私がスター++": 元気+1 first): the rest must match as before.
        pl, ph = tree_lo["playEffects"], tree_hi["playEffects"]
        if len(ph) != len(pl) + 1:
            raise Underived("effects differ in kind between the levels")
        for at in (0, len(pl)):
            rest = ph[:at] + ph[at + 1 :]
            extra = ph[at]
            if flat(rest) != flat(pl) and set(flat(rest)) != set(flat(pl)):
                continue
            term = added_term(extra["produceExamEffectId"]) if not extra.get("produceExamTriggerId") else None
            if term is None or not dsl["actions"].strip() or "{" in dsl["actions"]:
                continue
            dsl["actions"] = term + "; " + dsl["actions"] if at == 0 else dsl["actions"] + "; " + term
            hi = dict(hi)
            hi["playEffects"] = (hi["playEffects"][:at] + hi["playEffects"][at + 1 :])
            tree_hi, flat_hi = level(hi)
            break
        else:
            raise Underived("effects differ in kind between the levels")
        if set(flat_lo) != set(flat_hi):
            raise Underived("effects differ in kind between the levels")
    cols = ["actions", "effects"]
    for path in sorted(flat_lo, key=str):
        old, new = flat_lo[path], flat_hi[path]
        if old == new:
            continue
        if path == ("stamina",):
            sub_one(dsl, ["cost"], r"(?<![\w.])cost-=(?P<v>\d+)" + END, old, new)
            continue
        if path == ("forceStamina",):
            sub_one(dsl, ["cost"], r"(?<![\w.])stamina-=(?P<v>\d+)" + END, old, new)
            continue
        if path == ("costValue",):
            var = COST_VAR.get(lo.get("costType"))
            if not var:
                raise Underived(f"cost type {lo.get('costType')}")
            sub_one(dsl, ["cost"], rf"(?<![\w.]){var}-=(?P<v>\d+)" + END, old, new)
            continue
        parent = node(tree_lo, path[:-1]) if len(path) > 1 else None
        field = path[-1]
        if not isinstance(parent, dict) or "effectType" not in parent or not isinstance(old, (int, float)):
            raise Underived("difference at " + ".".join(map(str, path)))
        t = parent["effectType"].replace("ProduceExamEffectType_", "")
        if t in DEPEND and field == "effectValue1":
            var = DEPEND[t]
            pat = rf"(?<![\w.])score\+={var}(?:\*(?P<v>\d+(?:\.\d+)?))?{END}"
            hits = [(c, m) for c in cols for m in re.finditer(pat, dsl[c]) if abs(float(m.group("v") or 1) - old / 1000) < 1e-9]
            if len(hits) != 1:
                raise Underived(f"{len(hits)} terms score+={var}*{num(old / 1000)}")
            c, m = hits[0]
            term = f"score+={var}" + ("" if abs(new - 1000) < 1e-9 else "*" + num(new / 1000))
            dsl[c] = dsl[c][: m.start()] + term + dsl[c][m.end() :]
        elif t == "ExamCardDraw" and field == "effectValue1":
            term = lambda n: "drawCard" if n == 1 else f"drawCard({n})"
            pat = r"(?<![\w.])drawCard(?:\((?P<v>\d+)\))?(?=\s*(?:;|\}|$))"
            hits = [(c, m) for c in cols for m in re.finditer(pat, dsl[c]) if int(m.group("v") or 1) == old]
            if len(hits) != 1:
                raise Underived(f"{len(hits)} terms {term(old)}")
            c, m = hits[0]
            dsl[c] = dsl[c][: m.start()] + term(int(new)) + dsl[c][m.end() :]
        elif t == "ExamLesson" and field == "effectCount":
            # A hit count: the DSL repeats "score+=V" once a hit.
            one = f"score+={num(parent['effectValue1'])}"
            run = "; ".join([one] * int(old))
            hits = [c for c in cols if dsl[c].count(run) == 1 and dsl[c].count(one) == old]
            if len(hits) != 1:
                raise Underived(f"no run of {int(old)} x {one}")
            c = hits[0]
            dsl[c] = dsl[c].replace(run, "; ".join([one] * int(new)))
        elif (t, field) in SLOTS:
            pat, scale, *off = SLOTS[(t, field)]
            # Same value in the same kind of term on several top-level effects: match them by order.
            ordinal = None
            if len(path) == 4 and path[0] == "playEffects":
                same = [i for i, pe in enumerate(tree_lo["playEffects"]) if isinstance(pe.get("produceExamEffectId"), dict)
                        and pe["produceExamEffectId"].get("effectType") == parent["effectType"] and pe["produceExamEffectId"].get(field) == old]
                if len(same) > 1 and path[1] in same:
                    ordinal = (same.index(path[1]), len(same))
            sub_one(dsl, cols, pat, old, new, scale, parent.get("effectCount") if t == "ExamLesson" else None, off[0] if off else 0, ordinal)
        else:
            raise Underived(f"no slot for {t}.{field}")
    return dsl


ANCHOR = re.compile(r"@\w+\s+")


def norm(dsl):
    return {c: re.sub(r"\s+", " ", ANCHOR.sub("", dsl[c] or "")).strip() for c in COLUMNS}


out = {"meta": {}, "cards": {}}
try:
    dump_commit = subprocess.run(["git", "-C", SRC, "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
except Exception:
    dump_commit = "unknown"
try:
    gt_commit = subprocess.run(["git", "-C", os.path.dirname(os.path.abspath(CSV)), "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
except Exception:
    gt_commit = "unknown"

val = {"pairs": 0, "exact": 0, "anchorsOnly": 0, "wrong": [], "underived": {}}
reasons = {}
for name, lv in sorted(master.items()):
    e = engine.get(name, {})
    if "base" not in e:
        continue
    base = e["base"]
    rec = {"name": base["name"], "maxLevel": max(lv), "plusId": int(e["plus"]["id"]) if "plus" in e else None, "levels": {}, "why": {}}
    out["cards"][base["id"]] = rec
    # Validation: level 0 -> 1 against gakumas-data's own "+".
    if "plus" in e and 0 in lv and 1 in lv:
        val["pairs"] += 1
        try:
            got = apply_delta({c: base[c] for c in COLUMNS}, lv[0], lv[1])
            want = {c: e["plus"][c] for c in COLUMNS}
            if {c: (got[c] or "").strip() for c in COLUMNS} == {c: (want[c] or "").strip() for c in COLUMNS}:
                val["exact"] += 1
            elif norm(got) == norm(want):
                val["anchorsOnly"] += 1
            else:
                val["wrong"].append(name)
        except Underived as x:
            k = str(x).split(" = ")[0]
            val["underived"][k] = val["underived"].get(k, 0) + 1
    # Levels 2 and 3 from the engine's "+".
    if "plus" not in e or 1 not in lv:
        continue
    dsl = {c: e["plus"][c] for c in COLUMNS}
    for k in (2, 3):
        if k not in lv:
            break
        try:
            dsl = apply_delta(dsl, lv[k - 1], lv[k])
            rec["levels"][str(k)] = dsl
        except Underived as x:
            rec["why"][str(k)] = str(x)
            reasons[str(x).split(" = ")[0]] = reasons.get(str(x).split(" = ")[0], 0) + 1
            break

derived = {k: sum(1 for c in out["cards"].values() if str(k) in c["levels"]) for k in (2, 3)}
possible = {k: sum(1 for c in out["cards"].values() if c["maxLevel"] >= k and c["plusId"] is not None) for k in (2, 3)}
val["wrong"] = sorted(val["wrong"])
out["meta"] = {"schema": "ghl-hajime-card-levels-v1", "version": VERSION, "dumpCommit": dump_commit, "gakumasToolsCommit": gt_commit,
               "validation": val, "derived": derived, "possible": possible, "underived": dict(sorted(reasons.items(), key=lambda x: -x[1]))}
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
v = val
print(json.dumps({"validation": {"pairs": v["pairs"], "exact": v["exact"], "anchorsOnly": v["anchorsOnly"], "wrong": len(v["wrong"]),
                                 "underived": sum(v["underived"].values())}, "derived": derived, "possible": possible}, ensure_ascii=False))
