// Exam decision from GHL heuristic2Sense.ts at 777aa954d8d1f780455c0dceb166747c3d628979.
// For each legal play, value its immediate score and the change in future scoring,
// using the public hand and visible deck composition to price draws and buffs.
import { card } from "../content/index.ts";
import { best } from "../policies/heuristic.ts";
import { evalExpr } from "../policies/features.ts";
import type { Observation, LegalAction } from "../policies/battleView.ts";

const KEY_DRINKS = new Set([22, 12, 14, 18]); // 初星黒酢, ブーストエキス, センブリソーダ, 初星ホエイプロテイン
const HIT_RATE = 0.75; // the share of plays that carry a score line, when the deck gives no better estimate
const PER_TURN = new Set(["beforeStartOfTurn", "startOfTurn", "afterStartOfTurn", "turn", "everyTurn", "endOfTurn"]);
const ON_PLAY = new Set(["cardUsed", "activeCardUsed", "afterCardUsed", "afterActiveCardUsed"]);

interface Vars {
  goodConditionTurns: number;
  perfectConditionTurns: number;
  concentration: number;
  genki: number;
  stamina: number;
  [k: string]: number;
}

interface Play {
  score: number; // score now (multipliers applied)
  uses: number; // card uses added
  draws: number;
  doubled: number; // next cards whose effect is doubled
  scoreBuff: number; // score buffs set up (amount; for the turns they last, approximated as the battle)
  concEff: number; // 集中 effect buffs set up
  staminaPaid: number;
  triggers: any[]; // effects the card sets up for later (phase blocks)
}

function condOk(conds: any[] | undefined, v: Vars): boolean {
  for (const c of conds ?? []) {
    if (c?.type !== "comparison") continue;
    const l = evalExpr(c.left, v);
    const r = evalExpr(c.right, v);
    const ok = c.op === ">=" ? l >= r : c.op === ">" ? l > r : c.op === "<=" ? l <= r : c.op === "<" ? l < r : c.op === "==" ? l === r : c.op === "!=" ? l !== r : true;
    if (!ok) return false;
  }
  return true;
}

export interface Outlook {
  T: number; // turns left, this one included
  usesLeft: number; // card uses left this turn
  mult: number[]; // the multiplier of each turn left (index 0: this turn)
  base: number; // mean base of a score line
  hitsPerTurn: number; // score lines expected on a later turn
  scoreBuff: number; // score buffs held
  concEff: number; // 集中 effect buffs held
}

function scoreLine(x: number, v: Vars, o: Outlook, gm: number, cm: number, extraBuff: number, mult: number): number {
  if (x <= 0) return 0;
  let s = Math.ceil(x + v.concentration * cm * (1 + o.concEff) - 1e-9);
  if (v.goodConditionTurns > 0) s *= 1 + (0.5 + (v.perfectConditionTurns > 0 ? 0.1 * v.goodConditionTurns : 0)) * gm;
  return Math.ceil(s * (1 + o.scoreBuff + extraBuff) - 1e-9) * mult;
}

function apply(a: any, v: Vars, o: Outlook, out: Play, m: { gm: number; cm: number }): void {
  if (!a) return;
  if (a.type === "identifier") {
    if (a.name === "drawCard") out.draws += 1;
    return;
  }
  if (a.type === "call") {
    const n = (i: number) => (a.args?.[i]?.type === "number" ? a.args[i].value : 0);
    if (a.name === "drawCard") out.draws += n(0) || 1;
    else if (a.name === "setScoreBuff") out.scoreBuff += n(0);
    else if (a.name === "setConcentrationEffectBuff") out.concEff += n(0);
    return;
  }
  if (a.type !== "assignment") return;
  const x = evalExpr(a.rhs, v);
  const op = a.op as string;
  const add = (k: string) => {
    if (op === "+=") v[k] = (v[k] ?? 0) + x;
    else if (op === "-=") v[k] = Math.max(0, (v[k] ?? 0) - x);
    else if (op === "*=") v[k] = (v[k] ?? 0) * x;
    else if (op === "=") v[k] = x;
  };
  switch (a.lhs) {
    case "score":
      if (op === "+=") out.score += scoreLine(x, v, o, m.gm, m.cm, out.scoreBuff, o.mult[0] ?? 1);
      return;
    case "goodConditionTurnsMultiplier":
      m.gm = x;
      return;
    case "concentrationMultiplier":
      m.cm = x;
      return;
    case "cardUsesRemaining":
      if (op === "+=") out.uses += x;
      return;
    case "doubleCardEffectCards":
      if (op === "+=") out.doubled += x;
      return;
    case "stamina":
    case "fixedStamina":
      if (op === "-=") out.staminaPaid += x;
      return;
    case "cost": {
      if (op !== "-=") return;
      const fromGenki = Math.min(v.genki, x);
      v.genki -= fromGenki;
      out.staminaPaid += x - fromGenki;
      return;
    }
    case "fixedGenki":
      if (op === "+=") v.genki += x;
      return;
    default:
      add(a.lhs);
  }
}

