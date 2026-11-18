// Match GKMS card identifiers to the numeric IDs used by the GHL policies.
import { readFileSync } from "node:fs";
import path from "node:path";
import { ConfigError } from "../core/errors.ts";
import { runtimeRoot } from "../core/paths.ts";
import { cards } from "./index.ts";

interface MasterData {
  meta: { schema: string };
  cards: Record<string, { name: string }>;
}
let masterData: MasterData;
function master(): MasterData {
  if (!masterData) {
    const filename = path.join(runtimeRoot, "upstream", "derived", "hajime-master.json");
    const table = JSON.parse(readFileSync(filename, "utf8"));
    if (table.meta?.schema !== "ghl-hajime-master-v1") throw new ConfigError(`Unexpected card table schema in ${filename}`);
    masterData = table;
  }
  return masterData;
}

// Spelling differences between gakumas-tools and the game data (engine name -> game name).
const ALIASES: Record<string, string> = { ストレッチ談義: "ストレッチ談議", 愛をこめて: "愛を込めて", 月明りに包まれて: "月明かりに包まれて", 夢と現境界線: "夢と現の境界線" };
const strip = (n: string) => {
  const b = n.normalize("NFKC").replace(/\++$/, "");
  return ALIASES[b] ?? b;
};

/** Engine card id for a master card id at an upgrade level (null if unmapped). */
export function engineCardFor(masterCardId: string, upgradeLevel: number): number | null {
  const m = master().cards[`${masterCardId}#0`] ?? master().cards[`${masterCardId}#${upgradeLevel}`];
  if (!m) return null;
  const candidates = [...cards().values()].filter((c) => strip(c.name) === m.name.normalize("NFKC").replace(/\++$/, ""));
  const wantUp = upgradeLevel > 0;
  const hit = candidates.find((c) => c.upgraded === wantUp) ?? candidates.find((c) => !c.upgraded);
  return hit ? hit.id : null;
}
