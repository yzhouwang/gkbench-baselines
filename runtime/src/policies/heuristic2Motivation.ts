// B1v2's Logic motivation policy values やる気 by the 元気 gains still to come.
// 元気 can absorb card costs and can turn into score through finishers, P-items
// or installed effects. The policy estimates when each converter will fire,
// weighting cards by the chance of drawing and playing them. A finisher that
// spends 元気 now also consumes its estimated value on later turns.

import { card, pItem } from "../content/index.ts";
import { best } from "./heuristic.ts";
import { evalExpr } from "./features.ts";
import type { LegalAction, Observation } from "./battleView.ts";

const cardDef = card;
const KEY_DRINKS = new Set([14, 25, 18, 12]); // センブリソーダ, 特製ハツボシエキス, 初星ホエイプロテイン, ブーストエキス
const DRAWS_PER_TURN = 3; // gakumas-engine TurnManager: three cards at the start of each turn
const P_CHOSEN = 0.7; // a drawn card is played (one choice among the hand)
/** Effect phases that fire once a turn (TurnManager); other phases fire on events (a cost, a card used, …). */
const PER_TURN = new Set(["beforeStartOfTurn", "startOfTurn", "afterStartOfTurn", "turn", "everyTurn", "endOfTurn"]);
/** A trigger on stamina decreased by a cost (最強パフォーマー): the share of the turns to come whose card pays stamina. */
const STAMINA_PAYING_SHARE = 0.5;

type Vars = Record<string, number>;

interface Installed {
  phase: string;
  /** 元気 added per fire (before やる気), and the やる気 multiplier the effect sets for it (1 if none). */
  genki: number;
  motivationMultiplier: number;
  /** score += genki × k per fire. */
  scoreGenki: number;
  limit: number | null;
  delay: number;
  conditions: any[];
}

interface Sim {
  score: number;
  genkiEvents: number;
  extraUses: number;
  extraTurns: number;
  draws: number;
  scoreBuff: number;
  giEffectBuff: number;
  staminaGain: number;
  installed: Installed[];
}

function condOk(c: any, v: Vars): boolean {
  if (!c || c.type !== "comparison") return true;
  const l = evalExpr(c.left, v);
  const r = evalExpr(c.right, v);
  switch (c.op) {
    case ">=":
      return l >= r;
    case "<=":
      return l <= r;
    case ">":
      return l > r;
    case "<":
      return l < r;
    case "==":
      return l === r;
    case "!=":
      return l !== r;
    default:
      return true;
  }
}

/** score += genki × k → k (the 元気 conversion of one assignment), else 0. */
function genkiCoefficient(a: any): number {
  if (a?.type !== "assignment" || a.lhs !== "score" || a.op !== "+=" || a.rhs?.type !== "binary" || a.rhs.op !== "*") return 0;
  const { left, right } = a.rhs;
  if (left?.type === "identifier" && left.name === "genki" && right?.type === "number") return right.value;
  if (right?.type === "identifier" && right.name === "genki" && left?.type === "number") return left.value;
  return 0;
}

function installedOf(b: any): Installed {
  const acts = (b.actions ?? []).filter((a: any) => a?.type === "assignment");
  const mult = acts.find((a: any) => a.lhs === "motivationMultiplier" && a.op === "=" && a.rhs?.type === "number");
  return {
    phase: b.phase,
    genki: acts.filter((a: any) => a.lhs === "genki" && a.op === "+=" && a.rhs?.type === "number").reduce((s: number, a: any) => s + a.rhs.value, 0),
    motivationMultiplier: mult ? mult.rhs.value : 1,
    scoreGenki: acts.reduce((s: number, a: any) => s + genkiCoefficient(a), 0),
    limit: b.limit ?? null,
    delay: b.delay ?? 0,
    conditions: b.conditions ?? [],
  };
}

