// Public UIObs adapter. Imports the existing GHL policies without modifying them.
// Public native master fields are retained when the original GHL view has no slot.
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerExtraCardLevels } from './extra_card_levels.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=process.env.GHL_ROOT || path.resolve(here,'../runtime');
const mod=p=>import(pathToFileURL(path.join(root,p)).href);
const {card,allDrinks,allPItems,registerLevelCard}=await mod('src/content/index.ts');
const {engineCardFor}=await mod('src/content/master.ts');
const {cardLevels,LEVEL_ID_BASE}=await mod('src/content/levels.ts');
const {deserializeEffectSequence}=await import('gakumas-data');
const {heuristicDecide}=await mod('src/policies/heuristic.ts');
const {heuristic2Decide}=await mod('src/policies/heuristic2.ts');
const {midtermValue}=await mod('src/policies/battleSearch.ts');
const {drinkPrice,arrivalsAfter}=await mod('src/policies/drinkValue.ts');
const levels=cardLevels();
const originalIdAt=registerExtraCardLevels({levels,card,registerLevelCard,engineCardFor,
  deserializeEffectSequence,levelIdBase:LEVEL_ID_BASE});
// 思い出し笑い: the public master changes the second effect's GI condition
// 3→1 at ++, then motivation3→4 at +++. GHL's numeric-only generator skips it.
const logicLevels=new Map();
for(const [level,motivation]of[[2,3],[3,4]])if(originalIdAt(64,level)===null) {
  const plus=card(65),id=LEVEL_ID_BASE+640+level;
  const raw={...plus.raw,id,name:`${plus.name}${'+'.repeat(level-1)}`,ghlLevel:level,
    actions:deserializeEffectSequence(`goodImpressionTurns+=4; if:goodImpressionTurns>=1 { motivation+=${motivation} }`)};
  registerLevelCard({...plus,id,name:raw.name,upgradedId:null,raw});logicLevels.set(`64:${level}`,id);
}
// びしっとキメ顔: public master ++ increases the four-turn GI effect
// multiplier 2.0→2.7; +++ also reduces generic cost 5→4. Preserve the
// original direct-GI-increase trigger, conditions, TTL and all other fields.
for(const [level,cost]of[[2,5],[3,4]])if(originalIdAt(777,level)===null) {
  if(engineCardFor('p_card-02-act-3_187',0)!==777)throw Error('card 187 source ID mismatch');
  const plus=card(778),id=LEVEL_ID_BASE+7770+level,raw=structuredClone(plus.raw);
  const calls=raw.actions.flatMap(b=>b.actions||[]).filter(a=>a.type==='call'&&a.name==='setGoodImpressionTurnsEffectBuff');
  if(calls.length!==1||calls[0].args[0]?.value!==2||calls[0].args[1]?.value!==4)
    throw Error('card 187 original GI effect shape changed');
  let collision;try{collision=card(id);}catch{}
  if(collision)throw Error(`card 187 synthetic ID collision ${id}`);
  calls[0].args[0].value=2.7;
  Object.assign(raw,{id,name:`${plus.name}${'+'.repeat(level-1)}`,ghlLevel:level,
    cost:deserializeEffectSequence(`cost-=${cost}`)});
  registerLevelCard({...plus,id,name:raw.name,upgradedId:null,raw});logicLevels.set(`777:${level}`,id);
}
const idAt=(base,level)=>originalIdAt(base,level)??logicLevels.get(`${base}:${level}`)??null;
const publicMaster=JSON.parse(readFileSync(path.join(here,'fixtures/logic-public-master.json'),'utf8'));
const table=name=>new Map(publicMaster[name].map(r=>[r.id,r]));
const native={items:table('ProduceItem'),itemEffects:table('ProduceItemEffect'),
  enchants:table('ProduceExamStatusEnchant'),effects:table('ProduceExamEffect'),
  triggers:table('ProduceExamTrigger'),drinks:table('ProduceDrink'),grows:table('ProduceCardGrowEffect')};
