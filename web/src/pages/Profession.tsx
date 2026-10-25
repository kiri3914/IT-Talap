import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ScopeBar, scopeColor, useScope, useStore } from "../ctx";
import { ageDays, employerName, firstIx, inScope, isActive, uniqueAds } from "../model/store";
import {
  countEvents, disclosure, eventsFor, hiringEmployers, languageStats, lifetime, opensByWeek, salaryBy, shareBy, skillStats, windowStart,
} from "../model/derive";
import { quartiles } from "../model/stats";
import { IN_COUNTRY, cityGroupLabel, dec1, fmtDayShort, int, kUsd, nVac, pct, pct0, usd } from "../model/format";
import { Columns, DotRange, HBars, Survival, Table, head, row } from "../charts/kit";
import { Feed } from "../components/Feed";

const EXP_ORDER = ["noExperience", "between1And3", "between3And6", "moreThan6"];
const FORMAT: Record<string, string> = { ON_SITE: "В офисе", HYBRID: "Гибрид", REMOTE: "Удалённо", FIELD_WORK: "Разъездная" };

export default function Profession() {
  const { code = "" } = useParams();
  const s = useStore();
  const [scope] = useScope();
  const [showRaises, setShowRaises] = useState(false);
  const [listLimit, setListLimit] = useState(30);
  const prof = s.overview.professions[code];
  const color = scopeColor(scope);

  const d = useMemo(() => {
    const list = s.vacancies.filter((v) => v.p === code).filter(inScope(scope));
    const ids = new Set(list.map((v) => v.id));
    const from30 = windowStart(s, 30);
    const evs = eventsFor(ids, s, from30);
    const counts = countEvents(evs);
    const active = list.filter((v) => isActive(v, s));
    const paid = uniqueAds(list).map((v) => v.usd).filter((x): x is number => !!x);
    return {
      list, active, evs, counts,
      salary: quartiles(paid),
      weeks: opensByWeek(list, s),
      byExp: salaryBy(list, (v) => v.e),
      byCity: salaryBy(list, (v) => v.cg),
      skills: skillStats(list, s),
      employers: hiringEmployers(list, s, from30),
      life: lifetime(list, s),
      formats: shareBy(active, (v) => v.f),
      langs: languageStats(list),
      disclosed: disclosure(list),
      testShare: (100 * uniqueAds(list).filter((v) => v.test).length) / Math.max(uniqueAds(list).length, 1),
      noExpShare: (100 * uniqueAds(list).filter((v) => v.e === "noExperience").length) / Math.max(uniqueAds(list).length, 1),
    };
  }, [s, code, scope]);

  if (!prof) return <main className="wrap"><h1 className="page-title">Такой профессии нет</h1></main>;

  const feed = showRaises ? d.evs : d.evs.filter((e) => e[1] !== "raise");
  const growing = d.skills.filter((k) => k.delta != null).sort((a, b) => b.delta! - a.delta!);

  return (
    <>
      <ScopeBar />
      <main className="wrap">
        <nav className="crumbs"><Link to="/">Обзор</Link><span>›</span><Link to="/p">Профессии</Link></nav>
        <h1 className="page-title">{prof.title}</h1>
        <p className="lede">
          {IN_COUNTRY[scope][0].toUpperCase() + IN_COUNTRY[scope].slice(1)} сейчас открыто <b>{nVac(d.active.length)}</b>.
          За последние 30 дней открылось <b>{int(d.counts.open)}</b>, пропало из выдачи <b>{int(d.counts.close)}</b>.
          {d.salary && <> Медианная зарплата — <b>{usd(d.salary.median)}</b> в месяц.</>}
          {!prof.core && " Это смежная роль: в IT-категории hh, но много вакансий в ней вне IT."}
        </p>

        <div className="kpis">
          <div className="kpi"><div className="v num">{int(d.active.length)}</div><div className="k">открыто сейчас</div></div>
          <div className="kpi"><div className="v num">+{int(d.counts.open)}</div><div className="k">открылось за 30 дней</div><div className="s">ещё {int(d.counts.return)} вернулись в выдачу</div></div>
          <div className="kpi"><div className="v num">−{int(d.counts.close)}</div><div className="k">пропало за 30 дней</div><div className="s">наняли, сняли или истёк срок</div></div>
          <div className="kpi"><div className="v num">{d.salary ? usd(d.salary.median) : "—"}</div><div className="k">медианная зарплата</div><div className="s">указывают в {pct0(d.disclosed)} вакансий</div></div>
        </div>

        <section className="block">
          <p className="eyebrow">Что произошло за месяц</p>
          <h2>Лента событий</h2>
          <div className="chips" style={{ marginTop: 16 }}>
            <span className="chip">открылось <b>{int(d.counts.open)}</b></span>
            <span className="chip">пропало <b>{int(d.counts.close)}</b></span>
            <span className="chip">подняли вилку <b>{int(d.counts.salary_up)}</b></span>
            <span className="chip">снизили вилку <b>{int(d.counts.salary_down)}</b></span>
            <span className="chip">поднимали в поиске <b>{int(d.counts.raise)}</b></span>
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 16, fontSize: "0.875rem", color: "var(--ink-2)" }}>
            <input type="checkbox" id="show-raises" checked={showRaises} onChange={(e) => setShowRaises(e.target.checked)} />
            показывать поднятия в поиске
          </label>
          <div style={{ marginTop: 8 }}><Feed events={feed} s={s} /></div>
        </section>

        <section className="block">
          <p className="eyebrow">Спрос</p>
          <h2>Новые вакансии по неделям</h2>
          <figure>
            <Columns
              color={color}
              label="Новые вакансии по неделям"
              rows={d.weeks.map((w) => ({
                key: w.week, label: fmtDayShort(w.week), value: w.count, muted: w.partial,
                tip: () => head(`Неделя с ${fmtDayShort(w.week)}${w.partial ? " (неполная)" : ""}`) + row("Новых вакансий", int(w.count)),
              }))}
            />
            <figcaption>Первая неделя наблюдения не показана: всё, что уже висело 11 сентября, выглядело бы новым. Последняя неделя бледнее — она ещё не закончилась.</figcaption>
          </figure>
        </section>

        <section className="block">
          <p className="eyebrow">Зарплаты · $ в месяц</p>
          <h2>{d.salary ? `Половина вакансий платит ${usd(d.salary.p25)}–${usd(d.salary.p75)}` : "Мало вакансий с зарплатой"}</h2>
          <div className="two" style={{ marginTop: 8 }}>
            <figure>
              <h3 className="sub">По опыту</h3>
              <div style={{ marginTop: 12 }}>
                <DotRange
                  color={color} label="Зарплата по опыту" format={kUsd}
                  rows={EXP_ORDER.flatMap((e) => {
                    const q = quartiles(d.byExp.get(e) ?? []);
                    return q ? [{ key: e, label: s.overview.experience_labels[e], ...q, tip: () => head(s.overview.experience_labels[e]) + row("Медиана", usd(q.median)) + row("Половина", `${usd(q.p25)}–${usd(q.p75)}`) + row("Вакансий", int(q.n)) }] : [];
                  })}
                />
              </div>
            </figure>
            <figure>
              <h3 className="sub">По городам</h3>
              <div style={{ marginTop: 12 }}>
                <DotRange
                  color={color} label="Зарплата по городам" format={kUsd}
                  rows={[...d.byCity.entries()].flatMap(([cg, vals]) => {
                    const q = quartiles(vals);
                    return q ? [{ key: cg, label: cityGroupLabel(cg), ...q, tip: () => head(cityGroupLabel(cg)) + row("Медиана", usd(q.median)) + row("Вакансий", int(q.n)) }] : [];
                  }).sort((a, b) => b.median - a.median)}
                />
              </div>
            </figure>
          </div>
        </section>

        <section className="block">
          <p className="eyebrow">Стек</p>
          <h2>{d.skills[0] ? `${d.skills[0].name} — в ${pct0(d.skills[0].share)} вакансий` : "Навыки"}</h2>
          <div className="two" style={{ marginTop: 8 }}>
            <figure>
              <h3 className="sub">Чаще всего</h3>
              <div style={{ marginTop: 12 }}>
                <HBars color={color} label="Самые частые навыки" labelW={200}
                  rows={d.skills.slice(0, 15).map((k) => ({ key: k.key, label: k.name, value: k.share, display: pct(k.share), tip: () => head(k.name) + row("Доля вакансий", pct(k.share)) + row("Вакансий", int(k.n)) }))} />
              </div>
            </figure>
            <figure>
              <h3 className="sub">Что растёт</h3>
              <p className="subnote">Доля в вакансиях последних двух недель против более ранних, п.п.</p>
              {growing.length ? (
                <ul className="feed" style={{ marginTop: 8 }}>
                  {[...growing.slice(0, 5), ...growing.slice(-3).reverse()].filter((k, i, a) => a.findIndex((x) => x.key === k.key) === i).map((k) => (
                    <li key={k.key} className={k.delta! >= 0 ? "m-up" : "m-down"} style={{ gridTemplateColumns: "70px 18px minmax(0,1fr)" }}>
                      <span className="when num">{k.delta! >= 0 ? "+" : "−"}{dec1(Math.abs(k.delta!))}</span>
                      <span className="mark" />
                      <span className="what">{k.name}<span className="meta">{pct(k.olderShare)} → {pct(k.recentShare)}</span></span>
                    </li>
                  ))}
                </ul>
              ) : <p className="empty">Мало новых вакансий, чтобы говорить о росте.</p>}
            </figure>
          </div>
        </section>

        <section className="block">
          <p className="eyebrow">Кто нанимает</p>
          <h2>Компании, открывавшие вакансии за 30 дней</h2>
          <figure>
            <Table
              head={["Компания", "Открыла за 30 дней", "Открыто сейчас", "Всего видели"]}
              rows={d.employers.filter((e) => e.opened || e.active).slice(0, 20).map((e) => [
                <Link to={`/c/${e.emp}`}>{employerName(e.emp, s)}</Link>, int(e.opened), int(e.active), int(e.total),
              ])}
            />
            <figcaption>Частные работодатели (ИП) не показаны: их название — имя человека.</figcaption>
          </figure>
        </section>

        <section className="block">
          <p className="eyebrow">Срок жизни</p>
          <h2>{d.life.openAt30 != null ? `${pct0(100 - 100 * d.life.openAt30)} вакансий закрывают раньше 30 дней` : "Сколько живёт вакансия"}</h2>
          <figure><Survival curve={d.life.curve} color={color} label="Доля открытых вакансий по дням" /></figure>
        </section>

        <section className="block">
          <p className="eyebrow">Портрет вакансии</p>
          <h2>Какой обычно бывает вакансия</h2>
          <div className="three" style={{ marginTop: 20 }}>
            <div>
              <h3 className="sub">Формат</h3>
              <HBars color={color} label="Формат работы" labelW={110} valueW={56}
                rows={d.formats.filter((f) => f.key).map((f) => ({ key: f.key!, label: FORMAT[f.key!] ?? f.key!, value: f.share, display: pct(f.share) }))} />
            </div>
            <div>
              <h3 className="sub">Языки</h3>
              <HBars color={color} label="Требования к языкам" labelW={110} valueW={56}
                rows={d.langs.slice(0, 5).map((l) => ({ key: l.name, label: l.name, value: l.share, display: pct(l.share) }))} />
            </div>
            <div>
              <h3 className="sub">Отбор</h3>
              <HBars color={color} label="Условия отбора" labelW={130} valueW={56} max={100}
                rows={[
                  { key: "noexp", label: "без опыта", value: d.noExpShare, display: pct(d.noExpShare) },
                  { key: "test", label: "тестовое задание", value: d.testShare, display: pct(d.testShare) },
                  { key: "sal", label: "указана зарплата", value: d.disclosed, display: pct(d.disclosed) },
                ]} />
            </div>
          </div>
        </section>

        <section className="block">
          <p className="eyebrow">Открыто сейчас</p>
          <h2>{nVac(d.active.length)}</h2>
          <figure>
            <Table
              head={["Вакансия", "Компания", "Город", "Зарплата", "Висит"]}
              rows={[...d.active].sort((a, b) => firstIx(b) - firstIx(a)).slice(0, listLimit).map((v) => {
                const age = ageDays(v, s);
                return [
                  <Link to={`/v/${v.id}`}>{v.t}</Link>,
                  employerName(v.emp, s), v.city ?? "", v.usd ? usd(v.usd) : "—", age != null ? `${int(age)} дн.` : "—",
                ];
              })}
            />
            {d.active.length > listLimit && (
              <button className="btn ghost" style={{ marginTop: 14 }} onClick={() => setListLimit((x) => x + 50)}>Показать ещё</button>
            )}
          </figure>
        </section>
      </main>
    </>
  );
}
