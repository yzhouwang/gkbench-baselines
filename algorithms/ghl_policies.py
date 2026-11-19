"""Run the GHL exam heuristics on GKBench public observations."""
import atexit
import copy
import json
import os
from pathlib import Path
import select
import shutil
import subprocess
import threading

from gkbench.algos.base import Algorithm, Decision
from ghl_descriptions import description

ROOT = Path(__file__).resolve().parent


def public_history_entry(obs, action):
    """Minimal public evidence for a returned action; commit after its next screen."""
    action=list(action)
    if action not in [list(a) for a in obs['legal']]:
        raise ValueError('Cannot record an action absent from the public legal set')
    entry={'obs':{'i':obs['i'],'exam':{'turn':obs['exam']['turn']},
                  'ench':[copy.deepcopy(e) for e in obs.get('ench',[])
                          if e[0]=='enchant-p_card-02-act-3_186-enc01']},'action':action}
    if action[0]=='play':
        card=obs['hand'][action[1]]
        entry['card']={k:copy.deepcopy(card[k]) for k in ['id','u','c','g'] if k in card}
    return entry


class GHLBridge:
    def __init__(self, ghl_root=None, node=None, timeout=30, *, script='ghl_logic_bridge.mjs'):
        self.root = Path(ghl_root or os.environ.get('GHL_ROOT') or ROOT.parent / 'runtime').resolve()
        self.timeout = float(timeout)
        self._lock = threading.Lock()
        node = node or shutil.which('node')
        if not node:
            raise RuntimeError('GHL bridge requires Node >=24')
        self.process = subprocess.Popen(
            [node, '--no-warnings', '--import', str(self.root / 'src/upstream/register.ts'),
             str(ROOT / script)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True,
            env={**os.environ, 'GHL_ROOT': str(self.root)},
        )
        atexit.register(self.close)
        # Import/static-data setup happens before a hosted episode starts.
        steady_timeout = self.timeout
        self.timeout = max(120, steady_timeout)
        try:
            if self.request(op='health') != {'ready': True}:
                raise RuntimeError('GHL bridge readiness check failed')
        finally:
            self.timeout = steady_timeout

    def request(self, **payload):
        with self._lock:
            if self.process.poll() is not None:
                raise RuntimeError('GHL bridge exited')
            self.process.stdin.write(json.dumps(payload, ensure_ascii=False) + '\n')
            self.process.stdin.flush()
            ready, _, _ = select.select([self.process.stdout], [], [], self.timeout)
            if not ready:
                self.close()
                raise TimeoutError('GHL bridge exceeded request timeout')
            line = self.process.stdout.readline()
            if not line:
                raise RuntimeError('GHL bridge produced no response')
            result = json.loads(line)
            if not result.get('ok'):
                raise ValueError(result.get('error', 'GHL bridge rejected input'))
            return result['value']

    def close(self):
        p = getattr(self, 'process', None)
        if p is not None and p.poll() is None:
            p.terminate()
            try:
                p.wait(timeout=2)
            except subprocess.TimeoutExpired:
                p.kill()
                p.wait(timeout=2)


class GHLHeuristic(Algorithm):
    policy = 'B1v2'
    name = 'ghl-b1v2-logic'

    def __init__(self, **params):
        super().__init__(**params)
        self.bridge = GHLBridge(ghl_root=params.get('ghl_root'))

    def begin(self, ctx):
        self._public_history=[]
        self._pending_public_action=None
        self.bridge.request(op='preflight', policy=self.policy, loadout=ctx.loadout)

    def decide(self, ctx):
        pending=self._pending_public_action
        if pending is not None:
            if ctx.obs['i']!=pending['obs']['i']+1:
                raise ValueError('Public action history requires the next accepted decision screen')
            self._public_history.append(pending)
            self._pending_public_action=None
        result = self.bridge.request(op='decide', policy=self.policy, obs=ctx.obs,
                                     loadout=ctx.loadout,history=self._public_history)
        action = tuple(result['action'])
        if action not in [tuple(a) for a in ctx.obs['legal']]:
            raise ValueError('Original GHL policy returned an action outside the legal set')
        self._pending_public_action=public_history_entry(ctx.obs,action)
        return Decision(action, result.get('meta', {}))

    def close(self):
        self.bridge.close()


class LogicCardHeuristic(GHLHeuristic):
    policy = "B1"
    name = "ghl-b1-logic"
    title = "Logic 卡牌估值 / Logic Card Heuristic"
    about = description(
        "按当前牌效与剩余回合选择动作。 Rank actions by card effects and remaining turns.",
        "估算得分、增益、体力消耗和额外行动，只读取公开画面和开局配置。B3 在独立考试里也调用这条规则。",
        "Estimates score, buffs, stamina costs and extra actions from the public state. B3 delegates exams to this rule.",
        family="ghl-b1",
    )


class LogicSubtypeHeuristic(GHLHeuristic):
    policy = "B1v2"
    name = "ghl-b1v2-logic"
    title = "Logic 分流启发式 / Logic Subtype Heuristic"
    about = description(
        "按偶像的好印象或干劲类型选择规则。 Choose a rule for the idol’s Logic subtype.",
        "好印象型使用好印象出牌与饮料规则。干劲型会估算后续元气积累及可兑现的得分。",
        "Uses the Good Impression card and drink rule for that subtype. For Motivation, it values future Genki gains and scoring opportunities.",
        family="ghl-b1v2",
    )


class GoodImpressionOnly(GHLHeuristic):
    policy = "B1v2gi"
    name = "ghl-b1v2gi-logic"
    title = "好印象固定策略 / Good Impression Only"
    about = description(
        "对所有支持的 Logic 开局固定使用好印象规则。 Always use the Good Impression rule.",
        "用于检验分流是否有用。在好印象型上与分流策略使用同一个分支，在干劲型上仍按好印象处理。",
        "An ablation of subtype routing. It shares the Good Impression branch and forces it on Motivation idols too.",
        family="ghl-b1v2gi",
    )


class B3Campaign(LogicCardHeuristic):
    """Compatibility entry for B3's delegation in standalone exams."""
    name = "ghl-b3-campaign-b1"
    title = "Logic 卡牌估值（B3 考试别名） / Logic Card Heuristic (B3 Exam Alias)"
    about = description(
        "B3 的独立考试入口调用 B1。 B3 delegates standalone exams to the Logic Card Heuristic.",
        "保留旧入口以复跑历史配置。育成阶段的规划在独立考试中不会执行。",
        "Kept for reproducing historical commands. Campaign planning runs outside standalone exams.",
        family="ghl-b3-campaign",
    )

    def decide(self, ctx):
        decision = super().decide(ctx)
        decision.meta = {**decision.meta, 'configured_policy': 'B3', 'scope': 'campaign',
                         'battle_delegate': 'B1', 'simulated_transitions': 0}
        return decision


B1 = LogicCardHeuristic
B1v2 = LogicSubtypeHeuristic
B1v2GI = GoodImpressionOnly
