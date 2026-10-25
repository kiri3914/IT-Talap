import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ScopeBar, scopeColor, useScope, useStore } from "../ctx";
import { activeOn, employerName, firstIx, inScope, uniqueAds } from "../model/store";
import { activeByDay } from "../model/derive";
import { quartiles } from "../model/stats";
import { IN_COUNTRY, fmtDay, fmtDayShort, int, usd } from "../model/format";
import { HBars, LineDaily, head, row } from "../charts/kit";

const WD_LONG = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];

export default function TimeMachine() {
  const s = useStore();
  const [scope] = useScope();
  const [ix, setIx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const color = scopeColor(scope);
  const list = useMemo(() => s.vacancies.filter(inScope(scope)), [s, scope]);
  const series = useMemo(() => activeByDay(list, s), [list, s]);

  useEffect(() => {
    if (!playing) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = setInterval(() => setIx((i) => {
      if (i >= s.lastIx) { setPlaying(false); return i; }
      return i + 1;
    }), reduce ? 900 : 450);
    return () => clearInterval(t);
  }, [playing, s.lastIx]);

  const d = useMemo(() => {
    const on = list.filter((v) => activeOn(v, ix));
    const now = list.filter((v) => activeOn(v, s.lastIx));
    const count = (arr: typeof list) => {
      const m = new Map<string, number>();
      for (const v of arr) if (v.p) m.set(v.p, (m.get(v.p) ?? 0) + 1);
      return m;
    };
    const cOn = count(on), cNow = count(now);
    const emp = new Map<string, number>();
    for (const v of uniqueAds(on)) if (v.emp && !s.employers[v.emp]?.person) emp.set(v.emp, (emp.get(v.emp) ?? 0) + 1);
    return {
      on,
      salary: quartiles(uniqueAds(on).map((v) => v.usd).filter((x): x is number => !!x)),
      opened: list.filter((v) => firstIx(v) === ix && ix > 0).length,
      closed: (s.events.filter((e) => e[0] === ix && e[1] === "close" && list.some((v) => v.id === e[2]))).length,
      profs: [...cOn.entries()].map(([p, n]) => ({ p, n, now: cNow.get(p) ?? 0 })).sort((a, b) => b.n - a.n).slice(0, 12),
      emp: [...emp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
    };
  }, [list, ix, s]);

  const day = s.days[ix];
  const weekday = new Date(day + "T12:00:00").getDay();

  return (
    <>
      <ScopeBar />
      <main className="wrap">
        <p className="eyebrow">Машина времени</p>
        <h1 className="page-title">Рынок на {fmtDay(day)}</h1>
        <p className="lede">Каждую ночь мы сохраняем снимок выдачи, поэтому можно вернуться в любой день наблюдения и посмотреть, что было открыто {IN_COUNTRY[scope]}. Такой истории нет у самих площадок.</p>

        <div style={{ display: "flex", gap: 14, alignItems: "center", marginTop: 28, flexWrap: "wrap" }}>
          <button type="button" className="btn" onClick={() => { if (ix >= s.lastIx) setIx(0); setPlaying((p) => !p); }}>{playing ? "Пауза" : "▶ Проиграть"}</button>
          <input type="range" id="tm-day" min={0} max={s.lastIx} value={ix} onChange={(e) => { setPlaying(false); setIx(Number(e.target.value)); }}
            style={{ flex: "1 1 320px" }} aria-label="День наблюдения" />
          <span className="num" style={{ minWidth: 150 }}>{WD_LONG[weekday]}, {fmtDay(day)}</span>
        </div>

        <div className="kpis">
          <div className="kpi"><div className="v num">{int(d.on.length)}</div><div className="k">открытых IT-вакансий</div><div className="s">{ix === s.lastIx ? "сегодня" : `сегодня — ${int(series[s.lastIx])}`}</div></div>
          <div className="kpi"><div className="v num">{ix > 0 ? `+${int(d.opened)}` : "—"}</div><div className="k">появилось в этот день</div></div>
          <div className="kpi"><div className="v num">{ix > 0 ? `−${int(d.closed)}` : "—"}</div><div className="k">пропало в этот день</div></div>
          <div className="kpi"><div className="v num">{d.salary ? usd(d.salary.median) : "—"}</div><div className="k">медианная зарплата открытых</div></div>
        </div>

        <figure>
          <LineDaily color={color} label="Открытые вакансии по дням" height={200} marker={ix}
            points={s.days.map((dd, i) => ({
              key: dd, label: dd, value: series[i], weekend: [0, 6].includes(new Date(dd + "T12:00:00").getDay()),
              tick: new Date(dd + "T12:00:00").getDay() === 1 ? fmtDayShort(dd) : undefined,
              tip: () => head(fmtDay(dd)) + row("Открыто", int(series[i])) + (i === ix ? row("", "выбранный день") : ""),
            }))} />
          <figcaption>Число открытых вакансий по нашим снимкам. Пропуски 5–6 октября здесь не видны: присутствие в эти дни выводится из соседних снимков.</figcaption>
        </figure>

        <div className="two" style={{ marginTop: 32 }}>
          <figure>
            <h3 className="sub">Профессии в этот день</h3>
            <p className="subnote">в скобках — сколько открыто сегодня</p>
            <div style={{ marginTop: 12 }}>
              <HBars color={color} label="Профессии на выбранный день" labelW={230} valueW={96}
                rows={d.profs.map((x) => ({ key: x.p, label: s.overview.professions[x.p]?.title ?? x.p, value: x.n, display: `${int(x.n)} (${int(x.now)})`, href: `/p/${x.p}`,
                  tip: () => head(s.overview.professions[x.p]?.title ?? x.p) + row(fmtDay(day), int(x.n)) + row("Сегодня", int(x.now)) }))} />
            </div>
          </figure>
          <figure>
            <h3 className="sub">Кто нанимал больше всех</h3>
            <div style={{ marginTop: 12 }}>
              <HBars color={color} label="Компании на выбранный день" labelW={230}
                rows={d.emp.map(([k, n]) => ({ key: k, label: employerName(k, s), value: n, display: int(n), href: `/c/${k}` }))} />
            </div>
          </figure>
        </div>
        <p className="subnote" style={{ marginTop: 24 }}>Совет: включите проигрывание и смотрите на выходные — к воскресенью рынок каждый раз сжимается. <Link to="/m">Подробнее о недельном цикле</Link></p>
      </main>
    </>
  );
}
