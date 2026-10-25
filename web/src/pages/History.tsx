import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useStore } from "../ctx";
import { quartiles } from "../model/stats";
import { COUNTRY, int, pct0 } from "../model/format";
import { Columns, Table, head, row } from "../charts/kit";
import type { Country } from "../model/types";

const SIGN: Record<string, string> = { KZT: "₸", UZS: "сум", KGS: "сом", USD: "$", RUB: "₽" };
const MIN_POSTS = 30;

export default function History() {
  const s = useStore();
  const [c, setC] = useState<Country>("kz");
  const [prof, setProf] = useState("");

  const posts = useMemo(() => s.telegram.filter((p) => p[1] === c), [s, c]);
  // валюта страны — та, в которой чаще всего пишут вилки
  const currency = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of posts) if (p[2] && p[3]) m.set(p[2], (m.get(p[2]) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "USD";
  }, [posts]);

  const profOptions = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of posts) if (p[4] && p[2] === currency && p[3]) m.set(p[4], (m.get(p[4]) ?? 0) + 1);
    return [...m.entries()].filter(([, n]) => n >= MIN_POSTS).sort((a, b) => b[1] - a[1]);
  }, [posts, currency]);

  const years = useMemo(() => {
    const by = new Map<number, number[]>();
    for (const p of posts) {
      if (p[2] !== currency || !p[3] || (prof && p[4] !== prof)) continue;
      (by.get(p[0]) ?? by.set(p[0], []).get(p[0])!).push(p[3]);
    }
    return [...by.entries()].sort((a, b) => a[0] - b[0]).flatMap(([y, vals]) => {
      const q = quartiles(vals, MIN_POSTS);
      return q ? [{ year: y, ...q }] : [];
    });
  }, [posts, currency, prof]);

  // как менялся состав спроса: доля профессий среди постов-вакансий по годам
  const mix = useMemo(() => {
    const total = new Map<number, number>(), cnt = new Map<string, Map<number, number>>();
    for (const p of posts) {
      total.set(p[0], (total.get(p[0]) ?? 0) + 1);
      if (!p[4]) continue;
      const m = cnt.get(p[4]) ?? cnt.set(p[4], new Map()).get(p[4])!;
      m.set(p[0], (m.get(p[0]) ?? 0) + 1);
    }
    const ys = [...total.keys()].filter((y) => total.get(y)! >= 100).sort();
    const top = [...cnt.entries()].map(([k, m]) => [k, [...m.values()].reduce((a, b) => a + b, 0)] as const).sort((a, b) => b[1] - a[1]).slice(0, 8);
    return { ys, rows: top.map(([k]) => ({ k, shares: ys.map((y) => (100 * (cnt.get(k)!.get(y) ?? 0)) / total.get(y)!) })) };
  }, [posts]);

  const sign = SIGN[currency] ?? currency;
  const fmt = (v: number) => (currency === "UZS" ? `${int(v / 1e6)} млн` : currency === "USD" ? `$${int(v)}` : `${int(v / 1000)} тыс.`);
  const f = years[0], l = years[years.length - 1];
  const lastYear = new Date(s.days[s.lastIx]).getFullYear();

  return (
    <main className="wrap">
      <p className="eyebrow">Десять лет · телеграм-каналы</p>
      <h1 className="page-title">{f && l && f !== l ? `С ${f.year} года медиана вилки выросла с ${fmt(f.median)} до ${fmt(l.median)} ${currency === "USD" ? "" : sign}` : "История зарплат"}</h1>
      <p className="lede">
        У hh нет истории, поэтому глубже заглядываем через архив телеграм-каналов с вакансиями. Суммы — в валюте, в которой их пишут, без поправки на инфляцию.
        Профессию распознают правила по заголовку: они узнают около 70% заголовков и в 84% случаев совпадают с ролью, которую указывает работодатель на hh.
      </p>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 24, alignItems: "end" }}>
        <div className="field">
          <label>Страна</label>
          <div className="seg">
            {(["kz", "uz", "kg"] as Country[]).map((x) => (
              <button key={x} type="button" aria-pressed={x === c} onClick={() => { setC(x); setProf(""); }}>
                <i className="dot" style={{ ["--c" as string]: `var(--${x})` }} />{COUNTRY[x]}
              </button>
            ))}
          </div>
        </div>
        <div className="field" style={{ minWidth: 260 }}>
          <label htmlFor="hist-prof">Профессия</label>
          <select id="hist-prof" value={prof} onChange={(e) => setProf(e.target.value)}>
            <option value="">Все вакансии</option>
            {profOptions.map(([k, n]) => <option key={k} value={k}>{s.overview.professions[k]?.title ?? k} ({int(n)})</option>)}
          </select>
        </div>
        <span className="subnote">Валюта: {currency}</span>
      </div>

      <figure>
        {years.length ? (
          <Columns color={`var(--${c})`} label="Медиана вилки по годам" height={280} format={fmt}
            rows={years.map((y) => ({
              key: String(y.year), label: String(y.year), value: y.median, muted: y.year === lastYear,
              tip: () => head(`${y.year}${y.year === lastYear ? " (неполный)" : ""}`) + row("Медиана", `${int(y.median)} ${sign}`) +
                row("Половина вакансий", `${fmt(y.p25)}–${fmt(y.p75)}`) + row("Постов с вилкой", int(y.n)),
            }))} />
        ) : <p className="empty">Для этой выборки меньше {MIN_POSTS} постов с вилкой в любом году.</p>}
        <figcaption>Годы, где меньше {MIN_POSTS} постов с вилкой, не показаны. Последний год неполный — он бледнее.</figcaption>
      </figure>

      <section className="block">
        <p className="eyebrow">Состав спроса</p>
        <h2>Доля профессий среди вакансий в каналах</h2>
        <p className="dek">Как менялось, кого ищут. Годы с меньше чем 100 постами не показаны. Часть архива каналы удаляют, поэтому смотрите на доли, а не на число постов.</p>
        <figure>
          <Table head={["Профессия", ...mix.ys.map(String)]}
            rows={mix.rows.map((r) => [
              <Link to={`/p/${r.k}`}>{s.overview.professions[r.k]?.title ?? r.k}</Link>,
              ...r.shares.map((x) => <span style={{ opacity: 0.35 + Math.min(0.65, x / 40) }}>{pct0(x)}</span>),
            ])} />
        </figure>
        {c === "kg" && <p className="subnote">У @findwork, главного канала Кыргызстана, нет постов за 2022–2025 годы — канал их удалил. Ряд по этим годам пуст не потому, что вакансий не было.</p>}
      </section>
    </main>
  );
}
