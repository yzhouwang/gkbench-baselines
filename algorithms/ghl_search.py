"""GHL search structures over GKBench's resampled native GKMS worlds.

These are explicitly named adaptations, not campaign-policy reproductions. See
the release README for the objective and observation boundaries.
"""
from __future__ import annotations

import math
import time
from collections import Counter
from copy import deepcopy

from gkbench.algos.base import Algorithm, Decision


class UnsupportedSearch(ValueError):
    pass


class SearchBudgetExceeded(RuntimeError):
    pass


def _action(value):
    return tuple(tuple(x) if isinstance(x, list) else x for x in value)


def _legal(obs):
    actions = [_action(a) for a in obs.get("legal", ())]
    if not actions:
        raise UnsupportedSearch("no legal actions at a search decision")
    if any(a[0] not in ("play", "drink", "end") for a in actions):
        raise UnsupportedSearch("explicit target selections are not mapped by this adapter")
    return actions


def exam_kind(obs, loadout):
    """Only standalone examinations have the objectives implemented here."""
    step = str(obs["exam"].get("step", "")).upper()
    if step == "AUDITION_FINAL":
        return "final"
    if step == "AUDITION_MID1":
        return "midterm"
    raise UnsupportedSearch(f"search objective unsupported for step {step!r}")


def battle_projection(obs, terminal=False):
    """The battle term of GHL greedy.ts stateValue, including its score multiplier.

The term is retained at the simulated terminal screen, with zero turns left.
No campaign evaluation, resources, deck prices or drink prices are fabricated.
"""
    exam, num = obs["exam"], obs["num"]
    types = exam["types"]
    if not types:
        raise UnsupportedSearch("B2 projection requires the public turn schedule")
    turn = int(exam["turn"])
    current_type = int(types[min(max(turn - 1, 0), len(types) - 1)])
    if current_type not in (1, 2, 3):
        raise UnsupportedSearch(f"unknown turn parameter type {current_type}")
    mult = float(exam["permil"][current_type - 1]) / 1000
    buffs = Counter()
    for kind, amount, *_ in obs.get("status", ()):
        buffs[kind] += float(amount)
    gi = buffs["review"]
    remaining = 0 if terminal else max(0, int(exam["limit"]) - turn + 1)
    return (float(num["score"]) * mult
            + 0.8 * gi * min(remaining, gi) * mult
            + 1.5 * buffs["aggressive"] + 0.4 * float(num["block"])
            + 1.5 * float(num["stamina"]))


def rival_above_probabilities(score, rivals):
    """Independent inclusive-integer uniform range model; ties favor the player.

GKMS exposes score_min/max, not actual rival outcomes. This distribution is an
explicit model assumption, not a claim about the hidden judge RNG.
"""
    if not rivals:
        raise UnsupportedSearch("B4v2 midterm requires public rival score ranges")
    result = []
    for rival in rivals:
        lo, hi = rival.get("score_min"), rival.get("score_max")
        if (isinstance(lo, bool) or isinstance(hi, bool)
                or not isinstance(lo, (int, float)) or not isinstance(hi, (int, float))
                or not math.isfinite(lo) or not math.isfinite(hi)
                or int(lo) != lo or int(hi) != hi or hi < lo):
            raise UnsupportedSearch(f"invalid public rival score range: {rival!r}")
        lo, hi = int(lo), int(hi)
        above = max(0, hi - max(lo, math.floor(score) + 1) + 1)
        result.append(above / (hi - lo + 1))
    return result


class _NativeBattle:
    """Track public played-card history exactly as GKMSUINet.uinet.env.Battle."""
    def __init__(self, session, root_obs):
        self.session = session
        self.exam = dict(root_obs["exam"])
        self.played = list(root_obs.get("played", ()))

    @property
    def finished(self):
        return bool(self.session.finished)

    def obs(self):
        from uinet.uiobs import from_session
        return from_session(self.session, self.exam, self.played)

    def step(self, action):
        from uinet.uiobs import card_spec
        legal = [_action(a) for a in self.session.legal_actions()]
        if action not in legal:
            raise UnsupportedSearch(f"action {action!r} is not legal in sampled world")
        turn = self.session.turn
        spec = card_spec(self.session.deck.hand[action[1]]) if action[0] == "play" else None
        self.session.step(action, observe=False)
        if self.session.turn != turn or self.finished:
            self.played = []
        elif spec is not None:
            self.played.append(spec)


