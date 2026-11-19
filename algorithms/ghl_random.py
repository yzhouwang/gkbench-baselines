"""GHL's historical random control, delegated to the pinned GKBench SDK."""
from gkbench.algos.simple import RandomAlgo
from ghl_descriptions import description


class UniformRandom(RandomAlgo):
    name = "ghl-b0-random"
    title = "随机合法动作 / Uniform Random"
    about = description(
        "从合法动作中均匀抽取一个。 Uniformly sample a legal action.",
        "沿用 GKBench 内置 random 的决策规则，出牌、饮料、结束回合等合法动作均可抽中。",
        "Uses the SDK's random policy. All legal actions are eligible, using the policy RNG.",
        family="ghl-b0",
    )

    def decide(self, ctx):
        if not ctx.obs["legal"]:
            raise ValueError("B0 received no legal action")
        decision = super().decide(ctx)
        decision.meta["policy"] = "GHL-B0"
        return decision


B0 = UniformRandom
