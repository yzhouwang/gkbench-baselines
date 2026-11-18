// GHL B1 exam scoring and source-order tie breaking.
import { card } from "../content/index.ts";
import type { LegalAction, Observation } from "./battleView.ts";
import { estimateCard, type BattleContextVars } from "./features.ts";

function find(legal: LegalAction[], pred: (a: LegalAction) => boolean): LegalAction | undefined {
  return legal.find(pred);
}

export function best<T>(items: T[], score: (x: T) => number): T {
  let b = items[0];
  let bs = -Infinity;
  for (const x of items) {
    const s = score(x);
    if (s > bs) {
      bs = s;
      b = x;
    }
  }
  return b;
}

// ------------------------------------------------------------------ battle

function battleVars(b: any): BattleContextVars {
  const buffs = b.buffs ?? {};
  return {
    goodImpressionTurns: buffs.goodImpressionTurns ?? 0,
    motivation: buffs.motivation ?? 0,
    genki: buffs.genki ?? 0,
    stamina: b.stamina,
    maxStamina: b.maxStamina,
    consumedGoodImpressionTurns: buffs.consumedGoodImpressionTurns ?? 0,
    consumedGenki: buffs.consumedGenki ?? 0,
    consumedStamina: buffs.consumedStamina ?? 0,
    turnsRemaining: b.turnsRemaining,
    score: b.score,
    cardsUsed: buffs.cardsUsed ?? 0,
  };
}

function turnMultiplier(b: any): number {
  if (b.kind !== "exam") return 1;
  const t = b.turnTypes?.[Math.min(b.turn - 1, b.turnTypes.length - 1)] ?? "vocal";
  return b.typeMultipliers?.[t] ?? 1;
}

export function battleCardValue(defId: number, b: any): number {
  const v = battleVars(b);
  const est = estimateCard(defId, v);
  const mult = turnMultiplier(b);
  const T = Math.max(1, b.turnsRemaining);
  const giBuff = (b.buffs?.goodImpressionTurnsEffectBuffs ?? []).reduce((a: number, x: any) => a + (x.amount ?? 0), 0);
  const perGi = Math.min(T, Math.max(1, v.goodImpressionTurns + est.giGain)) * (1 + giBuff) * 0.9;
  const lesson = b.kind === "lesson";
  let value = est.score * mult * (1 + est.scoreBuff);
  value += est.giGain * perGi * (lesson ? 1 : mult) * 0.8;
  value += est.giEffectBuff * Math.max(0, v.goodImpressionTurns) * T * 0.6 * (lesson ? 1 : mult);
  value += est.motivationGain * 1.5;
  value += est.genkiGain * 0.4;
  value += est.extraUses * 12 * (lesson ? 1 : mult);
  value += est.extraTurns * 25 * (lesson ? 1 : mult);
  value += est.draws * 4;
  value += est.delayedLines * 3;
  // Costs
  const f = card(defId);
  const staminaWeight = lesson ? 2.0 : b.label?.includes("final") ? 0.6 : 1.2;
  const costs = (f.raw.cost ?? []) as any[];
  let staminaCost = 0;
  let giCost = 0;
  for (const e of costs) for (const a of e.actions ?? []) {
    const n = a.rhs?.type === "number" ? a.rhs.value : 0;
    if (a.op !== "-=") continue;
    if (a.lhs === "stamina") staminaCost += n;
    if (a.lhs === "cost") staminaCost += Math.max(0, n - v.genki);
    if (a.lhs === "goodImpressionTurns") giCost += n;
  }
  value -= staminaCost * staminaWeight;
  value -= giCost * Math.min(T, v.goodImpressionTurns) * 0.5;
  if (lesson && b.perfectScore != null && b.score >= b.perfectScore) value -= 1000;
  return value;
}

function battleDecision(obs: Observation, legal: LegalAction[]): LegalAction {
  const b = (obs.decision as any).battle;
  if (b.pendingSelection) {
    const sel = legal.filter((a) => a.action.kind === "select_target");
    if (sel.length) {
      return best(sel, (a) => {
        const cand = b.pendingSelection.candidates[(a.action as any).index];
        return battleCardValue(cand.defId, b);
      });
    }
    return legal.find((a) => a.action.kind === "confirm_selection") ?? legal[0];
  }
  const plays = legal.filter((a) => a.action.kind === "play_card");
  const lesson = b.kind === "lesson";
  // Drinks: lessons — only to rescue a clear in the last two turns; exams — final three turns.
  const drinks = legal.filter((a) => a.action.kind === "use_drink");
  if (drinks.length) {
    const lastTurns = b.turnsRemaining <= (lesson ? 2 : 3);
    const needRescue = lesson && b.clearScore != null && b.score < b.clearScore;
    if (lastTurns && (!lesson || needRescue)) return drinks[0];
  }
  if (plays.length) {
    const scored = plays.map((a) => ({ a, v: battleCardValue(b.cards[(a.action as any).card].defId, b) }));
    const top = best(scored, (x) => x.v);
    if (top.v > 0) return top.a;
  }
  return find(legal, (a) => a.action.kind === "end_turn") ?? legal[0];
}

export function heuristicDecide(obs: Observation, legal: LegalAction[]): LegalAction {
  if (legal.length === 1) return legal[0];
  if (obs.phase !== "battle") throw new Error("B1 expects a battle observation");
  return battleDecision(obs, legal);
}
