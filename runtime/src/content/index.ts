// Read the pinned upstream card, item and drink definitions from the consumer's checkout.
import { PDrinks, PItems, SkillCards } from "gakumas-data";
import { UnsupportedRule } from "../core/errors.ts";

export type Plan = "sense" | "logic" | "anomaly" | "free";
export type Tier = "N" | "R" | "R+" | "SR" | "SR+" | "SSR" | "SSR+" | "L" | "T";

export interface CardDef {
  id: number;
  name: string;
  rarity: string;
  tier: Tier;
  type: "active" | "mental" | "trouble";
  plan: Plan;
  unlockPlv: number;
  upgraded: boolean;
  unique: boolean;
  sourceType: string;
  pIdolId: number | null;
  limit: number | null;
  availableCustomizations: number[];
  baseId: number;
  upgradedId: number | null;
  raw: any;
}

export interface DrinkDef {
  id: number;
  name: string;
  rarity: "R" | "SR" | "SSR";
  plan: Plan;
  unlockPlv: number;
  raw: any;
}

function tierOf(c: any): Tier {
  if (c.rarity === "L" || c.rarity === "T" || c.rarity === "N") return c.rarity;
  return (c.upgraded ? `${c.rarity}+` : c.rarity) as Tier;
}

let cardCache: Map<number, CardDef> | null = null;

function buildCards(): Map<number, CardDef> {
  const out = new Map<number, CardDef>();
  for (const c of SkillCards.getAll()) {
    const baseId = c.upgraded ? c.id - 1 : c.id;
    const next = SkillCards.getById(c.id + 1);
    const upgradedId = !c.upgraded && next && next.upgraded && next.name === `${c.name}+` ? c.id + 1 : null;
    out.set(c.id, {
      id: c.id,
      name: c.name,
      rarity: c.rarity,
      tier: tierOf(c),
      type: c.type,
      plan: c.plan,
      unlockPlv: c.unlockPlv,
      upgraded: !!c.upgraded,
      unique: !!c.unique,
      sourceType: c.sourceType,
      pIdolId: c.pIdolId ?? null,
      limit: c.limit ?? null,
      availableCustomizations: (c.availableCustomizations ?? []).map((x: string) => Number(x)),
      baseId,
      upgradedId,
      raw: c,
    });
  }
  return out;
}

export function cards(): Map<number, CardDef> {
  cardCache ??= buildCards();
  return cardCache;
}

// Cards of levels 2 and 3 ("++", "+++": content/levels.ts), which exist only in a battle, in a support's スキルカードサポート
// (rule SUPPORT-ASSIST). card() knows them; cards(), which the pools and offers read, does not.
const levelCards = new Map<number, CardDef>();

export function registerLevelCard(def: CardDef): void {
  if (cards().has(def.id)) throw new UnsupportedRule(`level card id ${def.id} collides with an engine card`, { id: def.id });
  levelCards.set(def.id, def);
}

export function card(id: number): CardDef {
  const c = cards().get(id) ?? levelCards.get(id);
  if (!c) throw new UnsupportedRule(`unknown skill card id ${id}`, { id });
  return c;
}

export function drink(id: number): DrinkDef {
  const d = PDrinks.getById(id);
  if (!d) throw new UnsupportedRule(`unknown P-drink id ${id}`, { id });
  return { id: d.id, name: d.name, rarity: d.rarity, plan: d.plan, unlockPlv: d.unlockPlv, raw: d };
}

export function allDrinks(): DrinkDef[] {
  return PDrinks.getAll().map((d: any) => drink(d.id));
}

export function pItem(id: number): any {
  const p = PItems.getById(id);
  if (!p) throw new UnsupportedRule(`unknown P-item id ${id}`, { id });
  return p;
}

export function allPItems(): any[] {
  return PItems.getAll();
}