const nativeCards=new Map(publicMaster.ProduceCard.map(c=>[`${c.id}#${c.upgradeCount}`,c]));
const customizations=new Map(publicMaster.ProduceCardCustomize.map(c=>[`${c.id}#${c.customizeCount}`,c]));
const idols=JSON.parse(readFileSync(path.join(root,'upstream/derived/hajime-idolcards.json'),'utf8')).idolCards;
const norm=x=>String(x).normalize('NFKC').replace(/\s+/g,'');
const fail=message=>{throw new Error(`unsupported: ${message}`);};
const HIDDEN=new Set(['consumedGenki','consumedStamina','consumedGoodImpressionTurns','cardsUsed']);
// engineCardFor scans immutable canonical card definitions.
// Cache its exact base-ID result; no card content, policy or scoring changes.
const baseIdCache=new Map();
function cachedBaseId(masterId) {
  if(!baseIdCache.has(masterId))baseIdCache.set(masterId,engineCardFor(masterId,0));
  return baseIdCache.get(masterId);
}

function hiddenReads(x,out=new Set()) {
  if(!x || typeof x!=='object') return out;
  if(x.type==='identifier' && HIDDEN.has(x.name)) out.add(x.name);
  for(const v of Object.values(x)) hiddenReads(v,out);
  return out;
}
export function parseCard(x) {
  if(typeof x==='string') {
    const [b,...c]=x.split('/');const m=b.match(/^(.*?)(?:\+(\d+))?$/);
    return {id:m[1],u:Number(m[2]||0),c:c.map(v=>{const [id,n]=v.split('*');return [id,Number(n||1)];}),g:[]};
  }
  return {id:x.id||x.produce_card_id,u:x.u??x.current_upgrade_count??0,
    c:(x.c??x.customizes??[]).map(v=>Array.isArray(v)?v:[v.id,v.customize_count??v.count??1]),g:x.g??[]};
}
function cardPublic(x) {
  const n=nativeCards.get(`${x.id}#${x.u}`);
  if(!n) fail(`unknown native card ${x.id}+${x.u}`);
  const custom=x.c.map(([id,count])=>{
    const row=customizations.get(`${id}#${count}`);
    if(!row) fail(`unknown customization ${id}*${count}`);
    return {id,count,effects:row.produceCardGrowEffectIds.map(k=>native.grows.get(k)||fail(`unknown grow ${k}`))};
  });
  const growth=x.g.map(k=>typeof k==='string'?(native.grows.get(k)||fail(`unknown grow ${k}`)):k);
  return {id:x.id,upgrade:x.u,name:n.name,customizations:custom,growth};
}
function mappedCard(x,iid,{model=false}={}) {
  x=parseCard(x);const visible=cardPublic(x);
  const base=cachedBaseId(x.id);
  if(base===null) fail(`unmapped GHL card ${x.id}`);
  const id=x.u===0?base:idAt(base,x.u);
  if(id===null) fail(`unmapped upgrade ${x.id}+${x.u}`);
  const c=card(id),hidden=[...hiddenReads([c.raw.actions,c.raw.effects,c.raw.cost])];
  if(hidden.length&&!model) fail(`${x.id} needs unavailable public counters ${hidden.join(',')}`);
  return {id:iid,iid,defId:id,name:c.name,type:c.type,tier:c.tier,upgraded:c.upgraded,
    unique:c.unique,plan:c.plan,limitPerStage:c.limit,publicCard:visible,unavailableCounters:hidden};
}
function getEffect(loadout,obs) {
  const id=loadout?.idol_card_id||obs?.exam?.idol,idol=idols[id];
  if(!idol) fail(`unknown idol ${id}`);
  if(idol.plan!=='logic'||(obs&&obs.exam.plan!==3)) fail(`non-Logic idol ${id}`);
  if(idol.examEffectType==='ExamReview')return'goodImpressionTurns';
  if(idol.examEffectType==='ExamCardPlayAggressive')return'motivation';
  fail(`Logic subtype ${idol.examEffectType}`);
}
function drinkDef(id) {
  const n=native.drinks.get(id);if(!n)fail(`unknown drink ${id}`);
  const ds=allDrinks().filter(d=>norm(d.name)===norm(n.name));
  if(ds.length!==1)fail(`ambiguous/unmapped drink ${id}`);
  return ds[0];
}
function itemDef(id) {
  const n=native.items.get(id);if(!n)fail(`unknown P-item ${id}`);
  const ds=allPItems().filter(d=>norm(d.name)===norm(n.name));
  if(ds.length>1)fail(`ambiguous P-item ${id}`);
  return {native:n,ghl:ds[0]??null};
}
const SCALARS={review:'goodImpressionTurns',aggressive:'motivation',lesson_buff:'concentration',
  full_power_point:'fullPowerCharge',enthusiastic:'enthusiasm',anti_debuff:'nullifyDebuff',
  stamina_consumption_down_fix:'costReduction',stamina_consumption_add_fix:'costIncrease'};
