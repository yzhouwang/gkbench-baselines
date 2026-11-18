// Skill-card levels for a support's スキルカードサポート (rule SUPPORT-ASSIST, ruleset r11).
//
// The game has four levels of most cards (master data ProduceCard upgradeCount 0-3: X, X+, X++, X+++); gakumas-tools has
// the first two. A support's assist can take a card in hand past "+" for as long as it stays there, so the engine needs
// the other two. tools/build-card-levels.py derives them from gakumas-tools' "+" and the master data's differences
// between the levels, into upstream/derived/hajime-card-levels.json (derived game content: built locally, never
// committed). Its check against gakumas-tools' own "+" cards is in the file's meta.validation.
//
// Level cards get ids of their own (LEVEL_ID_BASE + base id * 10 + level) and live only in battles: the engine resolves
// them through SkillCards.getById (patched here, for these ids only), and GHL's card() through registerLevelCard. They
// never enter cards(), so no pool, offer or shop can show one.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { SkillCards, deserializeEffectSequence } from "gakumas-data";
import { ConfigError } from "../core/errors.ts";
import { runtimeRoot } from "../core/paths.ts";
import { cards, registerLevelCard, type CardDef } from "./index.ts";

export const CARD_LEVELS_PATH = path.join(runtimeRoot, "upstream", "derived", "hajime-card-levels.json");
export const LEVEL_ID_BASE = 1_000_000;
const BUILD = "the data preparation command in the project README";

interface LevelsFile {
  meta: { schema: string; version: number; dumpCommit: string; gakumasToolsCommit: string; validation: any; derived: Record<string, number> };
  cards: Record<string, { name: string; maxLevel: number; plusId: number | null; levels: Record<string, Record<string, string>>; why: Record<string, string> }>;
}

export interface CardLevels {
  /** The card's base (level 0) engine id and its level; null for an id GHL has no levels for. */
  of(id: number): { base: number; level: number } | null;
  /** The engine id of a base card at a level; null when GHL has no definition of that level. */
  idAt(base: number, level: number): number | null;
  /** The game's highest level of the card (master data): 0 for trouble and Legend cards. */
  maxLevel(base: number): number;
  meta: LevelsFile["meta"];
}

let loaded: CardLevels | null = null;

/** Load the levels, register the level cards with the engine and with card(). Idempotent. */
export function cardLevels(): CardLevels {
  if (loaded) return loaded;
  if (!existsSync(CARD_LEVELS_PATH)) throw new ConfigError(`card levels not built (rule SUPPORT-ASSIST needs them): run ${BUILD}`);
  const raw = JSON.parse(readFileSync(CARD_LEVELS_PATH, "utf8")) as LevelsFile;
  if (raw.meta?.schema !== "ghl-hajime-card-levels-v1") throw new ConfigError(`unexpected card levels schema ${raw.meta?.schema}: rebuild with ${BUILD}`);
  const all = cards();
  const levelOf = new Map<number, { base: number; level: number }>();
  const ids = new Map<number, (number | null)[]>();
  const max = new Map<number, number>();
  const synthetic = new Map<number, any>();
  for (const [baseStr, rec] of Object.entries(raw.cards)) {
    const base = Number(baseStr);
    const b = all.get(base);
    if (!b) continue;
    const plus = rec.plusId !== null ? all.get(rec.plusId) : undefined;
    const row: (number | null)[] = [base, plus ? plus.id : null, null, null];
    levelOf.set(base, { base, level: 0 });
    if (plus) levelOf.set(plus.id, { base, level: 1 });
    for (const k of [2, 3]) {
      const dsl = rec.levels[String(k)];
      if (!dsl || !plus) break;
      const id = LEVEL_ID_BASE + base * 10 + k;
      const src = plus.raw;
      if ((dsl.limit || "") !== String(src.limit ?? "")) throw new ConfigError(`card levels: ${rec.name} level ${k} changes the card's limit; rebuild with ${BUILD}`);
      // The engine's card object, as gakumas-data builds its own (data/skillCards.js), from the derived DSL.
      const sc = {
        ...src,
        id,
        name: `${src.name}${"+".repeat(k - 1)}`,
        upgraded: true,
        conditions: deserializeEffectSequence(dsl.conditions ?? ""),
        cost: deserializeEffectSequence(dsl.cost ?? ""),
        actions: deserializeEffectSequence(dsl.actions ?? ""),
        effects: deserializeEffectSequence(dsl.effects ?? ""),
        ghlLevel: k,
      };
      synthetic.set(id, sc);
      row[k] = id;
      levelOf.set(id, { base, level: k });
      const def: CardDef = { ...plus, id, name: sc.name, upgraded: true, upgradedId: null, raw: sc };
      registerLevelCard(def);
    }
    ids.set(base, row);
    max.set(base, rec.maxLevel);
  }
  // The engine looks cards up by id through the gakumas-data class: answer for the level ids, defer for every other.
  const orig = SkillCards.getById.bind(SkillCards);
  (SkillCards as any).getById = (id: number) => synthetic.get(id) ?? orig(id);
  loaded = {
    of: (id) => levelOf.get(id) ?? null,
    idAt: (base, level) => ids.get(base)?.[level] ?? null,
    maxLevel: (base) => max.get(base) ?? (all.get(base)?.upgradedId ? 1 : 0),
    meta: raw.meta,
  };
  return loaded;
}