function apply(a: any, v: Vars, out: Sim): void {
  if (a.type === "call") {
    const n = a.args?.[0]?.type === "number" ? a.args[0].value : 0;
    if (a.name === "drawCard") out.draws += n || 1;
    else if (a.name === "setScoreBuff") out.scoreBuff += n;
    else if (a.name === "setGoodImpressionTurnsEffectBuff") out.giEffectBuff += n;
    return;
  }
  if (a.type !== "assignment") return;
  const val = evalExpr(a.rhs, v);
  switch (a.lhs) {
    case "score":
      if (a.op === "+=") out.score += val;
      return;
    case "genki": {
      // resolveGenki: a gain gets + やる気 × the multiplier the card has set (1 at its start); any drop counts as consumed.
      const before = v.genki;
      if (a.op === "+=") {
        v.genki += val + v.motivation * (v.motivationMultiplier ?? 1);
        out.genkiEvents++;
      } else if (a.op === "=") v.genki = val;
      else if (a.op === "/=") v.genki = val ? v.genki / val : v.genki;
      else if (a.op === "*=") v.genki *= val;
      else if (a.op === "-=") v.genki = Math.max(0, v.genki - val);
      if (v.genki < before) v.consumedGenki = (v.consumedGenki ?? 0) + before - v.genki;
      return;
    }
    case "motivationMultiplier":
      if (a.op === "=") v.motivationMultiplier = val;
      return;
    case "motivation":
      if (a.op === "+=") v.motivation += val;
      else if (a.op === "-=") v.motivation = Math.max(0, v.motivation - val);
      return;
    case "goodImpressionTurns":
      if (a.op === "+=") v.goodImpressionTurns += val;
      else if (a.op === "*=") v.goodImpressionTurns *= val;
      else if (a.op === "-=") v.goodImpressionTurns = Math.max(0, v.goodImpressionTurns - val);
      return;
    case "cardUsesRemaining":
      if (a.op === "+=") out.extraUses += val;
      return;
    case "turnsRemaining":
      if (a.op === "+=") out.extraTurns += val;
      return;
    case "stamina":
    case "fixedStamina":
      if (a.op === "+=") out.staminaGain += val;
      return;
  }
}

function runBlocks(blocks: any[] | undefined, v: Vars, out: Sim): void {
  for (const b of blocks ?? []) {
    if (!b) continue;
    if (b.type === "assignment" || b.type === "call") {
      apply(b, v, out);
      continue;
    }
    if (b.phase) {
      out.installed.push(installedOf(b));
      continue;
    }
    if (b.targets) continue; // effects on other cards (target:all { … }): not valued
    if (b.conditions && !b.conditions.every((c: any) => condOk(c, v))) continue;
    runBlocks(b.actions, v, out);
  }
}

/** Generic cost (paid from 元気 first), stamina, 好印象 and やる気 costs of a card. */
function costsOf(defId: number): { generic: number; stamina: number; gi: number; motivation: number } {
  const out = { generic: 0, stamina: 0, gi: 0, motivation: 0 };
  for (const e of (card(defId).raw.cost ?? []) as any[])
    for (const a of e.actions ?? []) {
      if (a.op !== "-=" || a.rhs?.type !== "number") continue;
      if (a.lhs === "cost") out.generic += a.rhs.value;
      else if (a.lhs === "stamina") out.stamina += a.rhs.value;
      else if (a.lhs === "goodImpressionTurns") out.gi += a.rhs.value;
      else if (a.lhs === "motivation") out.motivation += a.rhs.value;
    }
  return out;
}

interface CardProfile {
  /** Immediate 元気 conversion (score += genki × k), summed. */
  convert: number;
  /** Consumes 元気 (genki = 0 or /= …) after converting. */
  consumes: boolean;
  /** 元気 gain events when played, their 元気 before やる気, and the やる気 they take (each event's multiplier, 1 unless the card sets one). */
  genkiEvents: number;
  genkiBase: number;
  genkiMotivation: number;
  /** Per-turn effects it installs. */
  installed: Installed[];
}

const profiles = new Map<number, CardProfile>();

export function cardProfile(defId: number): CardProfile {
  let p = profiles.get(defId);
  if (p) return p;
  const acts: any[] = [];
  const installed: Installed[] = [];
  const walk = (bs: any[] | undefined) => {
    for (const b of bs ?? []) {
      if (!b) continue;
      if (b.type) acts.push(b);
      else if (b.phase) installed.push(installedOf(b));
      else if (!b.targets) walk(b.actions);
    }
  };
  walk(card(defId).raw.actions);
  // The やる気 multiplier the card sets applies to the 元気 gains after it (reset to 1 for each card).
  let mult = 1;
  let genkiMotivation = 0;
  for (const a of acts) {
    if (a.type !== "assignment") continue;
    if (a.lhs === "motivationMultiplier" && a.op === "=" && a.rhs?.type === "number") mult = a.rhs.value;
    else if (a.lhs === "genki" && a.op === "+=") genkiMotivation += mult;
  }
  p = {
    convert: acts.reduce((s, a) => s + genkiCoefficient(a), 0),
    consumes: acts.some((a) => a.type === "assignment" && a.lhs === "genki" && (a.op === "=" || a.op === "/=" || a.op === "-=")),
    genkiEvents: acts.filter((a) => a.type === "assignment" && a.lhs === "genki" && a.op === "+=").length,
    genkiBase: acts.filter((a) => a.type === "assignment" && a.lhs === "genki" && a.op === "+=" && a.rhs?.type === "number").reduce((s, a) => s + a.rhs.value, 0),
    genkiMotivation,
    installed,
  };
  profiles.set(defId, p);
  return p;
}

