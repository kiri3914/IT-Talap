import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { ScopeBar, scopeColor, useScope, useStore } from "../ctx";
import { ageDays, employerName, firstIx, inScope, isActive, uniqueAds } from "../model/store";
import { coSkills, hiringEmployers, opensByWeek, skillKey, skillPremium, windowStart } from "../model/derive";
import { quartiles } from "../model/stats";
import { IN_COUNTRY, dec1, fmtDayShort, int, nVac, pct, pct0, usd } from "../model/format";
import { Columns, HBars, Table, head, row } from "../charts/kit";

export default function Skill() {
  const { key: raw = "" } = useParams();
  const key = skillKey(decodeURIComponent(raw));
  const s = useStore();
  const [scope] = useScope();
  const color = scopeColor(scope);

  const d = useMemo(() => {
    const all = s.vacancies.filter(inScope(scope));
    const has = (v: (typeof all)[0]) => v.sk.some((x) => skillKey(x) === key);
    const list = all.filter(has);
    const ads = uniqueAds(list);
    const name = list[0]?.sk.find((x) => skillKey(x) === key) ?? raw;
    const total = uniqueAds(all).length;
    // доля вакансий профессии, где навык упомянут
    const byProf = new Map<string, { n: number; total: number }>();
    for (const v of uniqueAds(all)) {
      if (!v.p) continue;
      const r = byProf.get(v.p) ?? { n: 0, total: 0 };
      r.total++;
      if (has(v)) r.n++;
      byProf.set(v.p, r);
    }
    return {
      name, list, ads,
      share: (100 * ads.length) / Math.max(total, 1),
      active: list.filter((v) => isActive(v, s)),
      premium: skillPremium(key, all),
      salary: quartiles(ads.map((v) => v.usd).filter((x): x is number => !!x)),
      roles: [...byProf.entries()].filter(([, r]) => r.n >= 3).map(([p, r]) => ({ p, n: r.n, share: (100 * r.n) / r.total })).sort((a, b) => b.n - a.n),
      weeks: opensByWeek(list, s),
      co: coSkills(key, all),
      employers: hiringEmployers(list, s, windowStart(s, 30)),
    };
  }, [s, scope, key, raw]);

  if (!d.ads.length) return <><ScopeBar /><main className="wrap"><h1 className="page-title">Навык не встречается {IN_COUNTRY[scope]}</h1></main></>;

  return (
    <>
      <ScopeBar />
      <main className="wrap">
        <nav className="crumbs"><Link to="/">Обзор</Link><span>›</span><Link to="/s">Навыки</Link></nav>
        <h1 className="page-title">{d.name}</h1>
        <p className="lede">
          Встречается в <b>{pct(d.share)}</b> IT-вакансий {IN_COUNTRY[scope]} — это {nVac(d.ads.length)} за время наблюдения, сейчас открыто <b>{int(uniqueAds(d.active).length)}</b>.
          {d.premium && <> При той же роли и опыте вакансии с этим навыком предлагают на <b>{d.premium.pct >= 0 ? "" : "−"}{dec1(Math.abs(d.premium.pct))}%</b> {d.premium.pct >= 0 ? "больше" : "меньше"}.</>}
        </p>

        <div className="kpis">
          <div className="kpi"><div className="v num">{int(uniqueAds(d.active).length)}</div><div className="k">открыто сейчас</div></div>
          <div className="kpi"><div className="v num">{pct0(d.share)}</div><div className="k">IT-вакансий упоминают</div></div>
          <div className="kpi"><div className="v num">{d.salary ? usd(d.salary.median) : "—"}</div><div className="k">медианная зарплата</div><div className="s">в вакансиях с навыком</div></div>
          <div className="kpi">
            <div className="v num">{d.premium ? `${d.premium.pct >= 0 ? "+" : "−"}${dec1(Math.abs(d.premium.pct))}` : "—"}<small>{d.premium ? "%" : ""}</small></div>
            <div className="k">надбавка при той же роли и опыте</div>
            <div className="s">{d.premium ? `по ${int(d.premium.nWith)} вакансиям в ${int(d.premium.groups)} группах` : "мало вакансий с зарплатой"}</div>
          </div>
        </div>

        <section className="block">
          <p className="eyebrow">Где нужен</p>
          <h2>{d.roles[0] ? `Чаще всего — в роли «${s.overview.professions[d.roles[0].p]?.title}»` : "Роли"}</h2>
          <div className="two" style={{ marginTop: 8 }}>
            <figure>
              <h3 className="sub">Доля вакансий профессии с этим навыком</h3>
              <div style={{ marginTop: 12 }}>
                <HBars color={color} label="Доля по профессиям" labelW={230}
                  rows={[...d.roles].sort((a, b) => b.share - a.share).slice(0, 10).map((r) => ({
                    key: r.p, label: s.overview.professions[r.p]?.title ?? r.p, value: r.share, display: pct(r.share), href: `/p/${r.p}`,
                    tip: () => head(s.overview.professions[r.p]?.title ?? r.p) + row("Вакансий с навыком", int(r.n)) + row("Доля в профессии", pct(r.share)),
                  }))} />
              </div>
            </figure>
            <figure>
              <h3 className="sub">С чем встречается вместе</h3>
              <div className="chips" style={{ marginTop: 12 }}>
                {d.co.map((c) => <Link className="chip" key={c.key} to={`/s/${encodeURIComponent(c.key)}`}>{c.name}<b>{pct0(c.share)}</b></Link>)}
              </div>
            </figure>
          </div>
        </section>

        <section className="block">
          <p className="eyebrow">Спрос</p>
          <h2>Новые вакансии с навыком по неделям</h2>
          <figure>
            <Columns color={color} label="Новые вакансии по неделям" height={180}
              rows={d.weeks.map((w) => ({ key: w.week, label: fmtDayShort(w.week), value: w.count, muted: w.partial,
                tip: () => head(`Неделя с ${fmtDayShort(w.week)}`) + row("Новых вакансий", int(w.count)) }))} />
          </figure>
        </section>

        <section className="block">
          <p className="eyebrow">Кто ищет</p>
          <h2>Компании с этим навыком в вакансиях</h2>
          <figure>
            <Table head={["Компания", "Открыла за 30 дней", "Открыто сейчас", "Всего"]}
              rows={d.employers.slice(0, 15).map((e) => [<Link to={`/c/${e.emp}`}>{employerName(e.emp, s)}</Link>, int(e.opened), int(e.active), int(e.total)])} />
          </figure>
        </section>

        <section className="block">
          <p className="eyebrow">Открыто сейчас</p>
          <h2>{nVac(uniqueAds(d.active).length)}</h2>
          <figure>
            <Table head={["Вакансия", "Компания", "Город", "Зарплата", "Висит"]}
              rows={uniqueAds(d.active).sort((a, b) => firstIx(b) - firstIx(a)).slice(0, 40).map((v) => {
                const age = ageDays(v, s);
                return [<Link to={`/v/${v.id}`}>{v.t}</Link>, employerName(v.emp, s), v.city ?? "", v.usd ? usd(v.usd) : "—", age != null ? `${int(age)} дн.` : "—"];
              })} />
          </figure>
        </section>
      </main>
    </>
  );
}
