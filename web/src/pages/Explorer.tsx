import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useStore } from "../ctx";
import { ageDays, employerName, firstIx, isActive, uniqueAds } from "../model/store";
import { skillKey, windowStart } from "../model/derive";
import { quartiles } from "../model/stats";
import { COUNTRY, cityGroupLabel, int, nVac, pct, usd } from "../model/format";
import { HBars, Table } from "../charts/kit";
import type { Vacancy } from "../model/types";

const EXP = ["noExperience", "between1And3", "between3And6", "moreThan6"];
const FORMAT: Record<string, string> = { ON_SITE: "В офисе", HYBRID: "Гибрид", REMOTE: "Удалённо", FIELD_WORK: "Разъездная" };
const CG = ["Алматы", "Астана", "other_kz", "Ташкент", "other_uz", "Бишкек", "other_kg"];

/** Мультивыбор как ряд переключателей: состояние — список в параметре ссылки. */
function Multi({ name, options, label, params, set }: {
  name: string; options: Array<[string, string]>; label: string; params: URLSearchParams; set: (k: string, v: string[]) => void;
}) {
  const cur = params.get(name)?.split(",").filter(Boolean) ?? [];
  return (
    <div className="field">
      <label>{label}</label>
      <div className="chips">
        {options.map(([v, t]) => {
          const on = cur.includes(v);
          return (
            <button key={v} type="button" className="chip" aria-pressed={on}
              style={{ border: 0, cursor: "pointer", background: on ? "var(--ink)" : undefined, color: on ? "var(--bg)" : undefined }}
              onClick={() => set(name, on ? cur.filter((x) => x !== v) : [...cur, v])}>{t}</button>
          );
        })}
      </div>
    </div>
  );
}

