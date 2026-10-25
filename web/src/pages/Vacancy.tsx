import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { scopeColor, useStore } from "../App";
import { type Store, ageDays, employerName, employerPay, estimate, firstIx, isActive, lastSeenIx, uniqueAds } from "../model/store";
import { disclosure, lifetime, windowStart } from "../model/derive";
import type { Ev, Vacancy as V } from "../model/types";
import { COUNTRY, cityGroupLabel, fmtDay, int, nDays, nVac, pct0, plural, salaryText, usd } from "../model/format";
import { SalaryStrip } from "../charts/kit";
import { eventText } from "../components/Feed";

const FORMAT: Record<string, string> = { ON_SITE: "в офисе", HYBRID: "гибрид", REMOTE: "удалённо", FIELD_WORK: "разъездная работа" };

interface Step { when: string; what: string; note?: string; mark: string }

/** Хронология: создание на hh, наше первое наблюдение, события, итог.
 *  Подряд идущие «подняли в поиске» схлопываются — их бывает по двадцать. */
function timeline(v: V, s: Store): Step[] {
  const steps: Step[] = [];
  const first = s.days[firstIx(v)];
  if (v.created && v.created < first) steps.push({ when: fmtDay(v.created), what: "создана на hh", mark: "var(--axis)" });
  steps.push(firstIx(v) === 0
    ? { when: fmtDay(first), what: "уже была в выдаче", note: "в день, когда начался наш сбор", mark: "var(--axis)" }
    : { when: fmtDay(first), what: "появилась в выдаче", mark: "var(--good)" });
  const evs = (s.evById.get(v.id) ?? []).filter((e) => e[1] !== "open").sort((a, b) => a[0] - b[0]);
  let raises: Ev[] = [];
  const flush = () => {
    if (!raises.length) return;
    const a = s.days[raises[0][0]], b = s.days[raises[raises.length - 1][0]];
    steps.push(raises.length === 1
      ? { when: fmtDay(a), what: "поднята в поиске", mark: "var(--axis)" }
      : { when: `${fmtDay(a)} – ${fmtDay(b)}`, what: `поднимали в поиске ${raises.length} ${plural(raises.length, "раз", "раза", "раз")}`, mark: "var(--axis)" });
    raises = [];
  };
  for (const e of evs) {
    if (e[1] === "raise") { raises.push(e); continue; }
    flush();
    const mark = e[1] === "close" ? "var(--muted)" : e[1].includes("down") || e[1] === "salary_drop" ? "var(--bad)" : "var(--good)";
    steps.push({ when: fmtDay(s.days[Math.min(e[0], s.lastIx)]), what: eventText(e), mark });
  }
  flush();
  if (isActive(v, s)) steps.push({ when: fmtDay(s.days[s.lastIx]), what: "открыта сейчас", mark: "var(--ink)" });
  return steps;
}

