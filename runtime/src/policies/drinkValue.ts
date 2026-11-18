// B4v2 charges a drink spent at the midterm against the expected value of the
// three drinks held at the final. Each reserve value was estimated on 96 dev
// exams by replaying the same draws with and without each drink and multiplying
// its average final-score gain by the fitted evaluation slope of 0.0201.
// Later grants can displace weaker drinks. Their timing follows the Hajime
// schedule, with fractional arrival counts for optional supplies and outings.
export const DRINK_VALUES_VERSION = "drink-values-v2";

/** Reserve value per drink id, in evaluation points (logic and free drinks: the grant pool of a logic idol). */
export const DRINK_RESERVE: Record<number, number> = {
  1: 34, // 初星水
  2: 376, // 烏龍茶
  5: 224, // ルイボスティー
  6: 229, // ホットコーヒー
  9: 167, // ミックススムージー
  10: 63, // リカバリドリンク
  11: 268, // フレッシュビネガー
  12: 434, // ブーストエキス
  13: 344, // パワフル漢方ドリンク
  14: 884, // センブリソーダ
  16: 259, // おしゃれハーブティー
  18: 382, // 初星ホエイプロテイン
  19: 430, // 初星スペシャル青汁
  23: 445, // 厳選初星ティー
  24: 406, // 厳選初星ブレンド
  25: 328, // 特製ハツボシエキス
};

export function drinkReserve(drinkId: number): number {
  return DRINK_RESERVE[drinkId] ?? 0;
}

/** Expected drink arrivals after week `week`, up to the final: [week, expected arrivals]. */
export const LATER_ARRIVALS: [number, number][] = [[7, 1], [11, 0.54], [12, 1], [13, 0.67], [14, 1], [16, 1]];

export function arrivalsAfter(week: number): number {
  return LATER_ARRIVALS.filter(([w]) => w > week).reduce((s, [, n]) => s + n, 0);
}

/** P(Binomial(n, q) ≥ m). */
function atLeast(n: number, q: number, m: number): number {
  if (m <= 0) return 1;
  let p = 0;
  let c = 1; // C(n, i)
  for (let i = 0; i <= n; i++) {
    if (i >= m) p += c * q ** i * (1 - q) ** (n - i);
    c = (c * (n - i)) / (i + 1);
  }
  return p;
}

/** Expected value of the best `capacity` of the `held` values and `n` uniform grants (integer n). */
function bestOf(held: number[], n: number, capacity: number): number {
  const pool = Object.values(DRINK_RESERVE);
  const levels = [...new Set([...pool, ...held])].filter((t) => t > 0).sort((x, y) => x - y);
  let e = 0;
  let prev = 0;
  for (const t of levels) {
    // Layer t contributes (t − previous layer) × E[min(capacity, number of drinks worth ≥ t)].
    const q = pool.filter((x) => x >= t).length / pool.length;
    const h = held.filter((x) => x >= t).length;
    let count = 0;
    for (let j = 1; j <= capacity; j++) count += atLeast(n, q, j - h);
    e += (t - prev) * count;
    prev = t;
  }
  return e;
}

/** Expected value of the best `capacity` drinks at the final: `held` values plus `arrivals` grants (interpolated). */
export function expectedFinalDrinks(held: number[], arrivals: number, capacity = 3): number {
  const lo = Math.floor(arrivals);
  const f = arrivals - lo;
  return f ? (1 - f) * bestOf(held, lo, capacity) + f * bestOf(held, lo + 1, capacity) : bestOf(held, lo, capacity);
}

/** What spending `spent` (drink ids, among `held`) takes from the drinks held at the final, `arrivals` still to come. */
export function drinkPrice(spent: number[], held: number[], arrivals: number, capacity = 3): number {
  if (!spent.length) return 0;
  const rest = held.slice();
  for (const d of spent) {
    const i = rest.indexOf(d);
    if (i >= 0) rest.splice(i, 1);
  }
  return expectedFinalDrinks(held.map(drinkReserve), arrivals, capacity) - expectedFinalDrinks(rest.map(drinkReserve), arrivals, capacity);
}
