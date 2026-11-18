#!/usr/bin/env python3
# Build upstream/derived/hajime-idolcards.json from the pinned game master-data dump
# (upstream/gakumasu-diff, see sources.lock.json): every P-idol card (IdolCard) with its plan,
# exam effect type (好印象 = ExamReview, やる気 = ExamCardPlayAggressive, ...), produce starting
# parameters, parameter growth rates (permil; GHL's paramBonusPct = permil / 10), stamina, the
# unique produce card(s) and the unique P-item before / after talent bloom. GHL maps each card to
# the engine's P-idol by its unique card's name (src/content/pidols.ts).
#
# A separate file from hajime-master.json on purpose: that file's hash is recorded in every r3/r4
# run manifest and must not change.
#
# Usage: python3 -I scripts/build-idol-cards.py <gakumasu-diff dir> <out.json>
# The input is downloaded third-party data: it is parsed with yaml.CSafeLoader only (no object
# construction) and never executed.
import json
import os
import subprocess
import sys

import yaml

SRC, OUT = sys.argv[1], sys.argv[2]
LOADER = getattr(yaml, "CSafeLoader", yaml.SafeLoader)
PLAN = {"ProducePlanType_Common": "free", "ProducePlanType_Plan1": "sense", "ProducePlanType_Plan2": "logic", "ProducePlanType_Plan3": "anomaly"}


def T(name):
    with open(os.path.join(SRC, name + ".yaml"), encoding="utf-8") as f:
        return yaml.load(f, Loader=LOADER) or []


try:
    commit = subprocess.run(["git", "-C", SRC, "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
except Exception:
    commit = "unknown"

card_names = {}
for c in T("ProduceCard"):
    card_names.setdefault(c["id"], c["name"])
item_names = {}
for it in T("ProduceItem"):
    item_names.setdefault(it["id"], it["name"])

out = {"meta": {"schema": "ghl-hajime-idolcards-v1", "source": "vertesan/gakumasu-diff", "commit": commit}, "idolCards": {}}
for ic in T("IdolCard"):
    out["idolCards"][ic["id"]] = {
        "characterId": ic["characterId"],
        "name": ic["name"],
        "rarity": ic["rarity"].replace("IdolCardRarity_", "").upper(),
        "plan": PLAN.get(ic["planType"], ic["planType"]),
        "examEffectType": ic.get("examEffectType", "").replace("ProduceExamEffectType_", ""),
        "examInitialDeckId": ic.get("examInitialDeckId", ""),
        "params": {"vocal": ic["produceVocal"], "dance": ic["produceDance"], "visual": ic["produceVisual"]},
        "growthPermil": {
            "vocal": ic["produceVocalGrowthRatePermil"],
            "dance": ic["produceDanceGrowthRatePermil"],
            "visual": ic["produceVisualGrowthRatePermil"],
        },
        "stamina": ic["produceStamina"],
        "produceCardId": ic.get("produceCardId", ""),
        "produceCardName": card_names.get(ic.get("produceCardId", ""), ""),
        "secondProduceCardId": ic.get("secondProduceCardId", ""),
        "secondProduceCardName": card_names.get(ic.get("secondProduceCardId", ""), ""),
        "beforeProduceItemId": ic.get("beforeProduceItemId", ""),
        "beforeProduceItemName": item_names.get(ic.get("beforeProduceItemId", ""), ""),
        "afterProduceItemId": ic.get("afterProduceItemId", ""),
        "afterProduceItemName": item_names.get(ic.get("afterProduceItemId", ""), ""),
    }

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
print(len(out["idolCards"]), "idol cards", commit[:7], os.path.getsize(OUT))