// ------------------------------------------------------------------ battle

interface BattleOutlook {
  /** Turn multiplier now, and of the turn j turns from now (exams; 1 in lessons). */
  multNow: number;
  multAt: (j: number) => number;
  /** Mean multiplier of the turns left, and the last turn's. */
  multMean: number;
  multLast: number;
  T: number;
  motivation: number;
  /** Chance that a card now in the hand or discard comes back before the battle ends (a reshuffle). */
  pReturn: number;
  /** The cards still to come (draw pile, discard, hand, held), with their chance to be played in a later turn. */
  pool: { id: string; defId: number; p: number }[];
  /** 元気 conversion of the active effects (P-items, effects already installed), at their turns. */
  kActive: number;
  /** 元気 gains of the active effects still to come, and their 元気 (with the やる気 now). */
  genkiEventsActive: number;
  genkiActive: number;
  /** Active triggers on stamina decreased by a cost (最強パフォーマー): their 元気 and やる気 multiplier. */
  costTriggers: { genki: number; motivationMultiplier: number }[];
}

function outlook(b: any): BattleOutlook {
  const T = Math.max(1, b.turnsRemaining);
  const exam = b.kind === "exam";
  const types: string[] = b.turnTypes ?? [];
  const multAt = (j: number) => {
    if (!exam) return 1;
    const t = types[Math.min(b.turn - 1 + j, types.length - 1)] ?? "vocal";
    return b.typeMultipliers?.[t] ?? 1;
  };
  let sum = 0;
  for (let j = 0; j < T; j++) sum += multAt(j);
  const motivation = b.buffs?.motivation ?? 0;
  // Draws in the turns to come: the draw pile first, then the hand and discard reshuffled.
  const drawsLeft = DRAWS_PER_TURN * (T - 1);
  const drawN = b.drawPile.count as number;
  const hand: string[] = b.hand.map((h: any) => h.id);
  const pDraw = drawN ? Math.min(1, drawsLeft / drawN) : 0;
  const pReturn = drawsLeft > drawN ? Math.min(1, (drawsLeft - drawN) / Math.max(1, b.discardPile.length + hand.length)) : 0;
  const card = (id: string, p: number) => ({ id, defId: b.cards[id].defId as number, p: p * P_CHOSEN });
  const pool = [...b.drawPile.contents.map((id: string) => card(id, pDraw)), ...(b.heldPile ?? []).map((id: string) => card(id, 1)), ...[...hand, ...b.discardPile].map((id: string) => card(id, pReturn))];
  // Active effects: fires left at the start of the turns to come (turnsRemaining T−1, …, 1 there).
  let kActive = 0;
  let genkiEventsActive = 0;
  let genkiActive = 0;
  const costTriggers: BattleOutlook["costTriggers"] = [];
  for (const e of b.activeEffects ?? []) {
    let blocks: any[] = [];
    try {
      if (e.source === "pItem" && e.sourceId != null) blocks = (pItem(e.sourceId)?.effects ?? []).filter((x: any) => x.phase === e.phase);
      else if (e.sourceCard && b.cards[e.sourceCard]) blocks = (cardDef(b.cards[e.sourceCard].defId).raw.actions ?? []).filter((x: any) => x?.phase === e.phase);
    } catch {
      blocks = []; // content GHL does not know: no conversion assumed
    }
    for (const blk of blocks) {
      const inst = installedOf(blk);
      if (!inst.genki && !inst.scoreGenki) continue;
      if (inst.phase === "staminaDecreased") {
        if (inst.genki) costTriggers.push({ genki: inst.genki, motivationMultiplier: inst.motivationMultiplier });
        continue;
      }
      if (!PER_TURN.has(inst.phase)) continue;
      let fires = 0;
      let k = 0;
      const left = e.limit ?? Infinity;
      // The delay left is not in the view (the engine counts it down; ActiveEffectView has no field for it): counted in
      // full from now, so an effect installed earlier fires sooner than this assumes. Few cards have one (せのびの魔法).
      for (let j = Math.max(1, inst.delay); j < T && fires < left; j++) {
        if (!inst.conditions.every((c: any) => condOk(c, { turnsRemaining: T - j }))) continue;
        fires++;
        k += inst.scoreGenki * multAt(j);
      }
      kActive += k;
      if (inst.genki) {
        genkiEventsActive += fires * inst.motivationMultiplier;
        genkiActive += fires * (inst.genki + motivation * inst.motivationMultiplier);
      }
    }
  }
  return { multNow: multAt(0), multAt, multMean: sum / T, multLast: multAt(T - 1), T, motivation, pReturn, pool, kActive, genkiEventsActive, genkiActive, costTriggers };
}

