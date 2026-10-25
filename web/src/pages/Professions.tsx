import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ScopeBar, scopeColor, useScope, useStore } from "../App";
import { firstIx, inScope, isActive, uniqueAds } from "../model/store";
import { activeByDay, windowStart } from "../model/derive";
import { quartiles } from "../model/stats";
import { IN_COUNTRY, int, usd } from "../model/format";
import { Spark } from "../charts/kit";

const FAMILY: Record<string, string> = {
  development: "Разработка", data: "Аналитика и данные", infrastructure: "Инфраструктура",
  support: "Поддержка", design: "Дизайн", management: "Управление",
};

export default function Professions() {
  const s = useStore();
  const [scope] = useScope();
  const color = scopeColor(scope);
  const rows = useMemo(() => {
    const from30 = windowStart(s, 30);
    return Object.entries(s.overview.professions).map(([code, p]) => {
      const list = s.vacancies.filter((v) => v.p === code).filter(inScope(scope));
      const ads = uniqueAds(list);
      return {
        code, ...p,
        active: list.filter((v) => isActive(v, s)).length,
        opened: ads.filter((v) => firstIx(v) >= from30 && firstIx(v) > 0).length,
        salary: quartiles(ads.map((v) => v.usd).filter((x): x is number => !!x)),
        spark: activeByDay(list, s),
      };
    });
  }, [s, scope]);
  const families = Object.keys(FAMILY);

  return (
    <>
      <ScopeBar />
      <main className="wrap">
        <p className="eyebrow">25 профессий IT-категории hh</p>
        <h1 className="page-title">Профессии</h1>
        <p className="lede">Открытые вакансии {IN_COUNTRY[scope]}, медианная зарплата и динамика за всё время наблюдения. Внутри каждой — лента событий за месяц, стек, компании и срок жизни вакансий.</p>
        {families.map((fam) => {
          const items = rows.filter((r) => r.family === fam).sort((a, b) => b.active - a.active);
          if (!items.length) return null;
          return (
            <section key={fam} className="block" style={{ paddingTop: 40 }}>
              <h2 style={{ fontSize: "1.25rem" }}>{FAMILY[fam]}</h2>
              <div className="cards">
                {items.map((r) => (
                  <Link key={r.code} to={`/p/${r.code}`} className="card">
                    <div className="ct">{r.title}{!r.core && <span className="tag" style={{ marginLeft: 6 }}>смежная</span>}</div>
                    <div className="cm">{int(r.active)} открыто · +{int(r.opened)} за 30 дней</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 12, gap: 12 }}>
                      <div className="cv num" style={{ marginTop: 0 }}>{r.salary ? usd(r.salary.median) : <span style={{ fontSize: "0.875rem", color: "var(--muted)" }}>мало зарплат</span>}</div>
                      <Spark values={r.spark} color={color} />
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </main>
    </>
  );
}
