import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ScopeBar, scopeColor, useScope, useStore } from "../ctx";
import { employerName, inScope, isActive, uniqueAds } from "../model/store";
import { premiumBy } from "../model/derive";
import { COUNTRY, IN_COUNTRY, dec1, int, pct, pct0, usd } from "../model/format";
import { HBars, Table, head, row } from "../charts/kit";
import type { Country, Vacancy } from "../model/types";

const LANGS = ["Английский", "Русский", "Казахский", "Узбекский", "Кыргызский"];
const LEVEL_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"];
const has = (v: Vacancy, lang: string) => v.lg.some((l) => l[0] === lang);

export default function Languages() {
  const s = useStore();
  const [scope] = useScope();
  const color = scopeColor(scope);

  const d = useMemo(() => {
    const list = s.vacancies.filter(inScope(scope));
    const ads = uniqueAds(list);
    const byCountry = (["kz", "uz", "kg"] as Country[]).map((c) => {
      const ca = uniqueAds(s.vacancies.filter((v) => v.c === c));
      return { c, shares: LANGS.map((l) => (100 * ca.filter((v) => has(v, l)).length) / Math.max(ca.length, 1)) };
    });
    const premium = LANGS.map((l) => ({ l, prem: premiumBy((v) => has(v, l), list) }));
    // уровни английского: «B2 — Средне-продвинутый» → «B2»
    const levels = new Map<string, number>();
    for (const v of ads) for (const [name, level] of v.lg) {
      if (name !== "Английский" || !level) continue;
      const code = level.slice(0, 2).toUpperCase();
      levels.set(code, (levels.get(code) ?? 0) + 1);
    }
    const byProf = (lang: string) => Object.keys(s.overview.professions).map((p) => {
      const pa = ads.filter((v) => v.p === p);
      return { p, n: pa.filter((v) => has(v, lang)).length, share: (100 * pa.filter((v) => has(v, lang)).length) / Math.max(pa.length, 1), total: pa.length };
    }).filter((x) => x.total >= 20).sort((a, b) => b.share - a.share);
    const local = scope === "kz" ? "Казахский" : scope === "uz" ? "Узбекский" : scope === "kg" ? "Кыргызский" : "Казахский";
    return {
      ads, byCountry, premium, local,
      english: (100 * ads.filter((v) => has(v, "Английский")).length) / Math.max(ads.length, 1),
      levels: LEVEL_ORDER.map((code) => ({ code, n: levels.get(code) ?? 0 })),
      engProf: byProf("Английский").slice(0, 10),
      localProf: byProf(local).slice(0, 10),
      open: uniqueAds(list.filter((v) => isActive(v, s) && has(v, local))).slice(0, 30),
    };
  }, [s, scope]);

  const eng = d.premium.find((x) => x.l === "Английский")?.prem;
  const levelsTotal = d.levels.reduce((n, x) => n + x.n, 0);

  return (
    <>
      <ScopeBar />
      <main className="wrap">
        <p className="eyebrow">Языки</p>
        <h1 className="page-title">Какой язык нужен в IT {IN_COUNTRY[scope]}</h1>
        <p className="lede">
          Английский требуют в <b>{pct(d.english)}</b> вакансий.
          {eng && <> При той же роли и опыте такие вакансии предлагают на <b>{eng.pct >= 0 ? "" : "−"}{dec1(Math.abs(eng.pct))}%</b> {eng.pct >= 0 ? "больше" : "меньше"}.</>}
          {" "}Требования к языкам работодатель указывает в отдельном поле — его заполняют примерно в трети вакансий, так что доли здесь — нижняя граница.
        </p>

        <section className="block">
          <p className="eyebrow">По странам</p>
          <h2>Доля вакансий, где требуется язык</h2>
          <figure>
            <Table head={["Страна", ...LANGS]} rows={d.byCountry.map((r) => [COUNTRY[r.c], ...r.shares.map((x) => pct(x))])} />
          </figure>
        </section>

        <section className="block">
          <p className="eyebrow">Сколько стоит язык</p>
          <h2>Надбавка при той же роли и опыте</h2>
          <figure>
            <Table head={["Язык", "Надбавка", "Вакансий с языком и зарплатой"]}
              rows={d.premium.map(({ l, prem }) => [l,
                prem ? <span style={{ color: prem.pct >= 0 ? "var(--good)" : "var(--bad)" }}>{prem.pct >= 0 ? "+" : "−"}{dec1(Math.abs(prem.pct))}%</span> : <span style={{ color: "var(--muted)" }}>мало данных</span>,
                prem ? int(prem.nWith) : "—"])} />
            <figcaption>Связь, а не причина: требование английского чаще встречается у международных компаний, которые и так платят больше.</figcaption>
          </figure>
        </section>

        <section className="block">
          <p className="eyebrow">Английский</p>
          <h2>Где нужен и на каком уровне</h2>
          <div className="two" style={{ marginTop: 8 }}>
            <figure>
              <h3 className="sub">Доля вакансий профессии с английским</h3>
              <div style={{ marginTop: 12 }}>
                <HBars color={color} label="Английский по профессиям" labelW={230}
                  rows={d.engProf.map((x) => ({ key: x.p, label: s.overview.professions[x.p]?.title ?? x.p, value: x.share, display: pct(x.share), href: `/p/${x.p}`,
                    tip: () => head(s.overview.professions[x.p]?.title ?? x.p) + row("С английским", int(x.n)) + row("Всего вакансий", int(x.total)) }))} />
              </div>
            </figure>
            <figure>
              <h3 className="sub">Какой уровень просят</h3>
              <div style={{ marginTop: 12 }}>
                <HBars color={color} label="Уровни английского" labelW={60} max={Math.max(1, ...d.levels.map((x) => x.n))}
                  rows={d.levels.map((x) => ({ key: x.code, label: x.code, value: x.n, display: levelsTotal ? pct0((100 * x.n) / levelsTotal) : "—" }))} />
              </div>
            </figure>
          </div>
        </section>

        <section className="block">
          <p className="eyebrow">{d.local}</p>
          <h2>Где нужен {d.local.toLowerCase()} язык</h2>
          <div className="two" style={{ marginTop: 8 }}>
            <figure>
              <HBars color={color} label={`${d.local} по профессиям`} labelW={230}
                rows={d.localProf.filter((x) => x.n > 0).map((x) => ({ key: x.p, label: s.overview.professions[x.p]?.title ?? x.p, value: x.share, display: pct(x.share), href: `/p/${x.p}` }))} />
            </figure>
            <figure>
              <h3 className="sub">Открытые вакансии с этим требованием</h3>
              <Table head={["Вакансия", "Компания", "Зарплата"]}
                rows={d.open.slice(0, 12).map((v) => [<Link to={`/v/${v.id}`}>{v.t}</Link>, employerName(v.emp, s), v.usd ? usd(v.usd) : "—"])} />
              {d.open.length === 0 && <p className="empty">Сейчас таких вакансий нет.</p>}
            </figure>
          </div>
          <p className="subnote" style={{ marginTop: 12 }}>Для «Все страны» показан казахский. Переключите страну, чтобы увидеть узбекский или кыргызский.</p>
        </section>
      </main>
    </>
  );
}
