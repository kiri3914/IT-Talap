import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ScopeBar, useScope, useStore } from "../ctx";
import { firstIx, inScope, isActive, uniqueAds } from "../model/store";
import { disclosure, windowStart } from "../model/derive";
import { IN_COUNTRY, int, pct0 } from "../model/format";
import { Table } from "../charts/kit";

type SortKey = "active" | "opened" | "total" | "disclosed";

export default function Companies() {
  const s = useStore();
  const [scope] = useScope();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("active");
  const [limit, setLimit] = useState(60);

  const rows = useMemo(() => {
    const from30 = windowStart(s, 30);
    const out = [];
    for (const [id, all] of s.byEmp) {
      const e = s.employers[id];
      if (!e || e.person) continue;
      const list = all.filter(inScope(scope));
      if (!list.length) continue;
      const ads = uniqueAds(list);
      const roles = new Map<string, number>();
      for (const v of ads) if (v.p) roles.set(v.p, (roles.get(v.p) ?? 0) + 1);
      const top = [...roles.entries()].sort((a, b) => b[1] - a[1])[0];
      out.push({
        id, name: e.name,
        active: uniqueAds(list.filter((v) => isActive(v, s))).length,
        opened: ads.filter((v) => firstIx(v) >= from30 && firstIx(v) > 0).length,
        total: ads.length,
        disclosed: disclosure(list),
        role: top ? s.overview.professions[top[0]]?.title ?? "" : "",
      });
    }
    return out;
  }, [s, scope]);

  const t = q.trim().toLowerCase();
  const shown = rows.filter((r) => !t || r.name.toLowerCase().includes(t)).sort((a, b) => b[sort] - a[sort] || b.total - a.total);
  const SortBtn = ({ k, children }: { k: SortKey; children: string }) => (
    <button type="button" id={`sort-${k}`} aria-pressed={sort === k} onClick={() => setSort(k)}>{children}</button>
  );

  return (
    <>
      <ScopeBar />
      <main className="wrap">
        <p className="eyebrow">Работодатели</p>
        <h1 className="page-title">Компании</h1>
        <p className="lede">{int(rows.length)} компаний с IT-вакансиями {IN_COUNTRY[scope]} за время наблюдения. Частные работодатели (ИП) не показаны.</p>
        <div style={{ display: "flex", gap: 14, marginTop: 24, flexWrap: "wrap", alignItems: "center" }}>
          <div className="field" style={{ flex: "1 1 260px" }}>
            <label htmlFor="company-q">Название</label>
            <input id="company-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Kaspi, Beeline, Uzum…" />
          </div>
          <div className="field">
            <label>Сортировка</label>
            <div className="seg"><SortBtn k="active">открыто сейчас</SortBtn><SortBtn k="opened">за 30 дней</SortBtn><SortBtn k="total">всего</SortBtn><SortBtn k="disclosed">с зарплатой</SortBtn></div>
          </div>
        </div>
        <figure>
          <Table
            head={["Компания", "Открыто сейчас", "Открыла за 30 дней", "Всего вакансий", "С зарплатой", "Чаще всего ищет"]}
            rows={shown.slice(0, limit).map((r) => [<Link to={`/c/${r.id}`}>{r.name}</Link>, int(r.active), int(r.opened), int(r.total), pct0(r.disclosed), r.role])}
          />
          {shown.length > limit && <button className="btn ghost" style={{ marginTop: 14 }} onClick={() => setLimit((x) => x + 100)}>Показать ещё</button>}
        </figure>
      </main>
    </>
  );
}