function runBlocks(blocks: any[] | undefined, v: Vars, o: Outlook, out: Play, m: { gm: number; cm: number }): void {
  for (const blk of blocks ?? []) {
    if (!blk || typeof blk !== "object") continue;
    if (blk.type) {
      apply(blk, v, o, out, m);
      continue;
    }
    if (blk.phase) {
      out.triggers.push(blk);
      continue;
    }
    if (!condOk(blk.conditions, v)) continue;
    for (const a of blk.actions ?? []) apply(a, v, o, out, m);
  }
}

const scoreLines = new Map<number, number[]>();
/** The base of each immediate score line of a card (cached: a card's DSL never changes). */
function scoreLinesOf(defId: number): number[] {
  const hit = scoreLines.get(defId);
  if (hit) return hit;
  const out: number[] = [];
  const walk = (n: any) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (n.type === "assignment" && n.lhs === "score" && n.op === "+=" && n.rhs?.type === "number") out.push(n.rhs.value);
    for (const k of ["actions", "effects"]) if (n[k] && !n.phase) walk(n[k]);
  };
  walk(card(defId).raw.actions);
  scoreLines.set(defId, out);
  return out;
}

export function outlook(b: any): Outlook {
  const T = Math.max(1, b.turnsRemaining ?? 1);
  const types: string[] = b.turnTypes ?? [];
  const turn0 = Math.max(0, (b.turn ?? 1) - 1);
  const mult = Array.from({ length: T }, (_, k) => (b.kind === "exam" ? (b.typeMultipliers?.[types[Math.min(turn0 + k, types.length - 1)] ?? "vocal"] ?? 1) : 1));
  // The deck in play: the draw pile, the hand and the discard pile.
  const ids: string[] = [...(b.drawPile?.contents ?? []), ...(b.hand ?? []).map((h: any) => h.id ?? h), ...(b.discardPile ?? [])];
  const defs = ids.map((id) => b.cards?.[id]?.defId).filter((x: any) => typeof x === "number") as number[];
  let lines = 0;
  let sum = 0;
  let scoring = 0;
  for (const d of defs) {
    const s = scoreLinesOf(d);
    if (s.length) scoring++;
    lines += s.length;
    for (const x of s) sum += x;
  }
  const base = lines ? sum / lines : 8;
  const hitRate = defs.length ? Math.max(0.3, Math.min(1.2, lines / defs.length)) : HIT_RATE;
  const buffs = b.buffs ?? {};
  const sumOf = (k: string) => (buffs[k] ?? []).reduce((s: number, x: any) => s + (x.amount ?? 0), 0);
  void scoring;
  return { T, usesLeft: b.cardUsesRemaining ?? 1, mult, base, hitsPerTurn: 1.15 * hitRate, scoreBuff: sumOf("scoreBuffs"), concEff: sumOf("concentrationEffectBuffs") };
}

/** The score still to come from the buff state, F in the header. `usesNow`: the card uses left this turn after the decision. */
export function futureScore(good: number, perfect: number, conc: number, o: Outlook, usesNow: number, hitRate = o.hitsPerTurn / 1.15): number {
  let f = 0;
  for (let k = 0; k < o.T; k++) {
    const g = good - k;
    const p = perfect - k;
    const factor = g > 0 ? 1.5 + (p > 0 ? 0.1 * g : 0) : 1;
    const hits = k === 0 ? usesNow * hitRate : o.hitsPerTurn;
    f += hits * (o.base + conc * (1 + o.concEff)) * factor * o.mult[k] * (1 + o.scoreBuff);
  }
  return f;
}

function varsOf(b: any): Vars {
  const buffs = b.buffs ?? {};
  return {
    goodConditionTurns: buffs.goodConditionTurns ?? 0,
    perfectConditionTurns: buffs.perfectConditionTurns ?? 0,
    concentration: buffs.concentration ?? 0,
    genki: buffs.genki ?? 0,
    stamina: b.stamina ?? 0,
    turnsRemaining: b.turnsRemaining ?? 1,
    turnsElapsed: Math.max(0, (b.turn ?? 1) - 1),
  };
}

/** What playing the card does now: its costs, then its actions, branch conditions read on the running state. */
export function simulateSensePlay(defId: number, b: any, o: Outlook = outlook(b)): { play: Play; before: Vars; after: Vars } {
  const before = varsOf(b);
  const v: Vars = { ...before };
  const out: Play = { score: 0, uses: 0, draws: 0, doubled: 0, scoreBuff: 0, concEff: 0, staminaPaid: 0, triggers: [] };
  const m = { gm: 1, cm: 1 };
  const def = card(defId);
  runBlocks(def.raw.cost, v, o, out, m);
  m.gm = 1;
  m.cm = 1;
  runBlocks(def.raw.actions, v, o, out, m);
  return { play: out, before, after: v };
}