const TURNS={parameter_buff:'goodConditionTurns',parameter_buff_multiple:'perfectConditionTurns',
  stamina_consumption_down:'halfCostTurns',stamina_consumption_add:'doubleCostTurns',
  block_restriction:'nullifyGenkiTurns',buff_consumption_add:'doubleBuffCostTurns',
  stance_lock:'lockStanceTurns',slump:'poorConditionTurns',panic:'uneaseTurns'};
const LISTS={lesson_parameter_multiple:'scoreBuffs',lesson_parameter_multiple_down:'scoreDebuffs',
  lesson_buff_multiple:'concentrationEffectBuffs',review_multiple:'goodImpressionTurnsEffectBuffs',
  review_count_add:'goodImpressionTurnsTimesBuffs',review_gain_multiple:'goodImpressionTurnsBuffs',
  aggressive_gain_multiple:'motivationBuffs',lesson_buff_gain_multiple:'concentrationBuffs',
  parameter_buff_gain_multiple:'goodConditionTurnsBuffs'};
// No invented numeric GHL counterparts: preserve unsupported engine status
// fields verbatim. Original fixed heuristics never read these; model sees them.
const PUBLIC_ONLY=new Set(['lesson_debuff','stamina_recover_add','stamina_recover_restriction',
  'block_add_down','block_add_down_fix','play_card_limit','extra_turn','gimmick_parameter_debuff',
  'card_draw_down','full_power_lesson_multiple_add','concentration_lesson_multiple_add',
  'full_power_point_add','enthusiastic_add','lesson_parameter_depend','timed_gain',
  'lesson_buff_gain_fix','aggressive_gain_fix','parameter_buff_gain_fix',
  'enthusiastic_gain_permil','full_power_point_gain_permil']);