class _Search(Algorithm):
    needs_gkms = True
    privileged = False
    sees_seed = False
    objective = "raw-score"
    title = "GHL B4 / GKMS sampled worlds"
    name = "ghl-b4-gkms"
    about = {
        "summary": "GHL battle rollout search adapted to GKMS sampled worlds.",
        "sees": "screen",
        "detail": [
            "Each action uses clones of the same GKBench resampled worlds; no true deal or seed is read.",
            "Continuation is the original GHL B1v2 heuristic on exported public UI observations.",
            "Only complete equal-sample sweeps count; budget reduction is recorded, and zero complete sweeps is an error.",
            "The local deadline excludes separately reported world acquisition; full elapsed time is retained and official server timing is unchanged.",
        ],
    }

    def __init__(self, samples=3, seconds=4.5, max_steps=160, **params):
        super().__init__(samples=int(samples), seconds=float(seconds), max_steps=int(max_steps), **params)
        self.samples, self.seconds, self.max_steps = int(samples), float(seconds), int(max_steps)
        if not 1 <= self.samples <= 64 or not 0.05 <= self.seconds <= 10 or self.max_steps < 1:
            raise ValueError("samples must be 1..64, seconds 0.05..10, and max_steps positive")
        self._bridge_instance = None
        self._clock = time.monotonic
        self._public_history = []
        self._pending_public_action = None
        # The pinned SDK constructs each worker before it asks the judge to
        # open an episode. Load the native tables and bridge at that point.
        self.warmup()

    @property
    def bridge(self):
        if self._bridge_instance is None:
            from ghl_policies import GHLBridge
            self._bridge_instance = GHLBridge()
        return self._bridge_instance

    def close(self):
        if self._bridge_instance is not None:
            self._bridge_instance.close()
            self._bridge_instance = None

    def warmup(self):
        """Initialize context-free runtime data before a hosted episode opens.

        This never samples a world, builds a deal, or changes policy state.
        Native/master caches are shared by the evaluator process; each B4
        instance additionally waits for its original-heuristic bridge to load.
        """
        from gkbench import engine
        engine.setup()
        engine.native()
        engine.master()
        if self.objective != "battle-projection":
            self.bridge

    def _validate(self, ctx):
        kind = exam_kind(ctx.obs, ctx.loadout)
        self.bridge.request(op="adapt", obs=ctx.obs, loadout=ctx.loadout,
                            history=self._public_history)
        if self.objective == "expected-rank-v2" and kind == "midterm":
            if str(ctx.obs["exam"].get("produce")) not in {
                "produce-001", "produce-002", "produce-003", "produce-006"
            }:
                raise UnsupportedSearch("B4v2 midterm projection supports Hajime modes only")
            rival_above_probabilities(0, ctx.meta.get("rival_scores"))
        return kind

    def begin(self, ctx):
        self._public_history = []
        self._pending_public_action = None
        self._validate(ctx)

    def _accept_pending(self, obs):
        if self._pending_public_action is None:
            return
        before = self._pending_public_action["obs"].get("i")
        after = obs.get("i")
        if type(before) is not int or type(after) is not int or after != before + 1:
            raise UnsupportedSearch("public observation index does not confirm the prior action")
        self._public_history.append(self._pending_public_action)
        self._pending_public_action = None

    def _record_decision(self, ctx, action, meta):
        # Only real root screens and our returned actions enter this history.
        # It is never populated from sampled worlds or rollout observations.
        # Keep the action pending until the next root screen confirms acceptance.
        self._pending_public_action = {"obs": deepcopy(ctx.obs), "action": list(action)}
        return Decision(action, meta)

    def _battle(self, world, obs):
        return _NativeBattle(world.clone(), obs)

    def _check_time(self, deadline):
        if self._clock() >= deadline:
            raise SearchBudgetExceeded("search deadline reached")

    def _continuation(self, obs, loadout, kind):
        legal = _legal(obs)
        if self.objective == "expected-rank-v2" and kind != "final":
            legal = [a for a in legal if a[0] != "drink"]
            if not legal:
                raise UnsupportedSearch("no continuation action after retaining midterm drinks")
        if len(legal) == 1:
            return legal[0]
        # GHL's keepDrinksUntilFinal filters PolicyInput.legalActions, not the
        # visible drink inventory; preserve that distinction in the UI envelope.
        filtered = dict(obs, legal=[list(a) for a in legal])
        result = self.bridge.request(op="decide", obs=filtered, loadout=loadout, policy="B1v2")
        action = _action(result["action"])
        if action not in legal:
            raise UnsupportedSearch(f"B1v2 continuation returned illegal action {action!r}")
        return action

    def _value(self, battle, ctx, kind):
        obs = battle.obs()
        if self.objective == "battle-projection":
            return battle_projection(obs, terminal=battle.finished)
        score = int(obs["num"]["score"])
        if self.objective == "raw-score" or kind == "final":
            return float(score)
        result = self.bridge.request(
            op="midterm_value", score=score,
            above=rival_above_probabilities(score, ctx.meta["rival_scores"]),
            held=list(ctx.obs.get("drinks", ())), remaining=list(obs.get("drinks", ())),
            week=10,
        )
        value = float(result["value"])
        if not math.isfinite(value):
            raise UnsupportedSearch("nonfinite midterm objective")
        return value

    def _evaluate(self, world, action, ctx, kind, deadline):
        battle = self._battle(world, ctx.obs)
        self._check_time(deadline)
        battle.step(action)
        transitions = 1
        if self.objective != "battle-projection":
            while not battle.finished:
                self._check_time(deadline)
                if transitions >= self.max_steps:
                    raise UnsupportedSearch("rollout did not finish within max_steps; no partial score used")
                chosen = self._continuation(battle.obs(), ctx.loadout, kind)
                battle.step(chosen)
                transitions += 1
        self._check_time(deadline)
        return self._value(battle, ctx, kind), transitions

    def decide(self, ctx):
        started = self._clock()
        self._accept_pending(ctx.obs)
        budget = min(self.seconds, float(getattr(ctx, "budget", self.seconds)))
        deadline = started + max(0, budget - 0.1)
        kind = self._validate(ctx)
        legal = _legal(ctx.obs)
        if len(legal) == 1:
            return self._record_decision(ctx, legal[0], {"forced": True, "objective": self.objective})
        self._check_time(deadline)
        acquisition_started = self._clock()
        worlds = ctx.worlds(self.samples)
        acquisition_seconds = self._clock() - acquisition_started
        # Hosted GKBench excludes server-side world generation from step_ms,
        # but its API does not return that duration. Avoid cancelling a search
        # before it starts when world generation/import queues are slow. Our
        # local work deadline excludes the whole acquisition call, which we
        # report separately; full client_ms/elapsed_s and official server timing
        # are unchanged (network and local import may still count as over_steps).
        deadline += acquisition_seconds
        if len(worlds) != self.samples:
            raise UnsupportedSearch(f"requested {self.samples} sampled worlds, received {len(worlds)}")
        sums = [0.0] * len(legal)
        complete, transitions, timed_out = 0, 0, False
        for world in worlds:
            row = []
            try:
                for action in legal:
                    value, steps = self._evaluate(world, action, ctx, kind, deadline)
                    row.append(value)
                    transitions += steps
                self._check_time(deadline)
            except SearchBudgetExceeded:
                timed_out = True
                break
            for i, value in enumerate(row):
                sums[i] += value
            complete += 1
        if not complete:
            raise SearchBudgetExceeded("no complete action sweep within budget; no fallback action submitted")
        # Strict > preserves the original GHL first-legal-action tie break.
        best = max(range(len(legal)), key=lambda i: sums[i])
        elapsed = self._clock() - started
        return self._record_decision(ctx, legal[best], {
            "objective": self.objective, "kind": kind,
            "worlds_requested": self.samples, "worlds_completed": complete,
            "budget_reduced": timed_out, "simulated_transitions": transitions,
            "elapsed_s": round(elapsed, 4),
            "world_acquisition_s": round(acquisition_seconds, 4),
            "decision_s_excluding_world_acquisition": round(elapsed - acquisition_seconds, 4),
            "expected": [{"action": list(a), "value": sums[i] / complete} for i, a in enumerate(legal)],
            **({"rival_model": "independent uniform integer score_min..score_max; player wins ties",
                "drink_arrival_prior": "GHL arrivalsAfter(10), capacity 3"}
               if self.objective == "expected-rank-v2" and kind == "midterm" else {}),
        })


