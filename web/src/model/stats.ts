import type { Quartiles } from "./types";

/** Квантиль с линейной интерполяцией — как statistics.quantiles(method="inclusive")
 *  в Python. Метод обязан совпадать: иначе медианы на сайте и в выгрузке разойдутся. */
export function quantile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h), hi = Math.ceil(h);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo);
}

export const MIN_N = 10;

export function quartiles(values: number[], minN = MIN_N): Quartiles | null {
  if (values.length < minN) return null;
  const s = [...values].sort((a, b) => a - b);
  return { n: s.length, p25: quantile(s, 0.25), median: quantile(s, 0.5), p75: quantile(s, 0.75) };
}

/** Доля значений не выше x — «выше, чем у N% похожих». */
export function percentileOf(sorted: number[], x: number): number {
  if (!sorted.length) return NaN;
  let below = 0, equal = 0;
  for (const v of sorted) { if (v < x) below++; else if (v === x) equal++; }
  return (100 * (below + equal / 2)) / sorted.length;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  return quantile([...values].sort((a, b) => a - b), 0.5);
}

export function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1);
}

export function pearson(xs: number[], ys: number[]): number {
  const n = xs.length, mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
}

/** Каплан — Мейер с отложенным входом. Та же логика, что в scripts/export_site_data.py:
 *  вакансии, созданные до начала наблюдения, входят в расчёт с того дня, когда мы их увидели. */
export function kaplanMeier(spells: Array<[number, number, boolean]>, horizon = 90, minRisk = 30) {
  const events = new Map<number, number>();
  let last = 0;
  for (const [, exit, closed] of spells) {
    if (closed) events.set(exit, (events.get(exit) ?? 0) + 1);
    last = Math.max(last, exit);
  }
  let surv = 1;
  const curve: Array<{ day: number; open: number; atRisk: number }> = [{ day: 0, open: 1, atRisk: spells.length }];
  for (let t = 1; t <= Math.min(horizon, last); t++) {
    let atRisk = 0;
    for (const [entry, exit] of spells) if (entry < t && t <= exit) atRisk++;
    const d = events.get(t) ?? 0;
    if (atRisk && d) surv *= 1 - d / atRisk;
    curve.push({ day: t, open: surv, atRisk });
  }
  const reliable = curve.filter((p) => p.day === 0 || p.atRisk >= minRisk);
  const at30 = reliable.find((p) => p.day === 30);
  return { curve: reliable, openAt30: at30 ? at30.open : null, n: spells.length, closed: spells.filter((s) => s[2]).length };
}