export function senseCardValue(defId: number, b: any, o: Outlook = outlook(b), handValues?: number[]): number {
  const { play, before, after } = simulateSensePlay(defId, b, o);
  const usesAfter = Math.max(0, o.usesLeft - 1 + play.uses);
  let value = play.score;
  const fBefore = futureScore(before.goodConditionTurns, before.perfectConditionTurns, before.concentration, o, Math.max(0, o.usesLeft - 1));
  const fAfter = futureScore(after.goodConditionTurns, after.perfectConditionTurns, after.concentration, { ...o, scoreBuff: o.scoreBuff + play.scoreBuff, concEff: o.concEff + play.concEff }, usesAfter);
  value += fAfter - fBefore;
  // A hit now, at this turn's scale, prices draws, a doubled card and the triggers the card sets up.
  const hitNow = (o.base + after.concentration) * (after.goodConditionTurns > 0 ? 1.5 + (after.perfectConditionTurns > 0 ? 0.1 * after.goodConditionTurns : 0) : 1) * (o.mult[0] ?? 1);
  const bestOther = handValues && handValues.length ? Math.max(0, ...handValues) : hitNow;
  value += play.doubled * 0.8 * bestOther;
  value += play.draws * 0.25 * hitNow;
  for (const t of play.triggers) {
    const lines = (t.actions ?? []).filter((a: any) => a?.type === "assignment" && a.lhs === "score" && a.op === "+=");
    const gains = (t.actions ?? []).filter((a: any) => a?.type === "assignment" && ["concentration", "goodConditionTurns", "perfectConditionTurns"].includes(a.lhs) && a.op === "+=");
    const fires = PER_TURN.has(t.phase) ? Math.min(t.limit ?? o.T, Math.max(0, o.T - 1)) : ON_PLAY.has(t.phase) ? Math.min(t.limit ?? 99, o.hitsPerTurn * Math.max(0, o.T - 1) + usesAfter) : Math.min(t.limit ?? 2, 2);
    for (const l of lines) value += fires * Math.max(0, evalExpr(l.rhs, after) + after.concentration) * (after.goodConditionTurns > 0 ? 1.5 : 1) * (o.mult[0] ?? 1) * 0.7;
    for (const g of gains) {
      const x = evalExpr(g.rhs, after) * fires * 0.5;
      const d = { ...after, [g.lhs]: (after as any)[g.lhs] + x };
      value += futureScore(d.goodConditionTurns, d.perfectConditionTurns, d.concentration, o, usesAfter) - futureScore(after.goodConditionTurns, after.perfectConditionTurns, after.concentration, o, usesAfter);
    }
  }
  value += 0.4 * Math.max(0, after.genki - before.genki);
  const lesson = b.kind === "lesson";
  const staminaWeight = lesson ? 2.0 : String(b.label ?? "").includes("final") ? 0.6 : 1.2;
  value -= play.staminaPaid * staminaWeight;
  if (lesson && b.perfectScore != null && b.score >= b.perfectScore) value -= 1e6;
  return value;
}

export function battleDecision(o: Observation, legal: LegalAction[]): LegalAction {
  const b = (o.decision as any).battle;
  if (b.pendingSelection) {
    const sel = legal.filter((a) => a.action.kind === "select_target");
    if (sel.length) {
      const ol = outlook(b);
      return best(sel, (a) => senseCardValue(b.pendingSelection.candidates[(a.action as any).index].defId, b, ol));
    }
    return legal.find((a) => a.action.kind === "confirm_selection") ?? legal[0];
  }
  const lesson = b.kind === "lesson";
  const drinks = legal.filter((a) => a.action.kind === "use_drink");
  if (drinks.length) {
    // Exams: the midterm all in, the final's last five turns (B1v2's rule), key drinks first. Lessons: only to rescue a clear late.
    const midterm = String(b.label).includes("midterm");
    const rescue = lesson && b.clearScore != null && b.score < b.clearScore && b.turnsRemaining <= 2;
    if ((!lesson && (midterm || b.turnsRemaining <= 5)) || rescue) {
      return best(drinks, (a) => (KEY_DRINKS.has(b.drinks.find((x: any) => x.id === (a.action as any).drink)?.drinkId) ? 2 : 1));
    }
  }
  const plays = legal.filter((a) => a.action.kind === "play_card");
  if (plays.length) {
    const ol = outlook(b);
    const firstPass = plays.map((a) => senseCardValue(b.cards[(a.action as any).card].defId, b, ol));
    const scored = plays.map((a, i) => ({ a, v: senseCardValue(b.cards[(a.action as any).card].defId, b, ol, firstPass.filter((_, j) => j !== i)) }));
    const top = best(scored, (x) => x.v);
    if (top.v > 0) return top.a;
  }
  return legal.find((a) => a.action.kind === "end_turn") ?? legal[0];
}
