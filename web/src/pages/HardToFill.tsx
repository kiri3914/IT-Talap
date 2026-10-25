import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ScopeBar, scopeColor, useScope, useStore } from "../ctx";
import { ageDays, employerName, estimate, inScope, isActive, uniqueAds } from "../model/store";
import { IN_COUNTRY, int, nVac, pct, plural, usd } from "../model/format";
import { HBars, Table, head, row } from "../charts/kit";

/** Объявление на hh живёт 30 дней. Если вакансия открыта дольше — работодатель
 *  её продлевал или публиковал заново: закрыть не получается. */
const HH_LIFETIME = 30;

export default function HardToFill() {
  const s = useStore();
  const [scope] = useScope();
  const color = scopeColor(scope);

  const d = useMemo(() => {
    const active = uniqueAds(s.vacancies.filter(inScope(scope)).filter((v) => isActive(v, s)));
    const withAge = active.map((v) => ({ v, age: ageDays(v, s), raises: (s.evById.get(v.id) ?? []).filter((e) => e[1] === "raise").length }))
      .filter((x) => x.age != null) as Array<{ v: (typeof active)[0]; age: number; raises: number }>;
    const long = withAge.filter((x) => x.age > HH_LIFETIME);
    const byProf = Object.keys(s.overview.professions).map((p) => {
      const all = withAge.filter((x) => x.v.p === p);
      const l = all.filter((x) => x.age > HH_LIFETIME);
      return { p, n: l.length, total: all.length, share: (100 * l.length) / Math.max(all.length, 1) };
    }).filter((x) => x.total >= 15).sort((a, b) => b.share - a.share);
    const emp = new Map<string, { n: number; total: number }>();
    for (const x of withAge) {
      if (!x.v.emp || s.employers[x.v.emp]?.person) continue;
      const r = emp.get(x.v.emp) ?? { n: 0, total: 0 };
      r.total++;
      if (x.age > HH_LIFETIME) r.n++;
      emp.set(x.v.emp, r);
    }
    return {
      active: withAge.length, long,
      share: (100 * long.length) / Math.max(withAge.length, 1),
      byProf,
      emp: [...emp.entries()].filter(([, r]) => r.n >= 3).sort((a, b) => b[1].n - a[1].n).slice(0, 15),
      oldest: [...long].sort((a, b) => b.age - a.age).slice(0, 40),
    };
  }, [s, scope]);

  return (
    <>
      <ScopeBar />
      <main className="wrap">
        <p className="eyebrow">Трудно закрыть</p>
        <h1 className="page-title">Вакансии, которые висят дольше срока</h1>
        <p className="lede">
          Объявление на hh живёт {HH_LIFETIME} дней. Если вакансия открыта дольше, работодатель её продлевал или публиковал заново — значит, нанять не получается.
          {" "}{IN_COUNTRY[scope][0].toUpperCase() + IN_COUNTRY[scope].slice(1)} таких сейчас <b>{nVac(d.long.length)}</b> — <b>{pct(d.share)}</b> открытых.
          Для кандидата это сильная позиция в переговорах.
        </p>

        <section className="block">
          <p className="eyebrow">Где труднее нанять</p>
          <h2>{d.byProf[0] ? `Дольше всего ищут в роли «${s.overview.professions[d.byProf[0].p]?.title}»` : "По профессиям"}</h2>
          <figure>
            <HBars color={color} label="Доля долгих вакансий по профессиям" labelW={240}
              rows={d.byProf.slice(0, 15).map((x) => ({ key: x.p, label: s.overview.professions[x.p]?.title ?? x.p, value: x.share, display: pct(x.share), href: `/p/${x.p}`,
                tip: () => head(s.overview.professions[x.p]?.title ?? x.p) + row(`Открыты дольше ${HH_LIFETIME} дней`, int(x.n)) + row("Открыто всего", int(x.total)) }))} />
            <figcaption>Доля открытых вакансий профессии, которые висят дольше {HH_LIFETIME} дней с момента создания. Профессии, где открыто меньше 15 вакансий, не показаны.</figcaption>
          </figure>
        </section>

        <section className="block">
          <p className="eyebrow">Компании</p>
          <h2>У кого больше всего долгих вакансий</h2>
          <figure>
            <Table head={["Компания", `Дольше ${HH_LIFETIME} дней`, "Открыто всего"]}
              rows={d.emp.map(([id, r]) => [<Link to={`/c/${id}`}>{employerName(id, s)}</Link>, int(r.n), int(r.total)])} />
            <figcaption>
              Не всякая долгая вакансия — проблема. Крупные компании держат «постоянные» вакансии, чтобы собирать кандидатов впрок. Поэтому список — повод
              спросить на собеседовании, давно ли ищут, а не приговор.
            </figcaption>
          </figure>
        </section>

        <section className="block">
          <p className="eyebrow">Долгожители</p>
          <h2>Дольше всех открыты</h2>
          <figure>
            <Table head={["Вакансия", "Компания", "Висит", "Поднимали", "Зарплата"]}
              rows={d.oldest.map(({ v, age, raises }) => {
                const est = v.usd ? null : estimate(v, s);
                return [<Link to={`/v/${v.id}`}>{v.t}</Link>, employerName(v.emp, s), `${int(age)} дн.`, raises ? `${int(raises)} ${plural(raises, "раз", "раза", "раз")}` : "—",
                  v.usd ? usd(v.usd) : est ? `≈${usd(est.median)}` : "—"];
              })} />
            <figcaption>Возраст — от создания на hh, а не от начала нашего наблюдения: hh хранит исходную дату, даже если вакансию публиковали заново. «≈» — оценка по похожим вакансиям.</figcaption>
          </figure>
        </section>
      </main>
    </>
  );
}