/**
 * Without card `except`: the expected score per point of 元気 held now (K), the 元気 gain events still to come (each
 * weighted by the やる気 multiplier it takes, so the value of 1 やる気), and the 元気 they bring (with the やる気 now).
 */
function futureOf(o: BattleOutlook, except: string | null): { K: number; events: number; genkiAhead: number } {
  let K = o.kActive;
  let events = o.genkiEventsActive;
  let genkiAhead = o.genkiActive;
  let bestConsumer = 0;
  for (const c of o.pool) {
    if (c.id === except || !c.p) continue;
    const p = cardProfile(c.defId);
    // A finisher that consumes 元気 is kept for the last turn; other converters fire whenever played.
    if (p.convert) {
      if (p.consumes) bestConsumer = Math.max(bestConsumer, p.convert * c.p * o.multLast);
      else K += p.convert * c.p * o.multMean;
    }
    for (const inst of p.installed) {
      if (!PER_TURN.has(inst.phase)) continue;
      const fires = Math.max(0, Math.min(inst.limit ?? o.T, o.T - 1 - inst.delay));
      K += inst.scoreGenki * fires * c.p * o.multMean;
      if (inst.genki) {
        events += fires * c.p * inst.motivationMultiplier;
        genkiAhead += fires * c.p * (inst.genki + o.motivation * inst.motivationMultiplier);
      }
    }
    events += p.genkiMotivation * c.p;
    genkiAhead += c.p * (p.genkiBase + p.genkiMotivation * o.motivation);
  }
  // A consuming finisher takes all the 元気 once: only the best one counts.
  return { K: K + bestConsumer, events, genkiAhead };
}

function battleVars(b: any): Vars {
  const buffs = b.buffs ?? {};
  return {
    genki: buffs.genki ?? 0,
    motivation: buffs.motivation ?? 0,
    goodImpressionTurns: buffs.goodImpressionTurns ?? 0,
    stamina: b.stamina,
    maxStamina: b.maxStamina,
    turnsRemaining: b.turnsRemaining,
    score: b.score,
    consumedGenki: buffs.consumedGenki ?? 0,
    consumedStamina: buffs.consumedStamina ?? 0,
    consumedGoodImpressionTurns: buffs.consumedGoodImpressionTurns ?? 0,
    cardsUsed: buffs.cardsUsed ?? 0,
  };
}

/**
 * Card `defId` played now, as the engine resolves it (its cost first, from 元気 before stamina, with the active stamina
 * triggers; then its actions with the やる気 multiplier reset to 1): the battle variables before and after, and what it did.
 */
export function simulatePlay(defId: number, b: any, o: BattleOutlook = outlook(b)) {
  const v0 = battleVars(b);
  const v: Vars = { ...v0, motivationMultiplier: 1 };
  const sim: Sim = { score: 0, genkiEvents: 0, extraUses: 0, extraTurns: 0, draws: 0, scoreBuff: 0, giEffectBuff: 0, staminaGain: 0, installed: [] };
  const cost = costsOf(defId);
  const fromGenki = Math.min(v.genki, cost.generic);
  v.genki -= fromGenki;
  v.consumedGenki += fromGenki;
  const staminaPaid = cost.stamina + (cost.generic - fromGenki);
  v.goodImpressionTurns = Math.max(0, v.goodImpressionTurns - cost.gi);
  v.motivation = Math.max(0, v.motivation - cost.motivation);
  // A cost that takes stamina fires the active stamina triggers (最強パフォーマー: 元気 with やる気 × 2.5) before the card's actions.
  if (staminaPaid > 0)
    for (const t of o.costTriggers) {
      v.genki += t.genki + v.motivation * t.motivationMultiplier;
      sim.genkiEvents++;
    }
  runBlocks(card(defId).raw.actions, v, sim);
  return { v0, v, sim, cost, staminaPaid };
}

