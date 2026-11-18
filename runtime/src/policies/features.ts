// Public card-effect features for heuristic policies. Reads only public content
// (card definitions) and the public battle view; never the engine state.
import { card } from "../content/index.ts";

export interface CardFeatures {
  costGeneric: number;
  costStamina: number;
  costGI: number;
  costMotivation: number;
  assignments: { lhs: string; op: string; rhs: any; delayed: boolean }[];
  calls: { name: string; args: number[]; delayed: boolean }[];
}

const cache = new Map<number, CardFeatures>();

function walk(node: any, delayed: boolean, out: CardFeatures): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach((n) => walk(n, delayed, out));
  const d = delayed || !!node.phase;
  if (node.type === "assignment") out.assignments.push({ lhs: node.lhs, op: node.op, rhs: node.rhs, delayed: d });
  if (node.type === "call") out.calls.push({ name: node.name, args: (node.args ?? []).map((a: any) => (a?.type === "number" ? a.value : 0)), delayed: d });
  for (const k of ["actions", "effects"]) if (node[k]) walk(node[k], d, out);
}

export function features(defId: number): CardFeatures {
  let f = cache.get(defId);
  if (f) return f;
  const c = card(defId);
  f = { costGeneric: 0, costStamina: 0, costGI: 0, costMotivation: 0, assignments: [], calls: [] };
  const costs: any[] = [];
  const tmp: CardFeatures = { ...f, assignments: [], calls: [] };
  walk(c.raw.cost, false, tmp);
  costs.push(...tmp.assignments);
  for (const a of costs) {
    const v = a.rhs?.type === "number" ? a.rhs.value : 0;
    if (a.op !== "-=") continue;
    if (a.lhs === "cost") f.costGeneric += v;
    else if (a.lhs === "stamina") f.costStamina += v;
    else if (a.lhs === "goodImpressionTurns") f.costGI += v;
    else if (a.lhs === "motivation") f.costMotivation += v;
  }
  walk(c.raw.actions, false, f);
  walk(c.raw.effects, true, f);
  cache.set(defId, f);
  return f;
}

export function evalExpr(e: any, vars: Record<string, number>): number {
  if (!e) return 0;
  switch (e.type) {
    case "number":
      return e.value;
    case "identifier":
      return vars[e.name] ?? 0;
    case "binary": {
      const l = evalExpr(e.left, vars);
      const r = evalExpr(e.right, vars);
      switch (e.op) {
        case "+":
          return l + r;
        case "-":
          return l - r;
        case "*":
          return l * r;
        case "/":
          return r ? l / r : 0;
        default:
          return 0;
      }
    }
    default:
      return 0;
  }
}

export interface BattleContextVars {
  goodImpressionTurns: number;
  motivation: number;
  genki: number;
  stamina: number;
  maxStamina: number;
  consumedGoodImpressionTurns: number;
  consumedGenki: number;
  consumedStamina: number;
  turnsRemaining: number;
  score: number;
  [k: string]: number;
}

export interface CardEstimate {
  score: number; // immediate score estimate (before multipliers)
  giGain: number;
  motivationGain: number;
  genkiGain: number;
  extraUses: number;
  extraTurns: number;
  draws: number;
  giEffectBuff: number;
  scoreBuff: number;
  delayedLines: number;
}

export function estimateCard(defId: number, v: BattleContextVars): CardEstimate {
  const f = features(defId);
  const est: CardEstimate = { score: 0, giGain: 0, motivationGain: 0, genkiGain: 0, extraUses: 0, extraTurns: 0, draws: 0, giEffectBuff: 0, scoreBuff: 0, delayedLines: 0 };
  const vars = { ...v, goodImpressionTurns: Math.max(0, v.goodImpressionTurns - f.costGI), motivation: Math.max(0, v.motivation - f.costMotivation) };
  for (const a of f.assignments) {
    if (a.delayed) {
      est.delayedLines++;
      continue;
    }
    const val = evalExpr(a.rhs, vars);
    if (a.lhs === "score" && a.op === "+=") est.score += val;
    else if (a.lhs === "goodImpressionTurns" && a.op === "+=") {
      est.giGain += val;
      vars.goodImpressionTurns += val;
    } else if (a.lhs === "goodImpressionTurns" && a.op === "*=") {
      const add = vars.goodImpressionTurns * (val - 1);
      est.giGain += add;
      vars.goodImpressionTurns += add;
    } else if (a.lhs === "motivation" && a.op === "+=") est.motivationGain += val;
    else if (a.lhs === "genki" && a.op === "+=") est.genkiGain += val * (1 + v.motivation / 10);
    else if (a.lhs === "cardUsesRemaining" && a.op === "+=") est.extraUses += val;
    else if (a.lhs === "turnsRemaining" && a.op === "+=") est.extraTurns += val;
  }
  for (const c of f.calls) {
    if (c.delayed) continue;
    if (c.name === "drawCard") est.draws += c.args[0] || 1;
    else if (c.name === "setGoodImpressionTurnsEffectBuff") est.giEffectBuff += c.args[0] || 0;
    else if (c.name === "setScoreBuff") est.scoreBuff += c.args[0] || 0;
  }
  return est;
}