export default function Explorer() {
  const s = useStore();
  const [params, setParams] = useSearchParams();
  const [limit, setLimit] = useState(50);
  const set = (k: string, v: string[] | string) => {
    const next = new URLSearchParams(params);
    const val = Array.isArray(v) ? v.join(",") : v;
    if (val) next.set(k, val); else next.delete(k);
    setParams(next, { replace: true });
    setLimit(50);
  };
  const get = (k: string) => params.get(k)?.split(",").filter(Boolean) ?? [];

  const res = useMemo(() => {
    const c = get("c"), p = get("p"), e = get("e"), f = get("f"), cg = get("cg");
    const status = params.get("status") ?? "active";
    const minUsd = Number(params.get("min")) || 0;
    const days = Number(params.get("days")) || 0;
    const skill = (params.get("skill") ?? "").trim().toLowerCase();
    const paidOnly = params.get("paid") === "1";
    const from = days ? windowStart(s, days) : 0;
    const match = (v: Vacancy) =>
      (!c.length || c.includes(v.c)) && (!p.length || (v.p && p.includes(v.p))) && (!e.length || (v.e && e.includes(v.e))) &&
      (!f.length || (v.f && f.includes(v.f))) && (!cg.length || cg.includes(v.cg)) &&
      (status === "all" || (status === "active" ? isActive(v, s) : !isActive(v, s))) &&
      (!minUsd || (v.usd ?? 0) >= minUsd) && (!paidOnly || !!v.usd) &&
      (!days || (firstIx(v) >= from && firstIx(v) > 0)) &&
      (!skill || v.sk.some((x) => skillKey(x).includes(skill)));
    const list = uniqueAds(s.vacancies.filter(match));
    const byProf = new Map<string, number>();
    for (const v of list) if (v.p) byProf.set(v.p, (byProf.get(v.p) ?? 0) + 1);
    const emp = new Map<string, number>();
    for (const v of list) if (v.emp && !s.employers[v.emp]?.person) emp.set(v.emp, (emp.get(v.emp) ?? 0) + 1);
    return {
      list,
      salary: quartiles(list.map((v) => v.usd).filter((x): x is number => !!x)),
      paidShare: (100 * list.filter((v) => v.usd).length) / Math.max(list.length, 1),
      byProf: [...byProf.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
      emp: [...emp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
    };
  }, [s, params]);

  return (
    <main className="wrap">
      <p className="eyebrow">Конструктор срезов</p>
      <h1 className="page-title">Любой срез рынка</h1>
      <p className="lede">Фильтры сохраняются в ссылке — срез можно отправить коллеге. Клоны одного объявления в разных городах считаются один раз.</p>

      <div style={{ display: "grid", gap: 18, marginTop: 28 }}>
        <Multi name="c" label="Страна" params={params} set={set} options={(["kz", "uz", "kg"] as const).map((x) => [x, COUNTRY[x]])} />
        <Multi name="p" label="Профессия" params={params} set={set}
          options={Object.entries(s.overview.professions).sort((a, b) => a[1].title.localeCompare(b[1].title, "ru")).map(([k, v]) => [k, v.title])} />
        <Multi name="e" label="Опыт" params={params} set={set} options={EXP.map((x) => [x, s.overview.experience_labels[x]])} />
        <Multi name="f" label="Формат" params={params} set={set} options={Object.entries(FORMAT)} />
        <Multi name="cg" label="Город" params={params} set={set} options={CG.map((x) => [x, cityGroupLabel(x)])} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
          <div className="field">
            <label htmlFor="x-status">Статус</label>
            <select id="x-status" value={params.get("status") ?? "active"} onChange={(ev) => set("status", ev.target.value === "active" ? "" : ev.target.value)}>
              <option value="active">открыты сейчас</option><option value="closed">пропали из выдачи</option><option value="all">все</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="x-days">Появились</label>
            <select id="x-days" value={params.get("days") ?? ""} onChange={(ev) => set("days", ev.target.value)}>
              <option value="">когда угодно</option><option value="7">за 7 дней</option><option value="14">за 14 дней</option><option value="30">за 30 дней</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="x-skill">Навык содержит</label>
            <input id="x-skill" value={params.get("skill") ?? ""} onChange={(ev) => set("skill", ev.target.value)} placeholder="python, 1с, figma" />
          </div>
          <div className="field">
            <label htmlFor="x-min">Зарплата от, $</label>
            <input id="x-min" inputMode="numeric" value={params.get("min") ?? ""} onChange={(ev) => set("min", ev.target.value.replace(/\D/g, ""))} placeholder="0" />
          </div>
          <label className="field" style={{ alignContent: "end" }}>
            <span style={{ display: "flex", gap: 8, alignItems: "center", fontSize: "0.9375rem" }}>
              <input type="checkbox" id="x-paid" checked={params.get("paid") === "1"} onChange={(ev) => set("paid", ev.target.checked ? "1" : "")} />
              только с зарплатой
            </span>
          </label>
        </div>
        <div><button type="button" className="btn ghost" onClick={() => setParams(new URLSearchParams(), { replace: true })}>Сбросить фильтры</button></div>
      </div>

      <div className="kpis">
        <div className="kpi"><div className="v num">{int(res.list.length)}</div><div className="k">вакансий в срезе</div></div>
        <div className="kpi"><div className="v num">{res.salary ? usd(res.salary.median) : "—"}</div><div className="k">медианная зарплата</div><div className="s">{res.salary ? `по ${int(res.salary.n)} с вилкой` : "мало вакансий с вилкой"}</div></div>
        <div className="kpi"><div className="v num">{res.salary ? `${usd(res.salary.p25)}–${usd(res.salary.p75)}` : "—"}</div><div className="k">середина распределения</div></div>
        <div className="kpi"><div className="v num">{pct(res.paidShare)}</div><div className="k">указывают зарплату</div></div>
      </div>

      <div className="two" style={{ marginTop: 32 }}>
        <figure>
          <h3 className="sub">По профессиям</h3>
          <div style={{ marginTop: 12 }}>
            <HBars color="var(--all)" label="Профессии в срезе" labelW={230}
              rows={res.byProf.map(([k, n]) => ({ key: k, label: s.overview.professions[k]?.title ?? k, value: n, display: int(n), href: `/p/${k}` }))} />
          </div>
        </figure>
        <figure>
          <h3 className="sub">Компании</h3>
          <div style={{ marginTop: 12 }}>
            <HBars color="var(--all)" label="Компании в срезе" labelW={230}
              rows={res.emp.map(([k, n]) => ({ key: k, label: employerName(k, s), value: n, display: int(n), href: `/c/${k}` }))} />
          </div>
        </figure>
      </div>

      <section className="block">
        <h2>{nVac(res.list.length)}</h2>
        <figure>
          <Table head={["Вакансия", "Компания", "Страна", "Город", "Зарплата", "Возраст"]}
            rows={[...res.list].sort((a, b) => firstIx(b) - firstIx(a)).slice(0, limit).map((v) => {
              const age = ageDays(v, s);
              return [<Link to={`/v/${v.id}`}>{v.t}</Link>, employerName(v.emp, s), COUNTRY[v.c], v.city ?? "", v.usd ? usd(v.usd) : "—", age != null ? `${int(age)} дн.` : "—"];
            })} />
          {res.list.length > limit && <button className="btn ghost" style={{ marginTop: 14 }} onClick={() => setLimit((x) => x + 100)}>Показать ещё</button>}
        </figure>
      </section>
    </main>
  );
}