export default function Vacancy() {
  const { id = "" } = useParams();
  const s = useStore();
  const v = s.byId.get(id);
  const data = useMemo(() => (v ? compute(v, s) : null), [v, s]);

  if (!v || !data) {
    return (
      <main className="wrap">
        <p className="eyebrow">Рентген вакансии</p>
        <h1 className="page-title">Вакансии {id} нет в наших данных</h1>
        <p className="lede">Мы собираем IT-вакансии Казахстана, Узбекистана и Кыргызстана с hh, начиная с 11 сентября 2026 года.</p>
      </main>
    );
  }
  const { est, own, age, peersOpenAtAge, company, similar, steps, raises, salaryChanges } = data;
  const color = scopeColor(v.c);
  const prof = v.p ? s.overview.professions[v.p] : null;
  const exp = v.e ? s.overview.experience_labels[v.e] : null;
  const active = isActive(v, s);
  const relocation = v.wcity && v.city && v.wcity !== v.city;

  return (
    <main className="wrap">
      <nav className="crumbs" aria-label="Навигация">
        <Link to="/">Обзор</Link><span>›</span>
        {prof && <><Link to={`/p/${v.p}`}>{prof.title}</Link><span>›</span></>}
        <span>Рентген вакансии</span>
      </nav>
      <h1 className="page-title" style={{ maxWidth: "28ch" }}>{v.t}</h1>
      <p className="lede">
        {v.emp && !s.employers[v.emp]?.person ? <Link to={`/c/${v.emp}`}>{employerName(v.emp, s)}</Link> : employerName(v.emp, s)}
        {" · "}{v.city}{relocation ? ` (работа в: ${v.wcity})` : ""}
        {exp ? ` · опыт ${exp.toLowerCase()}` : ""}{v.f ? ` · ${FORMAT[v.f] ?? v.f}` : ""}
      </p>
      <div style={{ display: "flex", gap: 10, marginTop: 20, flexWrap: "wrap", alignItems: "center" }}>
        <a className="btn" href={v.url} target="_blank" rel="noreferrer">Открыть на hh →</a>
        <span className="chip" style={{ ["--c" as string]: color }}>
          <i className="dot" />{active ? "открыта" : `пропала из выдачи ${fmtDay(s.days[Math.min(lastSeenIx(v) + 1, s.lastIx)])}`}
        </span>
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="v num">{v.sal && (v.sal[0] || v.sal[1]) ? (v.usd ? usd(v.usd) : "—") : est ? `≈${usd(est.median)}` : "—"}</div>
          <div className="k">{v.sal && (v.sal[0] || v.sal[1]) ? salaryText(v.sal[0], v.sal[1], v.sal[2]) : "зарплата не указана"}</div>
          <div className="s">{v.sal && (v.sal[0] || v.sal[1]) ? (v.sal[3] === false ? "на руки" : v.sal[3] ? "до вычета налогов" : "в месяц") : est ? "оценка по похожим" : "мало похожих для оценки"}</div>
        </div>
        <div className="kpi">
          <div className="v num">{age != null ? int(age) : "—"}<small>{age != null ? plural(age, "день", "дня", "дней") : ""}</small></div>
          <div className="k">{active ? "висит с момента создания" : "провисела в выдаче"}</div>
          <div className="s">{peersOpenAtAge != null ? `в этом возрасте открыты ещё ${pct0(peersOpenAtAge)} похожих` : " "}</div>
        </div>
        <div className="kpi">
          <div className="v num">{int(raises)}</div>
          <div className="k">{plural(raises, "раз поднимали", "раза поднимали", "раз поднимали")} в поиске</div>
          <div className="s">пока мы наблюдаем</div>
        </div>
        <div className="kpi">
          <div className="v num">{int(salaryChanges)}</div>
          <div className="k">{plural(salaryChanges, "раз меняли", "раза меняли", "раз меняли")} зарплату</div>
          <div className="s">вилку или её наличие</div>
        </div>
      </div>

      <section className="block">
        <p className="eyebrow">Зарплата среди похожих</p>
        {est ? (
          <>
            <h2>
              {v.usd && est.percentile != null
                ? `Выше, чем у ${pct0(est.percentile)} похожих вакансий`
                : `Похожие вакансии платят ${usd(est.p25)}–${usd(est.p75)} в месяц`}
            </h2>
            <p className="dek">
              Похожие — {est.level}: {prof?.title ?? "роль"}{exp && est.withExperience ? `, опыт ${exp.toLowerCase()}` : ""},{" "}
              {est.levelIx === 0 ? cityGroupLabel(v.cg) : est.levelIx <= 2 ? COUNTRY[v.c] : "Казахстан, Узбекистан и Кыргызстан в долларах"}. В группе {nVac(est.n)} с зарплатой,
              половина из них платит от <b>{usd(est.p25)}</b> до <b>{usd(est.p75)}</b>, медиана <b>{usd(est.median)}</b>.
              {!v.usd && " Это оценка: на проверке она ошибается в среднем на 28%, а для вакансий без вилки, скорее всего, занижена — дорогие роли скрывают зарплату чаще."}
            </p>
            <figure><SalaryStrip values={est.values} p25={est.p25} median={est.median} p75={est.p75} mark={v.usd} color={color} format={usd} /></figure>
            {own && (
              <p className="dek" style={{ marginTop: 18 }}>
                Сама компания в этой роли обычно предлагает около <b>{usd(own.median)}</b> — по {nVac(own.n)} с зарплатой.
              </p>
            )}
          </>
        ) : (
          <p className="dek">Похожих вакансий с зарплатой меньше 10 — оценивать не по чему.</p>
        )}
      </section>

      <section className="block">
        <p className="eyebrow">Хронология</p>
        <h2>Что происходило с вакансией</h2>
        <ul className="timeline">
          {steps.map((st, i) => (
            <li key={i} style={{ ["--m" as string]: st.mark }}>
              <div className="when">{st.when}</div>
              <div className="what">{st.what}{st.note && <small> — {st.note}</small>}</div>
            </li>
          ))}
        </ul>
        <p className="subnote" style={{ marginTop: 6 }}>«Пропала из выдачи» не значит «наняли»: вакансию могли закрыть, или hh снял её сам через 30 дней.</p>
      </section>

      <section className="block">
        <p className="eyebrow">Требования</p>
        <h2>Что просят</h2>
        <div className="two" style={{ marginTop: 20 }}>
          <div>
            <h3 className="sub">Навыки</h3>
            <div className="chips" style={{ marginTop: 10 }}>
              {v.sk.length ? v.sk.map((k) => <span className="chip" key={k}>{k}</span>) : <span className="subnote">работодатель не указал</span>}
              {v.soft.map((k) => <span className="chip" key={k} style={{ opacity: 0.7 }}>{k}</span>)}
            </div>
          </div>
          <div>
            <h3 className="sub">Условия отклика</h3>
            <ul style={{ margin: "10px 0 0", paddingLeft: 18, color: "var(--ink-2)" }}>
              {v.lg.length > 0 && <li>Языки: {v.lg.map(([n, l]) => (l ? `${n} (${l.toLowerCase()})` : n)).join(", ")}</li>}
              <li>{v.test ? "Есть тестовое задание" : "Без тестового задания"}</li>
              <li>{v.letter ? "Сопроводительное письмо обязательно" : "Сопроводительное письмо не обязательно"}</li>
              {v.intern && <li>Стажировка</li>}
            </ul>
          </div>
        </div>
        <p className="subnote" style={{ marginTop: 16 }}>Полный текст вакансии — на hh. Мы его не воспроизводим.</p>
      </section>

      {company && (
        <section className="block">
          <p className="eyebrow">Компания</p>
          <h2>{employerName(v.emp, s)}</h2>
          <p className="dek">
            Сейчас открыто <b>{nVac(company.active)}</b>, за последние 30 дней открыто <b>{int(company.opened30)}</b>.
            Зарплату указывает в <b>{pct0(company.disclosed)}</b> вакансий. {v.emp && !s.employers[v.emp]?.person && <Link to={`/c/${v.emp}`}>Всё о том, как нанимает компания →</Link>}
          </p>
          {company.others.length > 0 && (
            <div className="cards">
              {company.others.map((o) => <VacCard key={o.id} v={o} s={s} />)}
            </div>
          )}
        </section>
      )}

      {similar.length > 0 && (
        <section className="block">
          <p className="eyebrow">Похожие вакансии</p>
          <h2>Открыто сейчас в той же роли</h2>
          <div className="cards">{similar.map((o) => <VacCard key={o.id} v={o} s={s} showCompany />)}</div>
        </section>
      )}
    </main>
  );
}

