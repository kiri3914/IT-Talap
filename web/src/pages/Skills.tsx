import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ScopeBar, useScope, useStore } from "../ctx";
import { inScope, uniqueAds } from "../model/store";
import { skillIndex, skillKey, skillPremium } from "../model/derive";
import { IN_COUNTRY, dec1, int, pct } from "../model/format";
import { Table } from "../charts/kit";

export default function Skills() {
  const s = useStore();
  const [scope] = useScope();
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(60);

  const rows = useMemo(() => {
    const list = s.vacancies.filter(inScope(scope));
    const total = uniqueAds(list).length;
    return skillIndex(list).map((k, i) => {
      // надбавку считаем для первых 150 — дальше выборки малы, а расчёт тяжёлый
      const prem = i < 150 ? skillPremium(k.key, list) : null;
      const roles = new Map<string, number>();
      for (const v of uniqueAds(list)) if (v.p && v.sk.some((x) => skillKey(x) === k.key)) roles.set(v.p, (roles.get(v.p) ?? 0) + 1);
      const top = [...roles.entries()].sort((a, b) => b[1] - a[1])[0];
      return { ...k, share: (100 * k.n) / total, prem, role: top ? s.overview.professions[top[0]]?.title ?? "" : "" };
    });
  }, [s, scope]);

  const t = q.trim().toLowerCase();
  const shown = rows.filter((r) => !t || r.key.includes(t));

  return (
    <>
      <ScopeBar />
      <main className="wrap">
        <p className="eyebrow">Ключевые навыки из вакансий</p>
        <h1 className="page-title">Навыки</h1>
        <p className="lede">
          {int(rows.length)} навыков, которые встречаются хотя бы в 10 вакансиях {IN_COUNTRY[scope]}. Надбавка — насколько медиана зарплаты в вакансиях с навыком выше,
          чем без него, <b>при той же роли и том же опыте</b>. Это связь, а не причина: навык может просто чаще встречаться у компаний, которые платят больше.
        </p>
        <div className="field" style={{ marginTop: 24, maxWidth: 360 }}>
          <label htmlFor="skill-q">Навык</label>
          <input id="skill-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Kubernetes, 1С, Figma…" />
        </div>
        <figure>
          <Table
            head={["Навык", "Вакансий", "Доля", "Надбавка", "Чаще всего в роли"]}
            rows={shown.slice(0, limit).map((r) => [
              <Link to={`/s/${encodeURIComponent(r.key)}`}>{r.name}</Link>,
              int(r.n), pct(r.share),
              r.prem ? <span style={{ color: r.prem.pct >= 0 ? "var(--good)" : "var(--bad)" }}>{r.prem.pct >= 0 ? "+" : "−"}{dec1(Math.abs(r.prem.pct))}%</span> : <span style={{ color: "var(--muted)" }}>мало данных</span>,
              r.role,
            ])}
          />
          {shown.length > limit && <button className="btn ghost" style={{ marginTop: 14 }} onClick={() => setLimit((x) => x + 100)}>Показать ещё</button>}
        </figure>
      </main>
    </>
  );
}
