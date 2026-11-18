"""Rebuild the four game-data inputs from two user-supplied Git checkouts."""

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory

import yaml


TOOLS = Path(__file__).resolve().parent
MASTER_COMMIT = 'ecc33afcb100888072b6258790e8730f6768db9a'
TOOLS_COMMIT = 'b3427501e4ccffa3cc64a4d4b014381961ab4dce'
DERIVED = Path('runtime/upstream/derived')
FIXTURE = Path('algorithms/fixtures/logic-public-master.json')
EXPECTED = {
    DERIVED / 'hajime-card-levels.json': '0a902197c1505802ef4dd1ea3025337de0ab985c71ff5da1caabd54fa2cf3ea1',
    DERIVED / 'hajime-master.json': '34ef4b640658ea3f4528a279fcd3a9c9a415c6350077c25d15a5b08de003219b',
    DERIVED / 'hajime-idolcards.json': '69ae728030e73f9e2255c8fcf5fda5c63d5fbef69f57d9dde4dfd105e4db1b7f',
    FIXTURE: 'dc70ecd781268911233bbe1012c3ed09b41da7a5c968cf1a57983dadd9e307c5',
}
TABLES = ('ProduceCard', 'ProduceExamStatusEnchant', 'ProduceExamEffect',
          'ProduceExamTrigger', 'ProduceCardCustomize', 'ProduceCardGrowEffect',
          'ProduceItem', 'ProduceItemEffect', 'ProduceDrink')
OMITTED = {
    'assetId', 'isCharacterAsset', 'voiceAssetId', 'libraryHidden',
    'produceDescriptions', 'playProduceDescriptions', 'playEffectProduceDescriptions',
    'customizeProduceDescriptions', 'unlockProducerLevel', 'rentalUnlockProducerLevel',
    'evaluation', 'viewStartTime', 'order',
}


def verify_checkout(checkout, expected):
    """Require the pinned revision and an unmodified tracked tree."""
    cmd = ['git', '-C', str(checkout)]
    actual = subprocess.check_output([*cmd, 'rev-parse', 'HEAD'], text=True).strip()
    if actual != expected:
        raise SystemExit(f'{checkout} is at {actual}. Check out {expected}.')
    if subprocess.run([*cmd, 'diff', '--quiet', 'HEAD', '--']).returncode != 0:
        raise SystemExit(f'{checkout} has modified tracked files. Supply a clean checkout.')


def build_logic_fixture(master, destination):
    loader = getattr(yaml, 'CSafeLoader', yaml.SafeLoader)
    out = {'source': 'gakumasu-diff', 'commit': MASTER_COMMIT}
    for table in TABLES:
        with (master / f'{table}.yaml').open(encoding='utf-8') as source:
            rows = yaml.load(source, Loader=loader)
        out[table] = [{k: v for k, v in row.items() if k not in OMITTED} for row in rows]
    with destination.open('w', encoding='utf-8') as stream:
        json.dump(out, stream, ensure_ascii=False, separators=(',', ':'))


def build_data(master, checkout, dest):
    verify_checkout(master, MASTER_COMMIT)
    verify_checkout(checkout, TOOLS_COMMIT)
    dest.mkdir(parents=True, exist_ok=True)
    link = dest / 'runtime/upstream/gakumas-tools'
    if (link.exists() or link.is_symlink()) and link.resolve() != checkout:
        raise SystemExit(f'{link} already points elsewhere. Supply its pinned checkout or change the output root.')
    with TemporaryDirectory(dir=dest, prefix='.build-data-') as staging_dir:
        staging = Path(staging_dir)
        csv = checkout / 'packages/gakumas-data/csv/skill_cards.csv'
        for script, inputs, filename in [
            ('build-card-levels.py', [master, csv], 'hajime-card-levels.json'),
            ('build-master-data.py', [master], 'hajime-master.json'),
            ('build-idol-cards.py', [master], 'hajime-idolcards.json'),
        ]:
            subprocess.run([sys.executable, '-I', str(TOOLS / script), *inputs, staging / filename], check=True)
        build_logic_fixture(master, staging / FIXTURE.name)
        for relative, expected in EXPECTED.items():
            generated = staging / relative.name
            actual = hashlib.sha256(generated.read_bytes()).hexdigest()
            if actual != expected:
                raise SystemExit(f'Generated {relative} has SHA-256 {actual}, expected {expected}.')
        link.parent.mkdir(parents=True, exist_ok=True)
        if not link.exists():
            link.symlink_to(checkout, target_is_directory=True)
        for relative in EXPECTED:
            out = dest / relative
            out.parent.mkdir(parents=True, exist_ok=True)
            (staging / relative.name).replace(out)
            print(f'{EXPECTED[relative]}  {relative}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--master', type=Path, required=True, help='vertesan/gakumasu-diff checkout')
    parser.add_argument('--gakumas-tools', type=Path, required=True, help='gakumas-tools/gakumas-tools checkout')
    parser.add_argument('--output-root', type=Path, default=TOOLS.parent, help='defaults to this release directory')
    args = parser.parse_args()
    build_data(args.master.resolve(), args.gakumas_tools.resolve(), args.output_root.resolve())
