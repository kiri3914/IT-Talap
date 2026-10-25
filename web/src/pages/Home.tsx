import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ScopeBar, scopeColor, useScope, useStore } from "../ctx";
import { employerName, estimate, firstIx, inScope, isActive, uniqueAds } from "../model/store";
import { countEvents, eventsFor, hiringEmployers, windowStart } from "../model/derive";
import { quartiles } from "../model/stats";
import { IN_COUNTRY, dec1, int, nVac, pct0, usd } from "../model/format";
import { HBars, head, row } from "../charts/kit";
import { Feed } from "../components/Feed";
import { parseVacancyId } from "../components/Search";

export default function Home() {
  const s = useStore();
  const [scope] = useScope();
  const nav = useNavigate();
  const [link, setLink] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const color = scopeColor(scope);

  const d = useMemo(() => {
    const list = s.vacancies.filter(inScope(scope));
    const ids = new Set(list.map((v) => v.id));
    const from7 = windowStart(s, 7), from30 = windowStart(s, 30);
    const week = countEvents(eventsFor(ids, s, from7));
    const salaryEvents = eventsFor(ids, s, from30, ["salary_up", "salary_down", "salary_set", "salary_drop"]);
    const active = list.filter((v) => isActive(v, s));
    // Профессии: где за неделю открылось больше всего относительно открытого
    const profs = Object.entries(s.overview.professions).map(([code, p]) => {
      const pl = list.filter((v) => v.p === code);
      const opened = uniqueAds(pl).filter((v) => firstIx(v) >= from7 && firstIx(v) > 0).length;
      return { code, title: p.title, opened, active: pl.filter((v) => isActive(v, s)).length };
    });
    const paid = uniqueAds(list).map((v) => v.usd).filter((x): x is number => !!x);
    return { week, salaryEvents, active, profs, salary: quartiles(paid), employers: hiringEmployers(list, s, from30).slice(0, 10) };
  }, [s, scope]);

  const k = s.overview.scopes[scope].kpi;
  const go = (e: React.FormEvent) => {
    e.preventDefault();
    const id = parseVacancyId(link);
    if (!id) return setErr("Не похоже на ссылку на вакансию. Пример: https://hh.kz/vacancy/123456789");
    if (!s.byId.has(id)) return setErr(`Вакансии ${id} нет в наших данных — мы собираем IT-вакансии трёх стран с 11 сентября 2026 года.`);
    nav(`/v/${id}`);
  };

  return (
    <>
      <ScopeBar />
      <main className="wrap">
        <p className="eyebrow">Рынок IT-вакансий · Казахстан · Узбекистан · Кыргызстан</p>
        <h1 className="page-title">Что происходит с вакансией, о которой вы думаете</h1>
        <p className="lede">Вставьте ссылку на вакансию с hh — покажем, сколько она висит, сколько раз её поднимали и меняли вилку, и сколько платят похожие вакансии, если зарплата не указана.</p>
        <form className="bigsearch" onSubmit={go}>
          <input id="xray-link" value={link} onChange={(e) => { setLink(e.target.value); setErr(null); }} placeholder="https://hh.kz/vacancy/…" aria-label="Ссылка на вакансию" />
          <button className="btn" type="submit">Сделать рентген</button>
        </form>
        {err && <p className="error">{err}</p>}
        <p className="subnote" style={{ marginTop: 10 }}>
          Например: {uniqueAds(d.active).filter((v) => !v.usd && v.p === "developer" && v.e === "between3And6" && estimate(v, s)).slice(0, 1).map((v) => <Link key={v.id} to={`/v/${v.id}`}>{v.t}</Link>)}
          {" · "}
          {uniqueAds(d.active).filter((v) => (s.evById.get(v.id) ?? []).some((e) => e[1] === "salary_up")).slice(0, 1).map((v) => <Link key={v.id} to={`/v/${v.id}`}>{v.t}</Link>)}
        </p>

        <div className="kpis">
          <div className="kpi"><div className="v num">{int(d.active.length)}</div><div className="k">открытых IT-вакансий</div><div className="s">{IN_COUNTRY[scope]}</div></div>
          <div className="kpi"><div className="v num">{dec1(k.it_share_pct)}<small>%</small></div><div className="k">доля IT среди всех вакансий hh</div></div>
          <div className="kpi"><div className="v num">{d.salary ? usd(d.salary.median) : "—"}</div><div className="k">медианная зарплата</div><div className="s">по вакансиям с вилкой</div></div>
          <div className="kpi"><div className="v num">{pct0(k.disclosed_pct)}</div><div className="k">указывают зарплату</div></div>
        </div>

        <section className="block">
          <p className="eyebrow">Последние 7 дней</p>
          <h2>Открылось {nVac(d.week.open)}, пропало {int(d.week.close)}</h2>
          <p className="dek">Вилку подняли в <b>{int(d.week.salary_up)}</b>, снизили в <b>{int(d.week.salary_down)}</b>. Работодатели подняли вакансии в поиске <b>{int(d.week.raise)}</b> раз.</p>
          <div className="two" style={{ marginTop: 8 }}>
            <figure>
              <h3 className="sub">Где больше всего новых вакансий</h3>
              <div style={{ marginTop: 12 }}>
                <HBars color={color} label="Новые вакансии за неделю по профессиям" labelW={240}
                  rows={[...d.profs].sort((a, b) => b.opened - a.opened).slice(0, 10).map((p) => ({
                    key: p.code, label: p.title, value: p.opened, display: `+${int(p.opened)}`, href: `/p/${p.code}`,
                    tip: () => head(p.title) + row("Открылось за неделю", int(p.opened)) + row("Открыто сейчас", int(p.active)),
                  }))} />
              </div>
            </figure>
            <figure>
              <h3 className="sub">Кто больше всех нанимает за 30 дней</h3>
              <div style={{ marginTop: 12 }}>
                <HBars color={color} label="Компании по числу новых вакансий" labelW={240}
                  rows={d.employers.map((e) => ({
                    key: e.emp, label: employerName(e.emp, s), value: e.opened, display: int(e.opened), href: `/c/${e.emp}`,
                    tip: () => head(employerName(e.emp, s)) + row("Открыла за 30 дней", int(e.opened)) + row("Открыто сейчас", int(e.active)),
                  }))} />
              </div>
            </figure>
          </div>
        </section>

        <section className="block">
          <p className="eyebrow">Зарплаты меняются</p>
          <h2>Вилки, которые изменили за месяц</h2>
          <p className="dek">Редкое событие и поэтому интересное: работодатель передумал, сколько готов платить.</p>
          <div style={{ marginTop: 16 }}><Feed events={d.salaryEvents} s={s} limit={10} /></div>
        </section>
      </main>
    </>
  );
}
