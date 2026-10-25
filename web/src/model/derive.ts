import type { Ev, EventType, Vacancy } from "./types";
import { type Store, activeOn, firstIx, isActive, lastSeenIx, uniqueAds } from "./store";
import { kaplanMeier, quartiles } from "./stats";

/** Индекс наблюдённого дня, с которого начинается окно в N календарных дней. */
export function windowStart(s: Store, days: number): number {
  const last = Date.parse(s.days[s.lastIx]);
  const from = last - days * 86400000;
  return s.days.findIndex((d) => Date.parse(d) > from);
}

/** События по набору вакансий за окно, свежие сверху. */
export function eventsFor(ids: Set<string>, s: Store, fromIx: number, types?: EventType[]): Ev[] {
  const out: Ev[] = [];
  for (const id of ids) {
    for (const e of s.evById.get(id) ?? []) {
      if (e[0] >= fromIx && (!types || types.includes(e[1]))) out.push(e);
    }
  }
  return out.sort((a, b) => b[0] - a[0] || order(a[1]) - order(b[1]));
}
const ORDER: EventType[] = ["salary_up", "salary_down", "salary_set", "salary_drop", "open", "return", "close", "raise"];
const order = (t: EventType) => ORDER.indexOf(t);

export function countEvents(evs: Ev[]) {
  const c: Record<EventType, number> = { open: 0, close: 0, return: 0, raise: 0, salary_up: 0, salary_down: 0, salary_set: 0, salary_drop: 0 };
  for (const e of evs) c[e[1]]++;
  return c;
}

/** Открытых вакансий на каждый наблюдённый день. */
export function activeByDay(list: Vacancy[], s: Store): number[] {
  const out = new Array(s.days.length).fill(0);
  for (const v of list) for (const [a, b] of v.seg) for (let i = a; i <= b; i++) out[i]++;
  return out;
}

/** Новых вакансий по неделям (по понедельникам). Первая неделя наблюдения не
 *  считается: всё, что уже висело 11 сентября, выглядело бы «новым». */
export function opensByWeek(list: Vacancy[], s: Store) {
  const weekOf = (ix: number) => {
    const d = new Date(s.days[ix] + "T12:00:00");
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return monday.toISOString().slice(0, 10);
  };
  const weeks = [...new Set(s.days.map((_, i) => weekOf(i)))];
  const counts = new Map(weeks.map((w) => [w, 0]));
  for (const v of list) {
    const i = firstIx(v);
    if (i === 0) continue;
    counts.set(weekOf(i), (counts.get(weekOf(i)) ?? 0) + 1);
  }
  const lastWeek = weekOf(s.lastIx);
  const weekDone = new Date(s.days[s.lastIx] + "T12:00:00").getDay() === 0;
  return weeks.slice(1).map((w) => ({ week: w, count: counts.get(w) ?? 0, partial: w === lastWeek && !weekDone }));
}

/** Навыки: доля вакансий и рост — сравниваем вакансии, открытые за последние
 *  две недели, с открытыми раньше. Рост считаем, только если навык встречается
 *  достаточно часто, иначе «+300%» из трёх вакансий. */
export function skillStats(list: Vacancy[], s: Store, recentDays = 14) {
  const ads = uniqueAds(list);
  const cut = windowStart(s, recentDays);
  const recent = ads.filter((v) => firstIx(v) >= cut && firstIx(v) > 0);
  const older = ads.filter((v) => firstIx(v) < cut);
  const count = (arr: Vacancy[]) => {
    const m = new Map<string, { name: string; n: number }>();
    for (const v of arr) for (const sk of new Set(v.sk.map((x) => x.toLowerCase()))) {
      const orig = v.sk.find((x) => x.toLowerCase() === sk)!;
      const cur = m.get(sk) ?? { name: orig, n: 0 };
      cur.n++;
      m.set(sk, cur);
    }
    return m;
  };
  const all = count(ads), rec = count(recent), old = count(older);
  return [...all.entries()]
    .map(([k, { name, n }]) => {
      const r = (rec.get(k)?.n ?? 0) / Math.max(recent.length, 1);
      const o = (old.get(k)?.n ?? 0) / Math.max(older.length, 1);
      return { key: k, name, n, share: (100 * n) / ads.length, recentShare: 100 * r, olderShare: 100 * o,
        delta: recent.length >= 20 && n >= 8 ? 100 * (r - o) : null };
    })
    .sort((a, b) => b.n - a.n);
}

/** Кто нанимает: работодатели по числу вакансий, открытых за окно, и всего. */
export function hiringEmployers(list: Vacancy[], s: Store, fromIx: number) {
  const m = new Map<string, { emp: string; opened: number; total: number; active: number }>();
  for (const v of uniqueAds(list)) {
    if (!v.emp || s.employers[v.emp]?.person) continue;
    const r = m.get(v.emp) ?? { emp: v.emp, opened: 0, total: 0, active: 0 };
    r.total++;
    if (firstIx(v) >= fromIx && firstIx(v) > 0) r.opened++;
    if (isActive(v, s)) r.active++;
    m.set(v.emp, r);
  }
  return [...m.values()].sort((a, b) => b.opened - a.opened || b.active - a.active || b.total - a.total);
}

