"""Run one public GKBench loadout through the local referee, without a server."""
import argparse
import json
import random
from pathlib import Path
from types import SimpleNamespace

from gkbench import algos
from gkbench.referee import Referee


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("loadout", type=Path, help="Single public GKBench loadout in JSON")
    parser.add_argument("algorithm", help="GKBench path.py:Class[:params]")
    parser.add_argument("--seed", type=int, default=123, help="Local practice deal")
    parser.add_argument("--budget", type=float, default=10)
    args = parser.parse_args()
    loadout = json.loads(args.loadout.read_text())
    policy = algos.make(args.algorithm)
    world_rng = random.Random(42)
    action_rng = random.Random(7)
    try:
        ref = Referee(loadout, args.seed)
        ctx = SimpleNamespace(obs=ref.obs(), meta=ref.public_meta(), loadout=ref.loadout_public,
                              budget=args.budget, rng=action_rng,
                              worlds=lambda n: [ref.sample_world(world_rng) for _ in range(n)])
        policy.begin(ctx)
        while not ref.finished:
            ctx.obs = ref.obs()
            ref.step(policy.decide(ctx).action)
        print(json.dumps({"score": ref.score, "decisions": ref.decisions, "practice_seed": args.seed}))
    finally:
        if hasattr(policy, "close"):
            policy.close()


if __name__ == "__main__":
    main()
