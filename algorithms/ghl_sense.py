"""以公开牌堆和状态估算 Sense 出牌收益。Value Sense plays from the public screen."""
from pathlib import Path

from gkbench.algos.base import Algorithm, Decision

from ghl_policies import GHLBridge


class SenseHeuristic(Algorithm):
    name = "ghl-sense-buff-value"
    title = "Sense 增益估值 / Sense Buff Value"
    about = {
        "summary": "综合本次得分与好调、绝好调、集中在剩余回合的收益来选牌。 "
                   "Choose plays by immediate score and the remaining value of Good Condition, "
                   "Perfect Condition and Concentration.",
        "detail": [
            "采用 GHL 的 Sense B1v2 出牌规则，使用公开手牌、牌堆组成、回合属性和合法动作。 "
            "Runs the GHL Sense B1v2 battle rules on the visible hand, pile composition, turn types and legal moves.",
            "保留原策略对基础卡牌效果的估值；定制和考中成长由裁判结算。 "
            "The policy values base card effects. The referee applies customizations and in-exam growth.",
        ],
        "sees": "screen",
    }

    def __init__(self, **params):
        super().__init__(**params)
        self.bridge = GHLBridge(ghl_root=Path(__file__).resolve().parent.parent / "runtime",
                                script="ghl_sense_bridge.mjs")

    def begin(self, ctx):
        self.bridge.request(op="preflight", obs=ctx.obs, loadout=ctx.loadout)

    def decide(self, ctx):
        result = self.bridge.request(op="decide", obs=ctx.obs, loadout=ctx.loadout)
        action = tuple(result["action"])
        if action not in [tuple(a) for a in ctx.obs["legal"]]:
            raise ValueError("Sense heuristic returned an action absent from the public legal list")
        return Decision(action)

    def close(self):
        self.bridge.close()
