// GHL B1v2 good-impression policy with explicit routing to its motivation variant.
import { best, heuristicDecide } from "./heuristic.ts";
import { motivationBattleDecision } from "./heuristic2Motivation.ts";
import type { LegalAction, Observation } from "./battleView.ts";

const KEY_DRINKS = new Set([14, 25, 18, 12]); // センブリソーダ, 特製ハツボシエキス, 初星ホエイプロテイン, ブーストエキス

function battleDecision(o: Observation, legal: LegalAction[]): LegalAction {
  const b = (o.decision as any).battle;
  const drinks = legal.filter((a) => a.action.kind === "use_drink");
  if (!b.pendingSelection && drinks.length && b.kind === "exam") {
    const midterm = String(b.label).includes("midterm");
    if (midterm || b.turnsRemaining <= 5) {
      // Prefer draw/extra-use drinks before scoring cards are chosen this turn.
      const order = (a: LegalAction) => {
        const id = b.drinks.find((x: any) => x.id === (a.action as any).drink)?.drinkId;
        return KEY_DRINKS.has(id) ? 2 : 1;
      };
      return best(drinks, order);
    }
  }
  return heuristicDecide(o, legal.filter((a) => b.kind !== "exam" || a.action.kind !== "use_drink"));
}

export function heuristic2Decide(obs: Observation, legal: LegalAction[], effect: "motivation" | "goodImpressionTurns"): LegalAction {
  if (legal.length === 1) return legal[0];
  if (obs.phase !== "battle") throw new Error("B1v2 expects a battle observation");
  if (effect === "motivation") return motivationBattleDecision(obs, legal);
  if (effect === "goodImpressionTurns") return battleDecision(obs, legal);
  throw new Error(`Unsupported Logic subtype: ${effect}`);
}
