// Public content compatibility only; no heuristic coefficients are changed.
// Source: gakumasu-diff ecc33afcb100888072b6258790e8730f6768db9a,
// ProduceCard.yaml + ProduceExamEffect.yaml. GHL's automatic level generator
// omits these because multiple terms change or a new effect is inserted.
export const extraCardLevels = [
  {masterId:'p_card-02-act-3_052', base:426, level:2,
    actions:'score+=goodImpressionTurns*5.4; if:countCards[T & !removed]>=2 { score+=goodImpressionTurns*5.4 }'},
  {masterId:'p_card-02-act-3_052', base:426, level:3,
    actions:'score+=goodImpressionTurns*6; if:countCards[T & !removed]>=2 { score+=goodImpressionTurns*6 }'},
  {masterId:'p_card-02-act-3_050', base:304, level:3, cost:'motivation-=3',
    actions:'genki+=1; cardUsesRemaining+=1; @trigger at:cardUsed { score+=goodImpressionTurns*0.5 }'},
  {masterId:'p_card-02-ido-3_081', base:360, level:3, cost:'cost-=5',
    actions:'fixedStamina+=maxStamina*0.15; goodImpressionTurns+=5; genki+=14; cardUsesRemaining+=1'},
  {masterId:'p_card-00-sup-3_024', base:246, level:3, cost:'',
    actions:'genki+=1; addRandomUpgradedCardToHand; cardUsesRemaining+=1; at:turn { drawCard; limit:1 }'},
];

// Fill only missing definitions; prefer a future upstream implementation.
// The returned lookup supplements cardLevels.idAt without changing that table.
// This client calls card() for heuristics; it never simulates a card in GKMS/GHL.
export function registerExtraCardLevels({levels, card, registerLevelCard, engineCardFor,
                                        deserializeEffectSequence, levelIdBase}) {
  const added = new Map();
  for (const spec of extraCardLevels) {
    if (engineCardFor(spec.masterId,0) !== spec.base)
      throw new Error(`extra card levels: source ID mismatch ${spec.masterId}`);
    if (levels.idAt(spec.base,spec.level) !== null) continue;
    const plus = card(levels.idAt(spec.base,1));
    const id = levelIdBase + spec.base*10 + spec.level;
    let collision;
    try { collision=card(id); } catch { /* no registered definition */ }
    if (collision) throw new Error(`extra card levels: synthetic ID collision ${id}`);
    const raw = {...plus.raw, id, name:`${plus.name}${'+'.repeat(spec.level-1)}`,
      upgraded:true, ghlLevel:spec.level,
      actions:deserializeEffectSequence(spec.actions),
      cost:spec.cost === undefined ? plus.raw.cost : deserializeEffectSequence(spec.cost)};
    registerLevelCard({...plus,id,name:raw.name,upgraded:true,upgradedId:null,raw});
    added.set(`${spec.base}:${spec.level}`,id);
  }
  return (base,level) => levels.idAt(base,level) ?? added.get(`${base}:${level}`) ?? null;
}