export function salaryBy<K extends string>(list: Vacancy[], key: (v: Vacancy) => K | null) {
  const groups = new Map<K, number[]>();
  for (const v of uniqueAds(list)) {
    const k = key(v);
    if (k == null || !v.usd) continue;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(v.usd);
  }
  return groups;
}

export function lifetime(list: Vacancy[], s: Store) {
  const spells: Array<[number, number, boolean]> = [];
  for (const v of list) {
    if (!v.created) continue;
    const created = Date.parse(v.created);
    const first = Date.parse(s.days[firstIx(v)]);
    const last = Date.parse(s.days[lastSeenIx(v)]);
    if (created > last) continue;
    const entry = Math.max(0, Math.round((first - created) / 86400000));
    const active = isActive(v, s);
    spells.push([entry, Math.round((last - created) / 86400000) + (active ? 0 : 1), !active]);
  }
  return kaplanMeier(spells);
}

export function disclosure(list: Vacancy[]) {
  const ads = uniqueAds(list);
  return ads.length ? (100 * ads.filter((v) => v.sal && (v.sal[0] || v.sal[1])).length) / ads.length : 0;
}

export function shareBy<K extends string>(list: Vacancy[], key: (v: Vacancy) => K | null) {
  const ads = uniqueAds(list);
  const m = new Map<K, number>();
  for (const v of ads) { const k = key(v); if (k != null) m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m.entries()].map(([k, n]) => ({ key: k, n, share: (100 * n) / Math.max(ads.length, 1) })).sort((a, b) => b.n - a.n);
}

export function languageStats(list: Vacancy[]) {
  const ads = uniqueAds(list);
  const m = new Map<string, number>();
  for (const v of ads) for (const name of new Set(v.lg.map((l) => l[0]))) m.set(name, (m.get(name) ?? 0) + 1);
  return [...m.entries()].map(([name, n]) => ({ name, n, share: (100 * n) / Math.max(ads.length, 1) })).sort((a, b) => b.n - a.n);
}

export const activeCount = (list: Vacancy[], s: Store) => list.filter((v) => isActive(v, s)).length;
export const activeOnCount = (list: Vacancy[], ix: number) => list.filter((v) => activeOn(v, ix)).length;
export { quartiles };

// ---------- навыки ----------

export const skillKey = (name: string) => name.trim().toLowerCase();

/** Все навыки с числом вакансий; редкие отсекаются — по ним ничего не скажешь. */
export function skillIndex(list: Vacancy[], minAds = 10) {
  const m = new Map<string, { key: string; name: string; n: number; names: Map<string, number> }>();
  for (const v of uniqueAds(list)) {
    for (const name of v.sk) {
      const k = skillKey(name);
      const r = m.get(k) ?? { key: k, name, n: 0, names: new Map() };
      r.names.set(name, (r.names.get(name) ?? 0) + 1);
      m.set(k, r);
    }
    for (const k of new Set(v.sk.map(skillKey))) m.get(k)!.n++;
  }
  return [...m.values()]
    .filter((r) => r.n >= minAds)
    .map((r) => ({ key: r.key, n: r.n, name: [...r.names.entries()].sort((a, b) => b[1] - a[1])[0][0] }))
    .sort((a, b) => b.n - a.n);
}

/** Надбавка за навык: медиана с навыком против медианы без него ВНУТРИ одной
 *  роли и одного опыта, затем среднее по группам с весом по размеру меньшей
 *  стороны. Без этого «надбавка» Kubernetes была бы разницей между DevOps и
 *  техподдержкой. Это связь, а не причина: навык может просто чаще встречаться
 *  в вакансиях сильных компаний. */
export function skillPremium(key: string, list: Vacancy[], minSide = 5) {
  const groups = new Map<string, { with: number[]; without: number[] }>();
  for (const v of uniqueAds(list)) {
    if (!v.usd || !v.p || !v.e) continue;
    const g = groups.get(`${v.p}|${v.e}`) ?? { with: [], without: [] };
    (v.sk.some((x) => skillKey(x) === key) ? g.with : g.without).push(v.usd);
    groups.set(`${v.p}|${v.e}`, g);
  }
  let wsum = 0, acc = 0, nWith = 0, used = 0;
  for (const g of groups.values()) {
    if (g.with.length < minSide || g.without.length < minSide) continue;
    const mw = quartiles(g.with, 1)!.median, mo = quartiles(g.without, 1)!.median;
    const w = Math.min(g.with.length, g.without.length);
    acc += w * Math.log(mw / mo);
    wsum += w; nWith += g.with.length; used++;
  }
  if (nWith < 15 || !used) return null;
  return { pct: 100 * (Math.exp(acc / wsum) - 1), nWith, groups: used };
}

/** С какими навыками встречается вместе — доля вакансий с навыком, где есть и второй. */
export function coSkills(key: string, list: Vacancy[], top = 12) {
  const withSkill = uniqueAds(list).filter((v) => v.sk.some((x) => skillKey(x) === key));
  const m = new Map<string, { name: string; n: number }>();
  for (const v of withSkill) for (const name of v.sk) {
    const k = skillKey(name);
    if (k === key) continue;
    const r = m.get(k) ?? { name, n: 0 };
    r.n++;
    m.set(k, r);
  }
  return [...m.entries()].map(([k, r]) => ({ key: k, name: r.name, share: (100 * r.n) / Math.max(withSkill.length, 1), n: r.n }))
    .sort((a, b) => b.n - a.n).slice(0, top);
}
