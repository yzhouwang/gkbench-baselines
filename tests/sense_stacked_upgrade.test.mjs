// Run after preparing the public game data, from the repository root:
// node --import ./runtime/src/upstream/register.ts --test tests/sense_stacked_upgrade.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {adaptSense} from '../algorithms/ghl_sense_bridge.mjs';

function resolve(publicCard) {
  const obs = {
    v: 'uiobs.v2', exam: {plan: 2, step: 'AUDITION_MID1', types: [1], permil: [1000, 1000, 1000], turn: 1, limit: 1},
    num: {score: 0, block: 0, playable: 1, stamina: 20}, status: [], drinks: [],
    deck: [], grave: [], hand: [publicCard], legal: [['play', 0], ['end']],
  };
  return adaptSense(obs, {}).observation.decision.battle.cards['hand-0'];
}

test('stacked upgrades use each card’s own native ceiling and retain the public count', () => {
  for (const [id, top, display] of [['p_card-01-men-2_110', 3, 4], ['p_card-00-acc-0_002', 0, 1]]) {
    const publicCard = Object.freeze({id, u: display});
    const mapped = resolve(publicCard);
    assert.equal(mapped.defId, resolve({id, u: top}).defId);
    assert.equal(mapped.publicCard.upgrade, display);
    assert.equal(publicCard.u, display);
  }
});

test('missing policy definitions, unknown native cards and invalid counts fail explicitly', () => {
  // This card has a native third tier which the pinned policy tables cannot value.
  for (const u of [3, 4]) {
    assert.throws(() => resolve({id: 'p_card-01-ido-1_063', u}), /unmapped upgrade/);
  }
  assert.throws(() => resolve({id: 'unknown-card', u: 4}), /unknown native card/);
  for (const u of [-1, 0.5, '4', NaN, Infinity]) {
    assert.throws(() => resolve({id: 'p_card-01-men-2_110', u}), /Invalid public card upgrade count/);
  }
});
