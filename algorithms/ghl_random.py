"""GHL B0's uniform-legal-action policy on GKBench's public interface."""
from gkbench.algos.base import Algorithm, Decision


class B0(Algorithm):
    name = 'ghl-b0-random'
    about = {
        'summary': 'GHL B0: uniformly sample one current legal action.',
        'sees': 'screen',
        'family': 'ghl-b0',
        'detail': [
            'Same decision rule as GHL src/policies/random.ts; no search or model.',
            'The independent GKBench algorithm RNG supplies uniform draws; game seeds and deck order are never read.',
            'All legal actions, including end-turn and selections, participate equally.',
        ],
    }

    def decide(self, ctx):
        legal = ctx.obs['legal']
        if not legal:
            raise ValueError('B0 received no legal action')
        return Decision(tuple(legal[ctx.rng.randrange(len(legal))]), {'policy': 'GHL-B0'})
