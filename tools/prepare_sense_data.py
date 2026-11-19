"""Build the Sense card supplement from two pinned public game-data files."""
import argparse
import csv
import hashlib
from io import StringIO
import json
from pathlib import Path
import re
from tempfile import NamedTemporaryFile
from urllib.request import urlopen

import yaml


ROOT = Path(__file__).resolve().parents[1]
CARD = "p_card-01-ido-3_249"
SOURCES = {
    "ProduceCard.yaml": (
        "https://raw.githubusercontent.com/vertesan/gakumasu-diff/edc305aac3ac0204806c96164ce36fb795ba81e1/ProduceCard.yaml",
        "83b428b188e8ef0e3bfbd7c9c909854cf3d62699ee3d5f6994be7903040857b1"),
    "skill_cards.csv": (
        "https://raw.githubusercontent.com/gakumas-tools/gakumas-tools/d5c1b22ff46dfd217d7f25c34fb0d4e34276faf9/packages/gakumas-data/csv/skill_cards.csv",
        "c672a08cbf34ffd5a2c841b790324b8599624f7f4a2c4cb5370258a0a68f5a21"),
}


def source(name, directory):
    url, sha = SOURCES[name]
    if directory:
        data = (directory / name).read_bytes()
    else:
        with urlopen(url, timeout=90) as response:
            data = response.read()
    if hashlib.sha256(data).hexdigest() != sha:
        raise ValueError(f"{name} does not match its pinned SHA-256")
    return data.decode("utf-8")


def build(directory):
    # In these dumps each top-level list item starts with its id. Parse the
    # selected rows with YAML so nested lists and quoted fields remain intact.
    contents = source("ProduceCard.yaml", directory)
    rows = [yaml.safe_load("- id: " + text)[0] for text in re.split(r"(?m)^- id: ", contents)
            if text.startswith(CARD + "\n")]
    if [r["upgradeCount"] for r in rows] != [0, 1, 2, 3]:
        raise ValueError("Expected four successive native upgrades")
    csv_cards = {r["name"]: r for r in csv.DictReader(StringIO(source("skill_cards.csv", directory)))}
    native = json.loads((ROOT / "algorithms/fixtures/logic-public-master.json").read_text())
    effects = {e["id"]: e for e in native["ProduceExamEffect"]}
    output = []
    for level, row in enumerate(rows):
        ref = csv_cards[rows[min(level, 1)]["name"]]
        if row["playEffects"][1:] != rows[0]["playEffects"][1:] or row["playProduceExamTriggerId"] != rows[0]["playProduceExamTriggerId"]:
            raise ValueError("Unrecognized change to scoring, extra uses or play condition")
        effect = effects[row["playEffects"][0]["produceExamEffectId"]]
        if effect["effectType"] != "ProduceExamEffectType_ExamLessonBuff" or row["playEffects"][0]["produceExamTriggerId"]:
            raise ValueError("Expected unconditional concentration gain")
        actions, count = re.subn(r"^concentration\+=\d+;", f"concentration+={effect['effectValue1']};", ref["actions"])
        cost = f"cost-={row['stamina']}"
        if count != 1 or (level < 2 and (actions, cost) != (ref["actions"], ref["cost"])):
            raise ValueError("The two sources disagree on the base or upgraded card")
        output.append(dict(name=row["name"], actions=actions, cost=cost, conditions=ref["conditions"],
                           base=int(csv_cards[rows[0]["name"]]["id"]), plus=int(csv_cards[rows[1]["name"]]["id"])))
    return {CARD: output}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path, help="Use already-downloaded files instead of HTTPS")
    args = parser.parse_args()
    data = build(args.input_dir)
    target = ROOT / "algorithms/fixtures/sense-card-levels.json"
    with NamedTemporaryFile("w", dir=target.parent, delete=False, encoding="utf-8") as out:
        out.write(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n")
    Path(out.name).replace(target)
    print(f"{hashlib.sha256(target.read_bytes()).hexdigest()}  {target}")
