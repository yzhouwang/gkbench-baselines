// These upgrades have public GKMS effects whose order or shape differs
// from the + card. Keep its GHL AST, applying the changed fields from the
// pinned ProduceCard and ProduceExamEffect tables checked by prepare_data.py.
import { deserializeEffectSequence } from 'gakumas-data';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { card, registerLevelCard } from '../runtime/src/content/index.ts';
import { cardLevels, LEVEL_ID_BASE } from '../runtime/src/content/levels.ts';
import { native, nativeCards } from './ghl_logic_bridge.mjs';

const supported = new Set([
  'p_card-01-men-3_035', 'p_card-01-act-3_049', 'p_card-01-ido-3_097',
  'p_card-01-ido-3_151', 'p_card-01-ido-3_241', 'p_card-01-act-3_184',
  'p_card-01-ido-3_139', 'p_card-01-sup-2_097',
]);
const registered = new Map();
const number = value => ({type: 'number', value});

const supplementCardId = 'p_card-01-ido-3_249';
let supplementIds;

// This card arrived after the historical Logic data pin. Install its exam
// effects only in this Sense bridge process. Other cards use the old mapping.
export function supplementalCard(spec, instanceId) {
  if (spec.id !== supplementCardId) return null;
  if (!supplementIds) {
    let bytes;
    try {
      bytes = readFileSync(new URL('./fixtures/sense-card-levels.json', import.meta.url));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      throw Error('Sense card 249 requires python tools/prepare_sense_data.py');
    }
    if (createHash('sha256').update(bytes).digest('hex') !== '8176bb16d9706c088a4f083d8af411b6e8c1f703433b887e430b534d312a4ed0')
      throw Error('Sense card supplement checksum differs from the tested data');
    const rows = JSON.parse(bytes)[supplementCardId];
    supplementIds = rows.map((row, level) => {
      const id = [row.base, row.plus][level] ?? LEVEL_ID_BASE + row.base * 10 + level;
      const raw = {id, name: row.name, actions: deserializeEffectSequence(row.actions),
        cost: deserializeEffectSequence(row.cost), conditions: deserializeEffectSequence(row.conditions), effects: []};
      registerLevelCard({id, baseId: row.base, name: row.name, plan: 'sense', type: 'active',
        upgraded: level > 0, upgradedId: level === 0 ? row.plus : null, raw});
      return id;
    });
  }
  const defId = supplementIds[spec.u];
  if (defId === undefined) throw Error(`Unsupported Sense card 249 level ${spec.u}`);
  return {id: instanceId, iid: instanceId, defId};
}

function readEffect(row, type) {
  const matches = row.playEffects.map(p => native.effects.get(p.produceExamEffectId))
    .filter(e => e?.effectType === 'ProduceExamEffectType_' + type);
  if (matches.length !== 1) throw Error(`Unexpected source effect ${type} on ${row.id}+${row.upgradeCount}`);
  return matches[0];
}

export function senseLevel(masterId, base, level) {
  if (![2, 3].includes(level) || !supported.has(masterId)) return null;
  const id = LEVEL_ID_BASE + base * 10 + level;
  if (registered.has(id)) return id;
  const row = nativeCards.get(`${masterId}#${level}`);
  const plus = card(cardLevels().idAt(base, 1));
  const raw = structuredClone(plus.raw);
  const lines = raw.actions[0].actions;
  switch (masterId) {
    case 'p_card-01-ido-3_139': {
      // Only the immediate concentration gain increases. The installed
      // mental-card trigger keeps the + card's timing and amount.
      const before = nativeCards.get(`${masterId}#1`);
      if (row.playEffects[1].produceExamEffectId !== before.playEffects[1].produceExamEffectId ||
          row.forceStamina !== before.forceStamina || lines[0]?.lhs !== 'concentration' ||
          lines[0].rhs.value !== readEffect(before, 'ExamLessonBuff').effectValue1)
        throw Error('Unexpected source effect on Sense card 139');
      lines[0].rhs = number(readEffect(row, 'ExamLessonBuff').effectValue1);
      break;
    }
    case 'p_card-01-men-3_035':
    case 'p_card-01-sup-2_097':
    case 'p_card-01-act-3_049': {
      raw.actions.unshift(...deserializeEffectSequence(`genki+=${readEffect(row, 'ExamBlock').effectValue1}`));
      if (masterId === 'p_card-01-men-3_035') raw.cost = deserializeEffectSequence(`cost-=${row.stamina}`);
      break;
    }
    case 'p_card-01-ido-3_097': {
      const conc = readEffect(row, 'ExamLessonBuff').effectValue1;
      const uses = readEffect(row, 'ExamPlayableValueAdd').effectCount;
      const half = readEffect(row, 'ExamStaminaConsumptionDown').effectTurn;
      raw.actions = deserializeEffectSequence(`concentration+=${conc}; cardUsesRemaining+=${uses}; halfCostTurns+=${half}`);
      break;
    }
    case 'p_card-01-ido-3_151': {
      const rate = readEffect(row, 'ExamLessonBuffDependParameterBuff').effectValue1 / 1000;
      raw.actions = deserializeEffectSequence(`concentration+=goodConditionTurns*${rate}`);
      break;
    }
    default: {
      const conc = masterId === 'p_card-01-ido-3_241';
      const type = conc ? 'ExamMultipleLessonBuffLesson' : 'ExamLessonAddMultipleParameterBuff';
      const current = readEffect(row, type), before = readEffect(nativeCards.get(`${masterId}#1`), type);
      const multiplier = conc ? 'concentrationMultiplier' : 'goodConditionTurnsMultiplier';
      if (lines[0]?.lhs !== multiplier || lines[0].rhs.value !== 1 + before.effectValue2 / 1000 ||
          lines[1]?.lhs !== 'score' || lines[1].rhs.value !== before.effectValue1)
        throw Error(`Native effect and GHL + card disagree for ${masterId}`);
      lines[0].rhs = number(1 + current.effectValue2 / 1000);
      lines[1].rhs = number(current.effectValue1);
    }
  }
  Object.assign(raw, {id, name: row.name, ghlLevel: level});
  registerLevelCard({...plus, id, name: row.name, upgraded: true, upgradedId: null, raw});
  registered.set(id, true);
  return id;
}