function buffsOf(obs) {
  const buffs={genki:obs.num.block,turnCardsUsed:obs.num.plays};const extra=[];
  for(const row of obs.status||[]) {
    const[k,v,t]=row;
    if(SCALARS[k])buffs[SCALARS[k]]=(buffs[SCALARS[k]]||0)+v;
    else if(TURNS[k])buffs[TURNS[k]]=Math.max(buffs[TURNS[k]]||0,t===-1?obs.exam.limit:t);
    else if(LISTS[k])(buffs[LISTS[k]]||=[]).push({amount:v,turns:t===-1?null:t});
    else if(PUBLIC_ONLY.has(k))extra.push(row);
    else fail(`unmapped status ${k}`);
  }
  return {buffs,extra};
}
// Reverse public master identity links. An enchant is attributed only to source
// content that actually installs that exact ID, never by an approximate name.
const cardEnchants=new Map();
for(const n of publicMaster.ProduceCard) for(const p of n.playEffects||[]) {
  const e=native.effects.get(p.produceExamEffectId),id=e?.produceExamStatusEnchantId;
  if(id)(cardEnchants.get(id)||cardEnchants.set(id,[]).get(id)).push({masterId:n.id,u:n.upgradeCount});
}
function phasesOf(ench) {
  const tr=native.triggers.get(ench.produceExamTriggerId);
  if(!tr)fail(`unknown enchant trigger ${ench.produceExamTriggerId}`);
  const phases=tr.phaseTypes.map(x=>x.replace('ProduceExamPhaseType_',''));
  const aliases={ExamStartExam:['startOfStage','prestage'],ExamStartTurn:['startOfTurn','beforeStartOfTurn','afterStartOfTurn','turn','everyTurn'],
    ExamTurnTimer:['turn','startOfTurn','afterStartOfTurn'],ExamTurnInterval:['turn','startOfTurn','afterStartOfTurn'],
    ExamEndTurn:['endOfTurn'],ExamEndTurnInterval:['endOfTurn'],ExamCardPlay:['cardUsed'],ExamCardPlayAfter:['afterCardUsed'],
    ExamSearchCardPlay:['cardUsed'],ExamPlayCountInterval:['cardUsed'],ExamPlayCountIntervalAfter:['afterCardUsed'],
    ExamPlayTurnCountInterval:['cardUsed'],ExamStaminaReduce:['staminaDecreased'],ExamStaminaReduceCard:['staminaDecreased']};
  return {native:tr,phases:[...new Set(phases.flatMap(p=>aliases[p]||[]))]};
}
function relevantEnchant(ench) {
  // These are the only effect properties read by the original motivation
  // active-effect estimator. Other native effects remain visible in metadata.
  return ench.produceExamEffectIds.some(id=>{
    const e=native.effects.get(id);if(!e)fail(`unknown enchant effect ${id}`);
    return ['ProduceExamEffectType_ExamBlock','ProduceExamEffectType_ExamLessonDependBlock',
      'ProduceExamEffectType_ExamBlockAddMultipleAggressive'].includes(e.effectType);
  });
}
function activeEffects(obs,loadout,cards,{model=false}={}) {
  const active=[],nativeRows=[],unrepresented=[];
  const card186Timers=(obs.timers||[]).filter(([t,id,end])=>
    t>0&&timerCardSource(id,t,end)!==null).map(([turns])=>turns);
  const itemSources=new Map();
  for(const id of loadout.produce_item_ids||[]) {
    const d=itemDef(id);
    for(const eff of d.native.produceItemEffectIds||[]) {
      const e=native.itemEffects.get(eff),eid=e?.produceExamStatusEnchantId;
      if(eid)itemSources.set(eid,d);
    }
  }
  for(const [eid,uses,turns] of obs.ench||[]) {
    const e=native.enchants.get(eid);if(!e)fail(`unknown enchant ${eid}`);
    const phase=phasesOf(e);
    const detail={id:eid,usesLeft:uses,turnsLeft:turns,trigger:phase.native,
      effects:e.produceExamEffectIds.map(id=>native.effects.get(id)||fail(`unknown effect ${id}`))};
    nativeRows.push(detail);
    if(eid==='enchant-p_card-02-act-3_186-enc01') {
      const match=card186Timers.findIndex(t=>Math.min(3,t)===turns);
      const block=card(771).raw.actions.find(b=>b.phase==='startOfTurn');
      // Legacy v1 screens omit timers. Policies that never inspect active
      // effects retain the native icon as public-only metadata, as before.
      if(match<0&&model){unrepresented.push(eid);continue;}
      if(uses!==-1||match<0||e.produceExamEffectIds.length!==1||
         native.effects.get(e.produceExamEffectIds[0])?.effectType!=='ProduceExamEffectType_ExamBlock'||
         native.effects.get(e.produceExamEffectIds[0])?.effectValue1!==2||block?.limit!==3)
        fail('card186 genki enchant lacks exact paired public timer');
      const left=card186Timers.splice(match,1)[0]-1,iid=`enchant-source-${eid}-${active.length}`;
      cards[iid]={id:iid,iid,defId:771};
      // The native duration includes the start-of-turn gain already delivered.
      // Its paired conversion timer distinguishes a fresh cast (4→3 gains)
      // from later screens (3→2, 2→1, 1→0 remaining gains).
      active.push({source:'skillCardEffect',sourceId:771,sourceCard:iid,phase:'startOfTurn',limit:left,ttl:null});
      continue;
    }
    const item=itemSources.get(eid);
    if(item?.ghl) {
      const blocks=(item.ghl.effects||[]).filter(b=>phase.phases.includes(b.phase));
      if(blocks.length) {
        for(const p of new Set(blocks.map(b=>b.phase)))active.push({source:'pItem',sourceId:item.ghl.id,sourceCard:null,
          phase:p,limit:uses<0?null:uses,ttl:turns<0?null:turns});
        continue;
      }
    }
    // The public enchant uniquely identifies its installed block even when its
    // card has left the visible piles. Add an attribution-only card reference.
    const candidates=[];
    for(const c of cardEnchants.get(eid)||[]) {
      const base=cachedBaseId(c.masterId);if(base===null)continue;
      const id=c.u===0?base:idAt(base,c.u);if(id===null)continue;
      const blocks=(card(id).raw.actions||[]).filter(b=>phase.phases.includes(b.phase));
      if(blocks.length)candidates.push({id,blocks});
    }
    const signatures=new Set(candidates.map(c=>JSON.stringify(c.blocks)));
    if(candidates.length&&signatures.size===1) {
      const candidate=candidates[0],iid=`enchant-source-${eid}`;
      cards[iid]={id:iid,iid,defId:candidate.id};
      for(const p of new Set(candidate.blocks.map(b=>b.phase)))active.push({source:'skillCardEffect',sourceId:candidate.id,
        sourceCard:iid,phase:p,limit:uses<0?null:uses,ttl:turns<0?null:turns});
      continue;
    }
    unrepresented.push(eid);
    if(relevantEnchant(e)&&!model)fail(`active genki enchant needs exact GHL source ${eid}`);
  }
  if(card186Timers.length)fail('card186 public timers lack matching genki enchant layers');
  return {active,nativeRows,unrepresented};
}
export function preflight(loadout,policy='B1v2') {
  const effect=getEffect(loadout),model=/2B|model/i.test(policy);
  if(loadout.include_produce_default!==false)fail('implicit default deck');
  loadout.deck_cards.forEach((x,i)=>mappedCard(x,`c${i}`,{model}));
  (loadout.drink_ids||[]).forEach(drinkDef);(loadout.produce_item_ids||[]).forEach(itemDef);
  return {effect,policy,scope:'Logic public observation adapter',runtimeChecks:true};
}
function playCountEffects(obs,loadout) {
  const rows=obs.pcount||[];if(!rows.length)return [];
  const id='pdrink_02-3-010',initial=(loadout.drink_ids||[]).filter(x=>x===id).length,
    remaining=(obs.drinks||[]).filter(x=>x===id).length;
  if(rows.length>initial-remaining||drinkDef(id).id!==25||rows.some(r=>
     r.length!==4||r[0]!=='p_card_search-active_skill-n-r-sr-ssr-playing'||
     r[1]!==1||r[2]!==1||![1,2].includes(r[3])))
    fail('native pcount has no exact consumed-drink25 counterpart');
  // Native expiry is inclusive; the original GHL trigger still fires at TTL0.
  // Each consumed copy installs a separate layer; preserve duplicates and each
  // layer's remaining lifetime rather than merging them into a blanket repeat.
  return rows.map(r=>({source:'pDrink',sourceId:25,sourceCard:null,phase:'activeCardUsed',limit:1,ttl:r[3]-1}));
}
function timerCardSource(id,turns,atEnd) {
  const level={'e_effect-exam_lesson_depend_block-1800-01':0,
    'e_effect-exam_lesson_depend_block-2800-01':1,
    'e_effect-exam_lesson_depend_block-3200-01':2}[id];
  if(level===undefined)return null;
  if(atEnd!==0||!Number.isInteger(turns)||turns<0||turns>4)
    fail(`unsupported card186 timer timing ${id}`);
  const e=native.effects.get(id),owner=nativeCards.get(`p_card-02-act-3_186#${level}`);
  const timer=owner.playEffects.map(p=>native.effects.get(p.produceExamEffectId)).find(p=>p?.chainProduceExamEffectId===id);
  if(e.effectType!=='ProduceExamEffectType_ExamLessonDependBlock'||e.effectValue2!==0||e.effectCount!==1||
     timer?.effectType!=='ProduceExamEffectType_ExamEffectTimer'||timer.effectValue1!==4||timer.effectCount!==1)
    fail(`card186 timer source changed ${id}`);
  const base=cachedBaseId(owner.id),defId=level===0?base:idAt(base,level);
  const blocks=card(defId).raw.actions.filter(b=>b.phase==='turn');
  if(blocks.length!==1||blocks[0].delay!==3||blocks[0].limit!==1)
    fail(`card186 GHL timer shape changed ${id}`);
  const a=blocks[0].actions?.[0],r=a?.rhs;
  if(a?.lhs!=='score'||a.op!=='+='||r?.type!=='binary'||r.op!=='*'||
     r.left?.name!=='genki'||r.right?.value!==e.effectValue1/1000)
    fail(`card186 GHL timer coefficient changed ${id}`);
  return defId;
}
function publicHistoryTimers(obs,history) {
  if(!Array.isArray(history)||history.length>512)fail('invalid public action history');
  const icon='enchant-p_card-02-act-3_186-enc01',owner='p_card-02-act-3_186';
  const screen=o=>{
    if(!Number.isInteger(o?.i)||!Number.isInteger(o?.exam?.turn))fail('public history screen index/turn');
    const counts=new Map();
    for(const [id,uses,turns] of o.ench||[])if(id===icon){
      if(uses!==-1||![1,2,3].includes(turns))fail('public history card186 enchant shape');
      counts.set(turns,(counts.get(turns)||0)+1);
    }
    return {i:o.i,turn:o.exam.turn,counts};
  };
  let layers=[];
  const initial=screen(history[0]?.obs||obs);
  if(initial.i!==0||initial.counts.size)fail('card186 public history must start at the initial clean screen');
  for(let i=0;i<history.length;i++) {
    const entry=history[i],before=screen(entry.obs),after=screen(history[i+1]?.obs||obs);
    if(before.i!==i||after.i!==i+1||after.turn<before.turn||after.turn>before.turn+1)
      fail('nonconsecutive public action history');
    layers=layers.filter(x=>x.turn+4>after.turn);
    const fresh=new Map(after.counts);
    for(const x of layers){const t=Math.min(3,x.turn+4-after.turn);fresh.set(t,(fresh.get(t)||0)-1);}
    const a=entry.action;
    if(!Array.isArray(a))fail('public history action shape');
    const played=a[0]==='play'?(entry.card||entry.obs.hand?.[a[1]]):null;
    if(a[0]==='play'&&!played)fail('public history lacks the played card');
    if(played?.id===owner) {
      if(![0,1,2,3].includes(played.u)||(played.c||[]).length||(played.g||[]).length)
        fail('card186 history customization/growth lacks exact timer mapping');
      const t=Math.min(3,before.turn+4-after.turn),copies=fresh.get(t)||0;
      if(copies<1||[...fresh].some(([k,v])=>k!==t&&v!==0))fail('card186 public cast/enchant multiplicity mismatch');
      // Every repeated direct card effect installs one observed genki layer
      // and its paired timer. Multiplicity comes from accepted public screens.
      for(let n=0;n<copies;n++)layers.push({turn:before.turn,level:played.u});
    } else if([...fresh.values()].some(x=>x!==0))fail('card186 enchant appeared without an observed public cast');
  }
  const now=screen(obs);
  if(now.i!==history.length)fail('incomplete public action history');
  return layers.map(x=>[x.turn+4-now.turn,
    `e_effect-exam_lesson_depend_block-${[1800,2800,3200,3200][x.level]}-01`,0]);
}
export function adapt(obs,loadout,{model=false,policy='B1v2',history}={}) {
  const effect=getEffect(loadout,obs);
  if(!['uiobs.v1','uiobs.v2'].includes(obs.v))fail(`schema ${obs.v}`);
  if(obs.stance?.[0])fail(`non-Logic stance ${obs.stance[0]}`);
  if(!model)for(const k of ['costs'])if(obs[k]?.length)
    fail(`native ${k} has no faithful original-policy observation mapping`);
  const playCounts=model?[]:playCountEffects(obs,loadout);
  const reconstructed=obs.v==='uiobs.v1'&&!('timers' in obs)&&history!==undefined?
    publicHistoryTimers(obs,history):null;
  const effectiveTimers=reconstructed??obs.timers??[];
  const queuedCards=[];
  const timerDetails=effectiveTimers.map(([turns,id,atEnd])=>{
    const e=native.effects.get(id);if(!e)fail(`unknown queued effect ${id}`);
    // The fixed heuristics do not forecast card draws/upgrades or plain-score
    // timer effects. Preserve these public queues without inventing genki value.
    const noActiveValue=new Set(['ProduceExamEffectType_ExamCardUpgrade','ProduceExamEffectType_ExamCardDraw',
      'ProduceExamEffectType_ExamLesson']);
    if(!noActiveValue.has(e.effectType)) {
      const defId=timerCardSource(id,turns,atEnd);
      if(defId!==null)queuedCards.push({defId,id});
      else if(!model)fail(`queued effect needs exact GHL source ${id}`);
    }
    return {turnsUntil:turns,atEnd:!!atEnd,effect:e};
  });
  const cards={},piles={};
  for(const field of ['hand','deck','grave','hold','lost'])piles[field]=(obs[field]||[]).map((x,i)=>{
    const c=mappedCard(x,`${field}-${i}`,{model});cards[c.id]=c;return c;});
  const ds=(obs.drinks||[]).map((id,i)=>{const d=drinkDef(id);return{id:`d${i}`,drinkId:d.id,name:d.name,masterId:id};});
  const kinds={1:'vocal',2:'dance',3:'visual'};
  if(!obs.exam.types.length||obs.exam.types.some(x=>!kinds[x]))fail('turn attributes');
  const remaining=obs.exam.limit-obs.exam.turn+1;if(obs.exam.turn<1||remaining<1)fail('turn numbering');
  if (!['AUDITION_MID1', 'AUDITION_FINAL'].includes(obs.exam.step)) fail(`unsupported exam step ${obs.exam.step}`);
  const label=obs.exam.step==='AUDITION_FINAL'?'final':'midterm';
  const status=buffsOf(obs);
  const en=activeEffects({...obs,timers:effectiveTimers},loadout,cards,{model:model||policy==='B1'||policy==='B1v2gi'||effect==='goodImpressionTurns'});
  const timerEffects=queuedCards.map(({defId,id},i)=>{
    const iid=`timer-source-${i}-${id}`;cards[iid]={id:iid,iid,defId};
    // Original ActiveEffectView has no remaining-delay field. Its motivation
    // outlook reads the source card's original delay3; retain that behavior.
    return {source:'skillCardEffect',sourceId:defId,sourceCard:iid,phase:'turn',limit:1,ttl:null};
  });
  const b={kind:'exam',label,turn:obs.exam.turn,turnsRemaining:remaining,
    turnTypes:obs.exam.types.map(x=>kinds[x]),typeMultipliers:Object.fromEntries(['vocal','dance','visual'].map((x,i)=>[x,obs.exam.permil[i]/1000])),
    score:obs.num.score,stamina:obs.num.stamina,maxStamina:obs.num.max_stamina,cardUsesRemaining:obs.num.playable,
    buffs:status.buffs,hand:piles.hand,drawPile:{count:piles.deck.length,contents:piles.deck.map(x=>x.id)},
    discardPile:piles.grave.map(x=>x.id),heldPile:piles.hold.map(x=>x.id),removedPile:piles.lost.map(x=>x.id),cards,drinks:ds,activeEffects:[...en.active,...playCounts,...timerEffects]};
  const legal=obs.legal.map((a,i)=>{
    let action;
    if(a[0]==='play'&&a.length===2&&piles.hand[a[1]])action={kind:'play_card',card:piles.hand[a[1]].id};
    else if(a[0]==='drink'&&a.length===2&&ds[a[1]])action={kind:'use_drink',drink:ds[a[1]].id};
    else if(a[0]==='end'&&a.length===1)action={kind:'end_turn'};
    else fail(`action without public mapping ${JSON.stringify(a)}`);
    return {id:String(i),action};
  });
  if(!legal.length)fail('empty legal actions');
  const items=(loadout.produce_item_ids||[]).map(id=>{const d=itemDef(id);return {masterId:id,name:d.native.name,itemId:d.ghl?.id??null};});
  const observation={phase:'battle',decision:{battle:b,battleKind:label},deck:Object.values(piles).flat(),items,drinks:ds};
  return {observation,legal,effect,publicExtra:{status:status.extra,enchants:en.nativeRows,
    unrepresentedEnchants:en.unrepresented,timers:obs.timers||[],timerDetails,
    reconstructedTimers:reconstructed,historySource:reconstructed===null?null:'accepted public observation/action history',
    costs:obs.costs||[],pcount:obs.pcount||[],
    exam:{produce:obs.exam.produce,step:obs.exam.step,crit:obs.exam.crit},campaignContext:'unavailable in GKMS examination UIObs'}};
}
export function decide(obs,loadout,policy='B1v2',history) {
  if(!['B1','B1v2','B1v2gi','B1v2GI'].includes(policy))fail(`policy ${policy}`);
  const mapped=adapt(obs,loadout,{policy,history}),{observation,legal,effect}=mapped;
  const choice=policy==='B1'?heuristicDecide(observation,legal):heuristic2Decide(observation,legal,/gi$/i.test(policy)?'goodImpressionTurns':effect);
  const index=Number(choice.id);if(!Number.isInteger(index)||!obs.legal[index])throw Error('GHL policy returned unmapped action');
  return {action:obs.legal[index],meta:{policy:`GHL-${policy}-screen-adapted`,source:'unchanged GHL policy',
    originalHeuristicLimitations:['ignores card customizations and growth','does not forecast native-only statuses'],
    publicOnlyStatuses:mapped.publicExtra.status.map(x=>x[0]),publicOnlyEnchants:mapped.publicExtra.unrepresentedEnchants}};
}
export function midtermExpected({score,above,held,remaining,week=10}) {
  let p=[1];for(const q of above){const n=Array(p.length+1).fill(0);for(let i=0;i<p.length;i++){n[i]+=p[i]*(1-q);n[i+1]+=p[i]*q;}p=n;}
  const numeric=held.map(id=>drinkDef(id).id),left=remaining.slice(),spent=[];
  for(const id of held){const i=left.indexOf(id);if(i<0)spent.push(drinkDef(id).id);else left.splice(i,1);}
  return {value:p.reduce((s,q,i)=>s+q*midtermValue(score,i+1),0)-drinkPrice(spent,numeric,arrivalsAfter(week))};
}
export function handle(request) {
  const r=request;
  if(r.op==='health')return {ready:true};
  if(r.op==='preflight')return preflight(r.loadout,r.policy);
  if(r.op==='adapt')return adapt(r.obs,r.loadout,{model:!!r.model,policy:r.policy,history:r.history});
  if(r.op==='midterm_value')return midtermExpected(r);
  return decide(r.obs,r.loadout,r.policy,r.history);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity})) {
    try {process.stdout.write(JSON.stringify({ok:true,value:handle(JSON.parse(line))})+'\n');}
    catch(e){process.stdout.write(JSON.stringify({ok:false,error:String(e.message||e)})+'\n');}
  }
}
