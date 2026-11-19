import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mappedCard, parseCard, drinkDef, native, nativeCards } from './ghl_logic_bridge.mjs';
import { senseLevel, supplementalCard } from './ghl_sense_levels.mjs';
import { battleDecision } from '../runtime/src/sense/battle.ts';

const attributes = ['vocal', 'dance', 'visual'];
const exams = new Map([
  ['AUDITION_MID1', 'midterm'], ['AUDITION_MID2', 'midterm'], ['AUDITION_FINAL', 'final'],
]);
// The GHL policy uses exactly one drink feature: membership in its four
// preferred drinks. New public non-key drinks therefore need no private data
// or guessed numeric GHL equivalent. Verify the four keys against both tables.
const keyDrinks = new Map(['pdrink_00-2-008','pdrink_00-2-010','pdrink_00-3-001','pdrink_01-3-012']
  .map(id => [id, drinkDef(id).id]));
if ([...keyDrinks.values()].sort((a,b) => a-b).join(',') !== '12,14,18,22')
  throw Error('Sense key drink identities changed');

function roundLabel(obs, loadout) {
  if (!['uiobs.v1', 'uiobs.v2'].includes(obs.v)) throw Error('Unsupported public observation schema');
  const {exam} = obs;
  if (exam.plan === 2 && exams.has(exam.step)) return exams.get(exam.step);
  // The tower omits the plan/step in UIObs. Its public loadout identifies the
  // Sense mechanic and round explicitly. Use final-exam drink and stamina rules.
  if (exam.produce === 'tower' && !exam.step && [0, 2].includes(exam.plan) &&
      loadout.round === 'final' && ['exam_parameter_buff', 'exam_lesson_buff'].includes(loadout.mechanic))
    return 'final';
  throw Error(`Unsupported Sense examination: ${exam.produce} / ${exam.step} / plan ${exam.plan}`);
}

function publicBuffs(obs) {
  const buffs = {genki: obs.num.block, concentration: 0, goodConditionTurns: 0,
    perfectConditionTurns: 0, scoreBuffs: [], concentrationEffectBuffs: []};
  for (const [kind, value, turns] of obs.status) {
    if (kind === 'lesson_buff') buffs.concentration += value;
    else if (kind === 'parameter_buff') buffs.goodConditionTurns = value;
    else if (kind === 'parameter_buff_multiple')
      buffs.perfectConditionTurns = turns === -1 ? obs.exam.limit - obs.exam.turn + 1 : turns;
    else if (kind === 'lesson_parameter_multiple') buffs.scoreBuffs.push({amount: value});
    else if (kind === 'lesson_buff_multiple') buffs.concentrationEffectBuffs.push({amount: value});
  }
  return buffs;
}

const senseMapping = {model: true, fallbackLevel: senseLevel};
const maxNativeTier = new Map();
for (const row of nativeCards.values()) {
  maxNativeTier.set(row.id, Math.max(maxNativeTier.get(row.id) ?? 0, row.upgradeCount));
}
const validatedOverflow = new Set();

function senseCard(spec, instanceId) {
  const card = parseCard(spec);
  if (!Number.isSafeInteger(card.u) || card.u < 0) throw Error('Invalid public card upgrade count');
  const supplement = supplementalCard(card, instanceId);
  if (supplement) return supplement;

  const top = maxNativeTier.get(card.id);
  if (top === undefined || card.u <= top || nativeCards.has(`${card.id}#${card.u}`)) {
    return mappedCard(card, instanceId, senseMapping);
  }
  // Rules 65 refresh_card retains the sum of base, temporary and support
  // upgrades on the screen, but uses the highest available row for effects.
  // Only extend cards whose native tiers can all be valued by this adapter.
  if (!validatedOverflow.has(card.id)) {
    for (let u = 0; u <= top; u++) {
      if (nativeCards.has(`${card.id}#${u}`)) {
        mappedCard({id: card.id, u}, instanceId, senseMapping);
      }
    }
    validatedOverflow.add(card.id);
  }
  const instance = mappedCard({...card, u: top}, instanceId, senseMapping);
  instance.publicCard.upgrade = card.u;
  return instance;
}

export function adaptSense(obs, loadout) {
  const label = roundLabel(obs, loadout);
  const cards = {};
  const piles = {};
  // Only these three piles contribute to the original outlook. Their order is
  // immaterial except for the screen's hand indices used for legal actions.
  for (const pile of ['hand', 'deck', 'grave']) {
    piles[pile] = obs[pile].map((spec, index) => {
      const instance = senseCard(spec, `${pile}-${index}`);
      cards[instance.id] = instance;
      return instance.id;
    });
  }
  const drinks = obs.drinks.map((id, index) => {
    if (!native.drinks.has(id)) throw Error(`Unknown public drink ${id}`);
    return {id: `d${index}`, drinkId: keyDrinks.get(id) ?? null};
  });
  const {exam, num} = obs;
  if (!exam.types.length || exam.types.some(t => !attributes[t - 1]) ||
      exam.permil.length !== 3 || exam.permil.some(p => !Number.isFinite(p)) ||
      !(exam.turn >= 1 && exam.turn <= exam.limit)) throw Error('Invalid public turn schedule');
  const battle = {kind: 'exam', label, cards, drinks, hand: piles.hand, drawPile: {contents: piles.deck},
    discardPile: piles.grave, score: num.score, stamina: num.stamina, cardUsesRemaining: num.playable,
    turn: exam.turn, turnsRemaining: exam.limit - exam.turn + 1, turnTypes: exam.types.map(t => attributes[t - 1]),
    typeMultipliers: Object.fromEntries(attributes.map((a, i) => [a, exam.permil[i] / 1000])),
    buffs: publicBuffs(obs)};
  const legal = obs.legal.map((entry, id) => {
    const [kind, index] = entry;
    let action;
    if (kind === 'end' && entry.length === 1) action = {kind: 'end_turn'};
    else if (kind === 'play' && entry.length === 2 && piles.hand[index])
      action = {kind: 'play_card', card: piles.hand[index]};
    else if (kind === 'drink' && entry.length === 2 && drinks[index])
      action = {kind: 'use_drink', drink: drinks[index].id};
    else throw Error(`Unsupported public legal action: ${JSON.stringify(entry)}`);
    return {id: String(id), action};
  });
  if (!legal.length) throw Error('No legal actions on a live Sense screen');
  return {observation: {phase: 'battle', decision: {battle}}, legal};
}

export function handleSense({op, obs, loadout}) {
  if (op === 'health') return {ready: true};
  const {observation, legal} = adaptSense(obs, loadout);
  if (op === 'preflight') return {ready: true};
  if (op !== 'decide') throw Error(`Unknown Sense bridge operation: ${op}`);
  const decision = battleDecision(observation, legal);
  return {action: obs.legal[Number(decision.id)]};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for await (const line of createInterface({input: process.stdin, crlfDelay: Infinity})) {
    try {
      process.stdout.write(JSON.stringify({ok: true, value: handleSense(JSON.parse(line))}) + '\n');
    } catch (error) {
      process.stdout.write(JSON.stringify({ok: false, error: error.message}) + '\n');
    }
  }
}