function VacCard({ v, s, showCompany = false }: { v: V; s: Store; showCompany?: boolean }) {
  const age = ageDays(v, s);
  return (
    <Link className="card" to={`/v/${v.id}`}>
      <div className="ct">{v.t}</div>
      <div className="cm">{showCompany ? `${employerName(v.emp, s)} · ` : ""}{v.city}{age != null ? ` · ${nDays(age)}` : ""}</div>
      <div className="cv num">{v.usd ? usd(v.usd) : <span style={{ color: "var(--muted)", fontSize: "0.9rem" }}>без зарплаты</span>}</div>
    </Link>
  );
}

function compute(v: V, s: Store) {
  const est = estimate(v, s);
  const own = employerPay(v, s);
  const age = ageDays(v, s);
  const peers = s.vacancies.filter((x) => x.p === v.p && x.c === v.c);
  const km = lifetime(peers, s);
  const point = age != null ? [...km.curve].reverse().find((p) => p.day <= age) : null;
  const peersOpenAtAge = point && age != null && age <= 90 ? 100 * point.open : null;
  const evs = s.evById.get(v.id) ?? [];
  const raises = evs.filter((e) => e[1] === "raise").length;
  const salaryChanges = evs.filter((e) => e[1].startsWith("salary")).length;

  let company = null;
  if (v.emp) {
    const list = s.byEmp.get(v.emp) ?? [];
    const from30 = windowStart(s, 30);
    const activeList = uniqueAds(list.filter((x) => isActive(x, s)));
    company = {
      active: activeList.length,
      opened30: uniqueAds(list).filter((x) => firstIx(x) >= from30 && firstIx(x) > 0).length,
      disclosed: disclosure(list),
      others: activeList.filter((x) => x.ad !== v.ad).slice(0, 6),
    };
  }
  const mySkills = new Set(v.sk.map((k) => k.toLowerCase()));
  const similar = uniqueAds(s.vacancies.filter((x) => x.p === v.p && x.c === v.c && x.ad !== v.ad && x.emp !== v.emp && isActive(x, s)))
    .map((x) => ({ x, score: (x.e === v.e ? 3 : 0) + (x.cg === v.cg ? 2 : 0) + x.sk.filter((k) => mySkills.has(k.toLowerCase())).length }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((r) => r.x);
  return { est, own, age, peersOpenAtAge, company, similar, steps: timeline(v, s), raises, salaryChanges };
}
