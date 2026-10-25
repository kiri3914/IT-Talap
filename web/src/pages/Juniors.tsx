import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ScopeBar, scopeColor, useScope, useStore } from "../ctx";
import { ageDays, employerName, firstIx, inScope, isActive, uniqueAds } from "../model/store";
import { hiringEmployers, windowStart } from "../model/derive";
import { quartiles } from "../model/stats";
import { COUNTRY, IN_COUNTRY, int, kUsd, nVac, pct, usd } from "../model/format";
import { DotRange, HBars, Table, head, row } from "../charts/kit";
import type { Country, Vacancy } from "../model/types";

const isJunior = (v: Vacancy) => v.e === "noExperience" || v.intern;

export default function Juniors() {
  const s = useStore();
  const [scope] = useScope();
  const color = scopeColor(scope);

  const d = useMemo(() => {
    const list = s.vacancies.filter(inScope(scope));
    const jun = list.filter(isJunior);
    const ads = uniqueAds(list), jads = uniqueAds(jun);
    const byProf = Object.keys(s.overview.professions).map((p) => {
      const pa = ads.filter((v) => v.p === p), pj = jads.filter((v) => v.p === p);
      return { p, n: pj.length, share: (100 * pj.length) / Math.max(pa.length, 1), q: quartiles(pj.map((v) => v.usd).filter((x): x is number => !!x), 5) };
    }).filter((x) => x.n >= 3).sort((a, b) => b.n - a.n);
    const countries = (["kz", "uz", "kg"] as Country[]).map((c) => {
      const cj = uniqueAds(s.vacancies.filter((v) => v.c === c && isJunior(v)));
      return { c, q: quartiles(cj.map((v) => v.usd).filter((x): x is number => !!x), 5) };
    });
    return {
      jads, share: (100 * jads.length) / Math.max(ads.length, 1),
      active: uniqueAds(jun.filter((v) => isActive(v, s))),
      interns: jads.filter((v) => v.intern).length,
      salary: quartiles(jads.map((v) => v.usd).filter((x): x is number => !!x)),
      byProf, countries,
      employers: hiringEmployers(jun, s, windowStart(s, 30)).slice(0, 15),
    };
  }, [s, scope]);

  return (
    <>
      <ScopeBar />
      <main className="wrap">
        <p className="eyebrow">Без опыта</p>
        <h1 className="page-title">Где в IT берут без опыта</h1>
        <p className="lede">
          {IN_COUNTRY[scope][0].toUpperCase() + IN_COUNTRY[scope].slice(1)} вакансии без требований к опыту и стажировки — <b>{pct(d.share)}</b> всех IT-вакансий.
          Сейчас открыто <b>{nVac(d.active.length)}</b>{d.salary && <>, медианная зарплата — <b>{usd(d.salary.median)}</b></>}.
        </p>

        <div className="kpis">
          <div className="kpi"><div className="v num">{int(d.active.length)}</div><div className="k">открыто сейчас</div></div>
          <div className="kpi"><div className="v num">{pct(d.share)}</div><div className="k">всех IT-вакансий</div></div>
          <div className="kpi"><div className="v num">{d.salary ? usd(d.salary.median) : "—"}</div><div className="k">медианная зарплата</div><div className="s">{d.salary ? `половина — ${usd(d.salary.p25)}–${usd(d.salary.p75)}` : ""}</div></div>
          <div className="kpi"><div className="v num">{int(d.interns)}</div><div className="k">стажировок за время наблюдения</div></div>
        </div>

        <section className="block">
          <p className="eyebrow">Куда проще войти</p>
          <h2>{d.byProf[0] ? `Больше всего мест без опыта — «${s.overview.professions[d.byProf[0].p]?.title}»` : "Профессии"}</h2>
          <div className="two" style={{ marginTop: 8 }}>
            <figure>
              <h3 className="sub">Вакансий без опыта</h3>
              <div style={{ marginTop: 12 }}>
                <HBars color={color} label="Вакансии без опыта по профессиям" labelW={230}
                  rows={d.byProf.slice(0, 12).map((x) => ({ key: x.p, label: s.overview.professions[x.p]?.title ?? x.p, value: x.n, display: int(x.n), href: `/p/${x.p}`,
                    tip: () => head(s.overview.professions[x.p]?.title ?? x.p) + row("Без опыта", int(x.n)) + row("Доля в профессии", pct(x.share)) }))} />
              </div>
            </figure>
            <figure>
              <h3 className="sub">Сколько платят на старте, $ в месяц</h3>
              <div style={{ marginTop: 12 }}>
                <DotRange color={color} label="Зарплата без опыта" format={kUsd}
                  rows={d.byProf.filter((x) => x.q).sort((a, b) => b.q!.median - a.q!.median).slice(0, 12).map((x) => ({
                    key: x.p, label: s.overview.professions[x.p]?.title ?? x.p, ...x.q!, href: `/p/${x.p}`,
                    tip: () => head(s.overview.professions[x.p]?.title ?? x.p) + row("Медиана", usd(x.q!.median)) + row("Вакансий с зарплатой", int(x.q!.n)),
                  }))} />
              </div>
              <p className="subnote" style={{ marginTop: 8 }}>Порог здесь 5 вакансий, а не 10: без опыта зарплату указывают чаще, но вакансий меньше.</p>
            </figure>
          </div>
        </section>

        <section className="block">
          <p className="eyebrow">По странам</p>
          <h2>Стартовая зарплата в трёх странах</h2>
          <figure>
            <Table head={["Страна", "Медиана", "Половина вакансий", "С зарплатой"]}
              rows={d.countries.map((r) => [COUNTRY[r.c], r.q ? usd(r.q.median) : "—", r.q ? `${usd(r.q.p25)}–${usd(r.q.p75)}` : "—", r.q ? int(r.q.n) : "—"])} />
          </figure>
        </section>

        <section className="block">
          <p className="eyebrow">Кто берёт</p>
          <h2>Компании, открывавшие вакансии без опыта</h2>
          <figure>
            <Table head={["Компания", "Открыла за 30 дней", "Открыто сейчас", "Всего"]}
              rows={d.employers.map((e) => [<Link to={`/c/${e.emp}`}>{employerName(e.emp, s)}</Link>, int(e.opened), int(e.active), int(e.total)])} />
          </figure>
        </section>

        <section className="block">
          <p className="eyebrow">Открыто сейчас</p>
          <h2>{nVac(d.active.length)} без опыта</h2>
          <figure>
            <Table head={["Вакансия", "Компания", "Город", "Зарплата", "Висит"]}
              rows={[...d.active].sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0) || firstIx(b) - firstIx(a)).slice(0, 40).map((v) => {
                const age = ageDays(v, s);
                return [<Link to={`/v/${v.id}`}>{v.t}{v.intern ? " · стажировка" : ""}</Link>, employerName(v.emp, s), v.city ?? "", v.usd ? usd(v.usd) : "—", age != null ? `${int(age)} дн.` : "—"];
              })} />
          </figure>
        </section>
      </main>
    </>
  );
}
