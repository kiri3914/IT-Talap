import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { scopeColor, useStore } from "../ctx";
import { ageDays, estimate, firstIx, isActive, uniqueAds } from "../model/store";
import { countEvents, disclosure, eventsFor, lifetime, opensByWeek, shareBy, skillStats, windowStart } from "../model/derive";
import { median } from "../model/stats";
import { COUNTRY, fmtDayShort, int, nVac, pct, pct0, plural, usd } from "../model/format";
import { Columns, HBars, Table, head, row } from "../charts/kit";
import { Feed } from "../components/Feed";

export default function Company() {
  const { id = "" } = useParams();
  const s = useStore();
  const emp = s.employers[id];
  const [showRaises, setShowRaises] = useState(false);

  const d = useMemo(() => {
    const list = s.byEmp.get(id) ?? [];
    const ads = uniqueAds(list);
    const active = list.filter((v) => isActive(v, s));
    const from30 = windowStart(s, 30);
    const evs = eventsFor(new Set(list.map((v) => v.id)), s, from30);
    // Платит ли выше рынка: медиана процентилей её вакансий среди похожих
    const pctls = ads.flatMap((v) => {
      if (!v.usd) return [];
      const e = estimate(v, s);
      return e?.percentile != null ? [e.percentile] : [];
    });
    const raisedShare = (100 * ads.filter((v) => (s.evById.get(v.id) ?? []).some((e) => e[1] === "raise")).length) / Math.max(ads.length, 1);
    const raisesPer = ads.reduce((n, v) => n + (s.evById.get(v.id) ?? []).filter((e) => e[1] === "raise").length, 0) / Math.max(ads.length, 1);
    return {
      list, ads, active, evs, counts: countEvents(evs),
      opened30: ads.filter((v) => firstIx(v) >= from30 && firstIx(v) > 0).length,
      weeks: opensByWeek(list, s),
      roles: shareBy(list, (v) => v.p),
      skills: skillStats(list, s),
      disclosed: disclosure(list),
      payPct: pctls.length >= 3 ? median(pctls) : null,
      payN: pctls.length,
      life: lifetime(list, s),
      raisedShare, raisesPer,
      countries: [...new Set(list.map((v) => v.c))],
    };
  }, [s, id]);

  if (!emp || emp.person) {
    return (
      <main className="wrap">
        <h1 className="page-title">{emp ? "Частный работодатель" : "Компании нет в данных"}</h1>
        <p className="lede">{emp ? "Страницы ИП не показываем: их название — имя человека." : "Возможно, у неё не было IT-вакансий за время наблюдения."}</p>
      </main>
    );
  }

  const color = scopeColor(d.countries.length === 1 ? d.countries[0] : "all");
  const feed = showRaises ? d.evs : d.evs.filter((e) => e[1] !== "raise");

  return (
    <main className="wrap">
      <nav className="crumbs"><Link to="/">Обзор</Link><span>›</span><Link to="/c">Компании</Link></nav>
      <h1 className="page-title">{emp.name}</h1>
      <p className="lede">
        {d.countries.map((c) => COUNTRY[c]).join(", ")}. За время наблюдения — <b>{nVac(d.ads.length)}</b>, сейчас открыто <b>{int(uniqueAds(d.active).length)}</b>.
        {d.payPct != null && <> Предлагает зарплату выше, чем <b>{pct0(d.payPct)}</b> похожих вакансий рынка.</>}
      </p>

      <div className="kpis">
        <div className="kpi"><div className="v num">{int(uniqueAds(d.active).length)}</div><div className="k">открыто сейчас</div></div>
        <div className="kpi"><div className="v num">{int(d.opened30)}</div><div className="k">открыла за 30 дней</div></div>
        <div className="kpi"><div className="v num">{int(d.disclosed)}<small>%</small></div><div className="k">вакансий с зарплатой</div><div className="s">по рынку — около 37%</div></div>
        <div className="kpi">
          <div className="v num">{d.payPct != null ? `${int(d.payPct)}` : "—"}<small>{d.payPct != null ? "-й" : ""}</small></div>
          <div className="k">процентиль зарплаты</div>
          <div className="s">{d.payPct != null ? `среди похожих, по ${int(d.payN)} вакансиям` : "мало вакансий с зарплатой"}</div>
        </div>
      </div>

      <section className="block">
        <p className="eyebrow">Активность</p>
        <h2>Как часто открывает вакансии</h2>
        <figure>
          <Columns color={color} label="Новые вакансии по неделям" height={180}
            rows={d.weeks.map((w) => ({ key: w.week, label: fmtDayShort(w.week), value: w.count, muted: w.partial,
              tip: () => head(`Неделя с ${fmtDayShort(w.week)}`) + row("Новых вакансий", int(w.count)) }))} />
        </figure>
        <div className="two" style={{ marginTop: 32 }}>
          <div>
            <h3 className="sub">Кого ищет</h3>
            <div style={{ marginTop: 12 }}>
              <HBars color={color} label="Роли" labelW={230}
                rows={d.roles.filter((r) => r.key).slice(0, 10).map((r) => ({
                  key: r.key!, label: s.overview.professions[r.key!]?.title ?? r.key!, value: r.n, display: int(r.n), href: `/p/${r.key}`,
                }))} />
            </div>
          </div>
          <div>
            <h3 className="sub">Какой стек</h3>
            <div style={{ marginTop: 12 }}>
              <HBars color={color} label="Навыки" labelW={200}
                rows={d.skills.slice(0, 10).map((k) => ({ key: k.key, label: k.name, value: k.share, display: pct(k.share) }))} />
            </div>
          </div>
        </div>
      </section>

      <section className="block">
        <p className="eyebrow">Поведение</p>
        <h2>Как ведёт вакансии</h2>
        <div className="three" style={{ marginTop: 20 }}>
          <div className="kpi" style={{ padding: 0, border: 0 }}>
            <div className="v num">{d.life.openAt30 != null ? `${int(100 - 100 * d.life.openAt30)}%` : "—"}</div>
            <div className="k">закрывает раньше 30 дней</div>
            <div className="s">{d.life.openAt30 != null ? "по рынку — около 33%" : "мало закрытых вакансий для оценки"}</div>
          </div>
          <div className="kpi" style={{ padding: 0, border: 0 }}>
            <div className="v num">{int(d.raisedShare)}%</div>
            <div className="k">вакансий поднимала в поиске</div>
            <div className="s">в среднем {d.raisesPer.toFixed(1).replace(".", ",")} {plural(Math.round(d.raisesPer), "раз", "раза", "раз")} на вакансию</div>
          </div>
          <div className="kpi" style={{ padding: 0, border: 0 }}>
            <div className="v num">{int(d.counts.salary_up + d.counts.salary_down)}</div>
            <div className="k">раз меняла вилку за 30 дней</div>
            <div className="s">подняла {int(d.counts.salary_up)}, снизила {int(d.counts.salary_down)}</div>
          </div>
        </div>
      </section>

      <section className="block">
        <p className="eyebrow">За последние 30 дней</p>
        <h2>Лента событий</h2>
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 16, fontSize: "0.875rem", color: "var(--ink-2)" }}>
          <input type="checkbox" id="company-raises" checked={showRaises} onChange={(e) => setShowRaises(e.target.checked)} />
          показывать поднятия в поиске
        </label>
        <div style={{ marginTop: 8 }}><Feed events={feed} s={s} showCompany={false} /></div>
      </section>

      <section className="block">
        <p className="eyebrow">Открыто сейчас</p>
        <h2>{nVac(uniqueAds(d.active).length)}</h2>
        <figure>
          <Table head={["Вакансия", "Город", "Зарплата", "Висит"]}
            rows={uniqueAds(d.active).sort((a, b) => firstIx(b) - firstIx(a)).map((v) => {
              const age = ageDays(v, s);
              return [<Link to={`/v/${v.id}`}>{v.t}</Link>, v.city ?? "", v.usd ? usd(v.usd) : "—", age != null ? `${int(age)} дн.` : "—"];
            })} />
        </figure>
      </section>
    </main>
  );
}
