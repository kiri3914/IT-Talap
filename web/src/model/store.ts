import type { Employer, Ev, Meta, Overview, Scope, Vacancy } from "./types";
import { MIN_N, percentileOf, quantile } from "./stats";

export interface Store {
  meta: Meta;
  overview: Overview;
  days: string[];
  lastIx: number;
  vacancies: Vacancy[];
  byId: Map<string, Vacancy>;
  byEmp: Map<string, Vacancy[]>;
  employers: Record<string, Employer>;
  events: Ev[];
  evById: Map<string, Ev[]>;
  comps: Map<string, Array<{ ad: string; usd: number }>>;
}

async function getJson<T>(name: string): Promise<T> {
  const r = await fetch(`./data/${name}`);
  if (!r.ok) throw new Error(`Нет файла data/${name}. Запустите выгрузку: scripts/export_app_data.py`);
  return r.json() as Promise<T>;
}

export async function loadStore(): Promise<Store> {
  const [meta, overview, vacancies, events, employers] = await Promise.all([
    getJson<Meta>("meta.json"),
    getJson<Overview>("overview.json"),
    getJson<Vacancy[]>("vacancies.json"),
    getJson<Ev[]>("events.json"),
    getJson<Record<string, Employer>>("employers.json"),
  ]);
  const byId = new Map(vacancies.map((v) => [v.id, v]));
  const byEmp = new Map<string, Vacancy[]>();
  for (const v of vacancies) if (v.emp) (byEmp.get(v.emp) ?? byEmp.set(v.emp, []).get(v.emp)!).push(v);
  const evById = new Map<string, Ev[]>();
  for (const e of events) (evById.get(e[2]) ?? evById.set(e[2], []).get(e[2])!).push(e);

  // Группы для оценки зарплаты: по одному объявлению, клоны по городам схлопнуты
  const comps = new Map<string, Array<{ ad: string; usd: number }>>();
  for (const v of uniqueAds(vacancies)) {
    if (!v.usd || !v.p || !v.e) continue;
    for (const key of compKeys(v)) (comps.get(key) ?? comps.set(key, []).get(key)!).push({ ad: v.ad, usd: v.usd });
  }
  for (const arr of comps.values()) arr.sort((a, b) => a.usd - b.usd);

  return { meta, overview, days: meta.days, lastIx: meta.days.length - 1, vacancies, byId, byEmp, employers, events, evById, comps };
}

// ---------- вакансия во времени ----------

export const firstIx = (v: Vacancy) => v.seg[0][0];
export const lastSeenIx = (v: Vacancy) => v.seg[v.seg.length - 1][1];
export const isActive = (v: Vacancy, s: Store) => lastSeenIx(v) === s.lastIx;
export const activeOn = (v: Vacancy, ix: number) => v.seg.some(([a, b]) => a <= ix && ix <= b);

/** Дней в выдаче с момента создания на hh (или до сегодня, если ещё открыта). */
export function ageDays(v: Vacancy, s: Store): number | null {
  if (!v.created) return null;
  const end = s.days[lastSeenIx(v)];
  return Math.round((Date.parse(end) - Date.parse(v.created)) / 86400000);
}

export function uniqueAds(list: Vacancy[]): Vacancy[] {
  const seen = new Set<string>();
  return list.filter((v) => (seen.has(v.ad) ? false : (seen.add(v.ad), true)));
}

export const inScope = (scope: Scope) => (v: Vacancy) => scope === "all" || v.c === scope;

// ---------- оценка зарплаты (findings-08) ----------

// Уровни от точного к грубому. Последние два — по всем трём странам в долларах:
// грубо, но для ролей, где зарплату почти не пишут (DevOps, дата-сайентисты),
// иначе оценки не было бы вовсе. Уровень всегда показывается рядом с оценкой.
const compKeys = (v: Pick<Vacancy, "p" | "e" | "cg" | "c">) => [
  `${v.p}|${v.e}|${v.cg}`, `${v.p}|${v.e}|${v.c}`, `${v.p}||${v.c}`, `${v.p}|${v.e}|all`, `${v.p}||all`,
];
const LEVEL_LABEL = [
  "та же роль, опыт и город", "та же роль и опыт по стране", "та же роль по стране",
  "та же роль и опыт во всех трёх странах", "та же роль во всех трёх странах",
];
const NEEDS_EXP = [true, true, false, true, false];

export interface Estimate {
  values: number[];
  n: number;
  p25: number;
  median: number;
  p75: number;
  level: string;
  /** 0 — роль+опыт+город, 1–2 — по стране, 3–4 — по трём странам */
  levelIx: number;
  withExperience: boolean;
  percentile: number | null;
}

/** Зарплата похожих вакансий. Сама вакансия из группы исключается — иначе
 *  она сравнивалась бы сама с собой. Порог — 10 похожих, ниже оценки нет. */
export function estimate(v: Pick<Vacancy, "p" | "e" | "cg" | "c" | "usd"> & { ad?: string }, s: Store): Estimate | null {
  if (!v.p) return null;
  const keys = compKeys(v);
  for (let i = 0; i < keys.length; i++) {
    if (!v.e && NEEDS_EXP[i]) continue;
    const values = (s.comps.get(keys[i]) ?? []).filter((x) => x.ad !== v.ad).map((x) => x.usd);
    if (values.length >= MIN_N) {
      return {
        values, n: values.length,
        p25: quantile(values, 0.25), median: quantile(values, 0.5), p75: quantile(values, 0.75),
        level: LEVEL_LABEL[i],
        levelIx: i,
        withExperience: NEEDS_EXP[i],
        percentile: v.usd ? percentileOf(values, v.usd) : null,
      };
    }
  }
  return null;
}

/** Сколько платит компания в этой роли — отдельной строкой, а не внутри оценки. */
export function employerPay(v: Vacancy, s: Store) {
  if (!v.emp || !v.p) return null;
  const own = uniqueAds(s.byEmp.get(v.emp) ?? []).filter((x) => x.p === v.p && x.usd && x.ad !== v.ad).map((x) => x.usd!);
  if (own.length < 2) return null;
  const sorted = own.sort((a, b) => a - b);
  return { n: sorted.length, median: quantile(sorted, 0.5) };
}

export function employerName(id: string | null, s: Store): string {
  if (!id) return "Работодатель не указан";
  const e = s.employers[id];
  if (!e) return "Работодатель";
  return e.person ? "Частный работодатель" : e.name;
}