/** The やる気 value of playing card `defId` (battle id `id`, or null for a selection target) now. */
export function motivationCardValue(defId: number, id: string | null, b: any, o: BattleOutlook = outlook(b)): number {
  const lesson = b.kind === "lesson";
  const { v0, v, sim, cost, staminaPaid } = simulatePlay(defId, b, o);

  const { K, events, genkiAhead } = futureOf(o, id);
  const staminaWeight = lesson ? 2.0 : String(b.label).includes("final") ? 0.6 : 1.2;
  const costAhead = 4 * (o.T - 1);
  const shield = costAhead > 0 ? staminaWeight * 0.5 * Math.max(0, Math.min(1, (costAhead - v0.genki) / costAhead)) : 0;
  const vGenki = K + shield;
  const vMotivation = events * vGenki * 0.85;
  const scoreBuffs = (b.buffs?.scoreBuffs ?? []).reduce((a: number, x: any) => a + (x.amount ?? 0), 0);

  let value = sim.score * o.multNow * (1 + scoreBuffs + sim.scoreBuff);
  value += (v.genki - v0.genki) * vGenki;
  // A finisher from the hand played now cannot convert the 元気 still to come, if it would come back.
  const prof = cardProfile(defId);
  if (id !== null && prof.consumes && prof.convert) value -= o.pReturn * prof.convert * o.multLast * (v0.genki + genkiAhead);
  value += (v.motivation - v0.motivation) * vMotivation;
  // Effects it installs: per-turn ones by their fires left, a stamina trigger by the costs to come that take stamina;
  // their 元気 (with the やる気 then) and their conversions of the 元気 then.
  for (const inst of sim.installed) {
    const fires =
      inst.phase === "staminaDecreased" ? STAMINA_PAYING_SHARE * (o.T - 1) : PER_TURN.has(inst.phase) ? Math.max(0, Math.min(inst.limit ?? o.T, o.T - 1 - inst.delay)) : 0;
    value += fires * ((inst.genki ? (inst.genki + v.motivation * inst.motivationMultiplier) * vGenki * 0.85 : 0) + inst.scoreGenki * v.genki * o.multMean);
  }
  // 好印象 terms (B1's) for mixed decks.
  const giGain = v.goodImpressionTurns - (v0.goodImpressionTurns - cost.gi);
  const giBuff = (b.buffs?.goodImpressionTurnsEffectBuffs ?? []).reduce((a: number, x: any) => a + (x.amount ?? 0), 0);
  const perGi = Math.min(o.T, Math.max(1, v.goodImpressionTurns)) * (1 + giBuff) * 0.9;
  value += giGain * perGi * (lesson ? 1 : o.multNow) * 0.8;
  value += sim.giEffectBuff * Math.max(0, v0.goodImpressionTurns) * o.T * 0.6 * (lesson ? 1 : o.multNow);
  value -= cost.gi * Math.min(o.T, v0.goodImpressionTurns) * 0.5;
  value += sim.extraUses * 12 * (lesson ? 1 : o.multMean);
  value += sim.extraTurns * 25 * (lesson ? 1 : o.multMean);
  value += sim.draws * 4;
  value += sim.staminaGain * staminaWeight;
  value -= staminaPaid * staminaWeight;
  if (lesson && b.perfectScore != null && b.score >= b.perfectScore) value -= 1000;
  return value;
}

export function motivationBattleDecision(o: Observation, legal: LegalAction[]): LegalAction {
  const b = (o.decision as any).battle;
  if (b.pendingSelection) {
    const sel = legal.filter((a) => a.action.kind === "select_target");
    if (sel.length) {
      const ol = outlook(b);
      return best(sel, (a) => motivationCardValue(b.pendingSelection.candidates[(a.action as any).index].defId, null, b, ol));
    }
    return legal.find((a) => a.action.kind === "confirm_selection") ?? legal[0];
  }
  const drinks = legal.filter((a) => a.action.kind === "use_drink");
  if (drinks.length) {
    if (b.kind === "exam") {
      // B1v2's exam rule: midterm drinks all in, final drinks in the last 5 turns, key drinks first.
      if (String(b.label).includes("midterm") || b.turnsRemaining <= 5) {
        return best(drinks, (a) => (KEY_DRINKS.has(b.drinks.find((x: any) => x.id === (a.action as any).drink)?.drinkId) ? 2 : 1));
      }
    } else if (b.turnsRemaining <= 2 && b.clearScore != null && b.score < b.clearScore) return drinks[0]; // B1: rescue a lesson's clear
  }
  const plays = legal.filter((a) => a.action.kind === "play_card");
  if (plays.length) {
    const ol = outlook(b);
    const scored = plays.map((a) => {
      const id = (a.action as any).card as string;
      return { a, v: motivationCardValue(b.cards[id].defId, id, b, ol) };
    });
    const top = best(scored, (x) => x.v);
    if (top.v > 0) return top.a;
  }
  return legal.find((a) => a.action.kind === "end_turn") ?? legal.filter((a) => a.action.kind !== "use_drink")[0] ?? legal[0];
}
