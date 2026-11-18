// The rating and placement objective used by the B4v2 midterm search.
const MIDTERM_REGIMES: [number, number][] = [[200000, 0], [60000, 0.001], [50000, 0.002], [40000, 0.003], [30000, 0.008], [20000, 0.05], [10000, 0.08], [0, 0.11]];
const MIDTERM_PLACE_PARAMS: Record<number, number> = { 1: 80, 2: 40, 3: 20 };
const PARAM_MULTIPLIER = 2.1;
const MIDTERM_FAIL_FROM = 4;
const MIDTERM_FAILURE = -10_000;

function rating(score: number, regimes: [number, number][]): number {
  let s = score;
  let r = 0;
  for (const [base, mult] of regimes) {
    if (s > base) {
      r += (s - base) * mult;
      s = base;
    }
  }
  return r;
}

/** The midterm's share of the evaluation: rating + placement parameters (×3 attributes ×2.1); a failure is −10,000. */
export function midtermValue(score: number, place: number): number {
  if (place >= MIDTERM_FAIL_FROM) return MIDTERM_FAILURE;
  return rating(score, MIDTERM_REGIMES) + (MIDTERM_PLACE_PARAMS[place] ?? 0) * 3 * PARAM_MULTIPLIER;
}