class GHLB2(_Search):
    name = "ghl-b2-battle-projection-gkms"
    title = "GHL B2 battle-value projection / GKMS"
    objective = "battle-projection"
    about = dict(_Search.about,
                 summary="One-step sampled-world GHL B2 battle-value projection.",
                 detail=[_Search.about["detail"][0], _Search.about["detail"][2], _Search.about["detail"][3],
                     "Uses the original battle term only; campaign resources and terminal evaluation are unavailable.",
                     "The battle formula is retained on the terminal screen with zero remaining turns; no continuation is used."])

    def _validate(self, ctx):
        kind = exam_kind(ctx.obs, ctx.loadout)
        # ProducePlanType.PLAN2 is the numeric enum 3 (the name includes PLAN2).
        # B2 never calls card() or a heuristic: native transitions determine all
        # card effects, so GHL card-counter/mapping gaps are immaterial here.
        if ctx.obs.get("v") not in ("uiobs.v1", "uiobs.v2") or ctx.obs["exam"].get("plan") != 3:
            raise UnsupportedSearch("B2 projection supports public Logic (PLAN2=3) observations only")
        if not math.isfinite(battle_projection(ctx.obs)):
            raise UnsupportedSearch("nonfinite B2 battle value")
        return kind


class GHLB4(_Search):
    pass


class GHLB4V2(_Search):
    name = "ghl-b4v2-expected-rank-gkms"
    title = "GHL B4v2 expected-rank adaptation / GKMS"
    objective = "expected-rank-v2"
    about = dict(_Search.about,
                 summary="GHL B4v2 with explicit expected-rank midterm adaptation.",
                 detail=_Search.about["detail"] + [
                     "Final objective is raw score. Midterm uses original GHL rating/placement values and drink reserve prices.",
                     "Rivals are modeled independently and uniformly over public integer score ranges; ties favor the player.",
                     "Uses GHL's week-10 future-drink prior and three-slot reserve capacity; these are model assumptions.",
                     "Midterm continuations retain drinks; evaluated root drink actions pay the reserve cost."])
