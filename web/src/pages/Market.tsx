import { useMemo } from "react";
import { ScopeBar, scopeColor, useScope, useStore } from "../ctx";
import { inScope, isActive, uniqueAds } from "../model/store";
import { disclosure, lifetime, salaryBy, shareBy, skillIndex } from "../model/derive";
import { pearson, quartiles } from "../model/stats";
import { IN_COUNTRY, dec1, fmtDay, fmtDayShort, int, kUsd, pct, pct0, usd } from "../model/format";
import { DotRange, HBars, LineDaily, Scatter, Survival, barV, head, row, tipProps, useWidth, Columns } from "../charts/kit";
import type { Country } from "../model/types";

const WD = ["", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const WD_LONG = ["", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];
const WD_ACC = ["", "в понедельник", "во вторник", "в среду", "в четверг", "в пятницу", "в субботу", "в воскресенье"];
const EXP = ["noExperience", "between1And3", "between3And6", "moreThan6"];
const FORMAT: Record<string, string> = { ON_SITE: "В офисе", HYBRID: "Гибрид", REMOTE: "Удалённо", FIELD_WORK: "Разъездная" };

/** Недельный цикл: прирост к предыдущему дню, столбики вверх и вниз от нуля. */
function WeekCycle({ rows, color }: { rows: Array<{ weekday: number; change_pct: number; n: number }>; color: string }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const H = 210, m = { t: 24, b: 28 }, bw = W / 7;
  const amp = Math.max(...rows.map((r) => Math.abs(r.change_pct)), 1);
  const mid = m.t + (H - m.t - m.b) / 2, half = (H - m.t - m.b) / 2 - 14;
  return (
    <div ref={ref} className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Прирост вакансий по дням недели" style={{ ["--c" as string]: color }}>
        <line x1={0} x2={W} y1={mid} y2={mid} className="baseline" />
        {[1, 2, 3, 4, 5, 6, 7].map((wd) => {
          const r = rows.find((x) => x.weekday === wd);
          const x = bw * (wd - 1);
          return (
            <g key={wd} {...(r ? tipProps(() => head(WD_LONG[wd]) + row("Изменение к предыдущему дню", `${r.change_pct >= 0 ? "+" : "−"}${dec1(Math.abs(r.change_pct))}%`) + row("Недель в среднем", int(r.n))) : {})}>
              <rect x={x} y={0} width={bw} height={H} fill="transparent" />
              {r && (
                <>
                  <path d={barV(x + bw * 0.22, mid, mid - (r.change_pct / amp) * half, bw * 0.56)} style={{ fill: "var(--c)" }} />
                  <text x={x + bw / 2} y={r.change_pct >= 0 ? mid - (r.change_pct / amp) * half - 6 : mid - (r.change_pct / amp) * half + 15} textAnchor="middle" className="t-ink num">
                    {r.change_pct >= 0 ? "+" : "−"}{dec1(Math.abs(r.change_pct))}
                  </text>
                </>
              )}
              <text x={x + bw / 2} y={H - 8} textAnchor="middle" className={wd >= 6 ? "" : "t-ink2"}>{WD[wd]}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function Market() {
  const s = useStore();
  const [scope] = useScope();
  const color = scopeColor(scope);
  const ov = s.overview;

  const d = useMemo(() => {
    const list = s.vacancies.filter(inScope(scope));
    const active = list.filter((v) => isActive(v, s));
    const ads = uniqueAds(list);
    const paid = ads.map((v) => v.usd).filter((x): x is number => !!x);
    const byProf = salaryBy(list, (v) => v.p);
    const profRows = Object.keys(ov.professions).flatMap((code) => {
      const q = quartiles(byProf.get(code) ?? []);
      const pl = list.filter((v) => v.p === code);
      return q ? [{ code, q, disclosed: disclosure(pl), active: pl.filter((v) => isActive(v, s)).length }] : [];
    }).sort((a, b) => b.q.median - a.q.median);
    const keys: Country[] = scope === "all" ? ["kz", "uz", "kg"] : [scope];
    const daily = ov.daily.map((x) => {
      const ok = keys.every((k) => x[k]);
      return { ...x, it: ok ? keys.reduce((n, k) => n + x[k]!.it, 0) : null, total: ok ? keys.reduce((n, k) => n + x[k]!.total, 0) : null };
    });
    const start = daily.findIndex((x) => x.it != null);
    return {
      active, salary: quartiles(paid), profRows,
      daily: daily.slice(Math.max(0, start)),
      cities: shareBy(active, (v) => v.city).slice(0, 7),
      byExp: salaryBy(list, (v) => v.e),
      expShare: shareBy(list, (v) => v.e),
      life: lifetime(list, s),
      skills: skillIndex(list).slice(0, 15).map((k) => ({ ...k, share: (100 * k.n) / ads.length })),
      formats: shareBy(active, (v) => v.f),
      disclosed: disclosure(active),
    };
  }, [s, scope, ov]);

  const k = ov.scopes[scope].kpi;
  const wk = ov.weekday[scope];
  const worst = wk.reduce((a, b) => (b.change_pct < a.change_pct ? b : a));
  const best = wk.reduce((a, b) => (b.change_pct > a.change_pct ? b : a));
  const r = d.profRows.length > 3 ? pearson(d.profRows.map((p) => p.disclosed), d.profRows.map((p) => p.q.median)) : 0;
  const tg = ov.telegram.filter((t) => t.country === "kz" && t.currency === "KZT");
  const exA = quartiles(d.byExp.get("between1And3") ?? []), exB = quartiles(d.byExp.get("between3And6") ?? []);

  return (
    <>
      <ScopeBar />
      <main className="wrap">
        <p className="eyebrow">Обзор рынка</p>
        <h1 className="page-title">Рынок IT-вакансий {IN_COUNTRY[scope]}</h1>
        <p className="lede">Наблюдение идёт <b>{int(ov.period.days)} дней</b>, с {fmtDay(ov.period.first)}. За это время мы видели <b>{int(ov.scopes[scope].kpi.unique_seen)}</b> вакансий.</p>
        <div className="kpis">
          <div className="kpi"><div className="v num">{int(d.active.length)}</div><div className="k">открытых IT-вакансий</div></div>
          <div className="kpi"><div className="v num">{dec1(k.it_share_pct)}<small>%</small></div><div className="k">доля IT среди всех вакансий hh</div><div className="s">{int(k.it_now)} из {int(k.total_now)}</div></div>
          <div className="kpi"><div className="v num">{d.salary ? usd(d.salary.median) : "—"}</div><div className="k">медианная зарплата</div><div className="s">{d.salary ? `по ${int(d.salary.n)} вакансиям с вилкой` : ""}</div></div>
          <div className="kpi"><div className="v num">{pct0(d.disclosed)}</div><div className="k">указывают зарплату</div><div className="s">среди открытых</div></div>
        </div>

        <section className="block">
          <p className="eyebrow">Спрос по дням</p>
          <h2>Спрос на IT дышит по неделям</h2>
          <p className="dek">К выходным часть объявлений снимают, в начале недели публикуют заново. Больше всего вакансий пропадает {WD_ACC[worst.weekday]}, появляется — {WD_ACC[best.weekday]}.</p>
          <figure>
            <LineDaily color={color} label="Открытые IT-вакансии по дням"
              points={d.daily.map((x) => ({
                key: x.dt, label: x.dt, value: x.it, weekend: x.weekday >= 6,
                tick: x.weekday === 1 ? fmtDayShort(x.dt) : undefined,
                tip: () => head(`${WD_LONG[x.weekday]}, ${fmtDay(x.dt)}`) + (x.it == null ? row("Сбора не было", "сервер выключен") : row("IT-вакансий", int(x.it)) + row("Всего вакансий", int(x.total!)) + row("Доля IT", pct((100 * x.it) / x.total!))),
              }))} />
            <figcaption>Серые полосы — выходные, штриховка — дни без сбора. Шкала не с нуля, чтобы были видны колебания.</figcaption>
          </figure>
          <div className="two" style={{ marginTop: 28 }}>
            <figure>
              <h3 className="sub">Средний прирост всех вакансий за день, %</h3>
              <div style={{ marginTop: 12 }}><WeekCycle rows={wk} color={color} /></div>
            </figure>
            <figure>
              <h3 className="sub">Где открыты вакансии</h3>
              <div style={{ marginTop: 12 }}>
                <HBars color={color} label="Города" labelW={120} rows={d.cities.filter((c) => c.key).map((c) => ({ key: c.key!, label: c.key!, value: c.n, display: int(c.n) }))} />
              </div>
            </figure>
          </div>
        </section>

        <section className="block">
          <p className="eyebrow">Зарплаты · $ в месяц</p>
          <h2>{d.salary ? `Медианная IT-зарплата — ${usd(d.salary.median)} в месяц` : "Зарплаты"}</h2>
          <figure>
            <DotRange color={color} label="Зарплаты по профессиям" format={kUsd}
              rows={d.profRows.map((p) => ({
                key: p.code, label: ov.professions[p.code].title, tag: ov.professions[p.code].core ? undefined : "смежная", ...p.q, href: `/p/${p.code}`,
                tip: () => head(ov.professions[p.code].title) + row("Медиана", usd(p.q.median)) + row("Половина вакансий", `${usd(p.q.p25)}–${usd(p.q.p75)}`) + row("С зарплатой", int(p.q.n)) + row("Указывают", pct(p.disclosed)),
              }))} />
            <figcaption>Точка — медиана, полоса — от четверти до трёх четвертей вакансий. Нажмите на профессию, чтобы открыть её страницу.</figcaption>
          </figure>
          <figure>
            <h3 className="sub">{r < -0.25 ? "Чем выше зарплата, тем реже её указывают" : "Как часто указывают зарплату"}</h3>
            <p className="subnote">Коэффициент корреляции {dec1(r)}. Медиана по рынку поэтому, скорее всего, занижена.</p>
            <div style={{ marginTop: 12 }}>
              <Scatter color={color} label="Доля вакансий с зарплатой и медиана" xLabel="указывают зарплату →" xFmt={(v) => `${Math.round(v)}%`} yFmt={usd}
                points={d.profRows.map((p) => ({
                  key: p.code, x: p.disclosed, y: p.q.median, label: ov.professions[p.code].title.split(",")[0], href: `/p/${p.code}`,
                  tip: () => head(ov.professions[p.code].title) + row("Указывают зарплату", pct(p.disclosed)) + row("Медиана", usd(p.q.median)),
                }))} />
            </div>
          </figure>
          <div className="two" style={{ marginTop: 28 }}>
            <figure>
              <h3 className="sub">Кого ищут по опыту, доля вакансий</h3>
              <div style={{ marginTop: 12 }}>
                <HBars color={color} label="Опыт" labelW={130} rows={EXP.map((e) => {
                  const x = d.expShare.find((y) => y.key === e);
                  return { key: e, label: ov.experience_labels[e], value: x?.share ?? 0, display: pct(x?.share ?? 0) };
                })} />
              </div>
            </figure>
            <figure>
              <h3 className="sub">{exA && exB ? `От 1–3 к 3–6 годам зарплата растёт на ${int((exB.median / exA.median - 1) * 100)}%` : "Зарплата по опыту"}</h3>
              <div style={{ marginTop: 12 }}>
                <HBars color={color} label="Зарплата по опыту" labelW={130} rows={EXP.flatMap((e) => {
                  const q = quartiles(d.byExp.get(e) ?? []);
                  return q ? [{ key: e, label: ov.experience_labels[e], value: q.median, display: usd(q.median) }] : [];
                })} />
              </div>
            </figure>
          </div>
        </section>

        <section className="block">
          <p className="eyebrow">Срок жизни вакансии</p>
          <h2>{d.life.openAt30 != null ? `${pct0(100 - 100 * d.life.openAt30)} вакансий закрывают раньше, чем их снимет hh` : "Сколько живёт вакансия"}</h2>
          <figure><Survival curve={d.life.curve} color={color} label="Доля открытых вакансий по дням" /></figure>
        </section>

        <section className="block">
          <p className="eyebrow">Навыки и формат</p>
          <h2>{d.skills[0] ? `${d.skills[0].name} — в каждой ${int(100 / d.skills[0].share)}-й вакансии` : "Навыки"}</h2>
          <div className="two" style={{ marginTop: 8 }}>
            <figure>
              <HBars color={color} label="Навыки" labelW={220} rows={d.skills.map((x) => ({ key: x.key, label: x.name, value: x.share, display: pct(x.share), href: `/s/${encodeURIComponent(x.key)}` }))} />
            </figure>
            <figure>
              <h3 className="sub">Формат работы</h3>
              <div style={{ marginTop: 12 }}>
                <HBars color={color} label="Формат" labelW={120} rows={d.formats.filter((f) => f.key).map((f) => ({ key: f.key!, label: FORMAT[f.key!] ?? f.key!, value: f.share, display: pct(f.share) }))} />
              </div>
            </figure>
          </div>
        </section>

        {tg.length > 0 && (
          <section className="block">
            <p className="eyebrow">Десять лет · телеграм-каналы · Казахстан</p>
            <h2>За {tg[tg.length - 1].year - tg[0].year} лет медиана вилки выросла с {int(tg[0].median / 1000)} до {int(tg[tg.length - 1].median / 1000)} тыс. ₸</h2>
            <p className="dek">У hh нет истории, поэтому глубже заглядываем через архив телеграм-каналов. Суммы в тенге без поправки на инфляцию.</p>
            <figure>
              <Columns color="var(--kz)" label="Медиана вилки по годам, тыс. тенге" height={260} format={(v) => int(v / 1000)}
                rows={tg.map((t) => ({ key: String(t.year), label: String(t.year), value: t.median,
                  tip: () => head(String(t.year)) + row("Медиана", `${int(t.median)} ₸`) + row("Половина вакансий", `${int(t.p25 / 1000)}–${int(t.p75 / 1000)} тыс. ₸`) + row("Постов с вилкой", int(t.n)) }))} />
              <figcaption>Каналы @workitkz и @devkz_jobs. Годы, где меньше 30 постов с вилкой, не показаны. Последний год неполный.</figcaption>
            </figure>
          </section>
        )}
      </main>
    </>
  );
}
