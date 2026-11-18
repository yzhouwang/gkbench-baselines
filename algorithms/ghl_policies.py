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
    def __init__(self, ghl_root=None, node=None, timeout=30):
        self.root = Path(ghl_root or os.environ.get('GHL_ROOT') or ROOT.parent / 'runtime').resolve()
        self.timeout = float(timeout)
        self._lock = threading.Lock()
        node = node or shutil.which('node')
        if not node:
            raise RuntimeError('GHL bridge requires Node >=24')
        self.process = subprocess.Popen(
            [node, '--no-warnings', '--import', str(self.root / 'src/upstream/register.ts'),
             str(ROOT / 'ghl_logic_bridge.mjs')],
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
        self.about = {
            'summary': f'Original GHL {self.policy} via a strict public-observation Logic adapter.',
            'sees': 'screen', 'family': f'ghl-{self.policy.lower()}',
            'detail': [
                'Calls the original GHL policy; coefficients and tie-breaking are unchanged.',
                'Only public observations, starting loadout and legal actions are used.',
                'Unsupported mechanics fail explicitly; no replacement policy is silently substituted.',
                'The original heuristic estimates base card effects and does not score customizations.',
            ],
        }

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


class B1(GHLHeuristic):
    policy = 'B1'
    name = 'ghl-b1-logic'


class B1v2(GHLHeuristic):
    policy = 'B1v2'
    name = 'ghl-b1v2-logic'


class B1v2GI(GHLHeuristic):
    policy = 'B1v2gi'
    name = 'ghl-b1v2gi-logic'


class B3Campaign(GHLHeuristic):
    """Canonical B3 default delegates battle decisions to B1 before planning."""
    policy = 'B1'
    name = 'ghl-b3-campaign-b1'

    def __init__(self, **params):
        super().__init__(**params)
        self.about = {
            'summary': 'Canonical GHL B3 in its default campaign-only scope: exam decisions delegate to original B1.',
            'sees': 'screen', 'family': 'ghl-b3-campaign',
            'detail': [
                'This matches the default factory configuration in src/cli/common.ts and battle branch in src/policies/rollout.ts.',
                'GKBench exposes isolated exams, so no campaign rollout executes here; decisions are identical to B1.',
                'This is the configured B3 battle behavior, not a claim that B3 searches whole campaigns inside GKBench.',
                'Same strict Logic adapter scope and explicit unsupported-state failures as the B1 entry.',
            ],
        }

    def decide(self, ctx):
        decision = super().decide(ctx)
        decision.meta = {**decision.meta, 'configured_policy': 'B3', 'scope': 'campaign',
                         'battle_delegate': 'B1', 'simulated_transitions': 0}
        return decision
