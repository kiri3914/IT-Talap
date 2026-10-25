import { useMemo, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ScopeBar, useScope, useStore } from "../ctx";
import { type Store, employerName, firstIx, inScope, isActive, uniqueAds } from "../model/store";
import { countEvents, disclosure, eventsFor, languageStats, lifetime, opensByWeek, shareBy, skillStats, windowStart } from "../model/derive";
import { quartiles } from "../model/stats";
import { IN_COUNTRY, fmtDayShort, int, pct0, usd } from "../model/format";
import { Columns, head, row } from "../charts/kit";
import type { Vacancy } from "../model/types";

type Mode = "p" | "c";

function profile(list: Vacancy[], s: Store) {
  const from30 = windowStart(s, 30);
  const ads = uniqueAds(list);
  const counts = countEvents(eventsFor(new Set(list.map((v) => v.id)), s, from30));
  const life = lifetime(list, s);
  const formats = shareBy(list.filter((v) => isActive(v, s)), (v) => v.f);
  const exp = new Map<string, number[]>();
  for (const v of ads) if (v.e && v.usd) (exp.get(v.e) ?? exp.set(v.e, []).get(v.e)!).push(v.usd);
  return {
    active: uniqueAds(list.filter((v) => isActive(v, s))).length,
    opened: ads.filter((v) => firstIx(v) >= from30 && firstIx(v) > 0).length,
    closed: counts.close,
    salary: quartiles(ads.map((v) => v.usd).filter((x): x is number => !!x)),
    byExp: exp,
    disclosed: disclosure(list),
    early: life.openAt30 != null ? 100 - 100 * life.openAt30 : null,
    remote: formats.find((f) => f.key === "REMOTE")?.share ?? 0,
    english: languageStats(list).find((l) => l.name === "Английский")?.share ?? 0,
    noexp: (100 * ads.filter((v) => v.e === "noExperience").length) / Math.max(ads.length, 1),
    skills: skillStats(list, s).slice(0, 12),
    weeks: opensByWeek(list, s),
  };
}

export default function Compare() {
  const s = useStore();
  const [scope] = useScope();
  const [params, setParams] = useSearchParams();
  const mode: Mode = params.get("mode") === "c" ? "c" : "p";
  const picked = (params.get("ids") ?? (mode === "p" ? "devops,developer,qa" : "")).split(",").filter(Boolean).slice(0, 3);
  const setPicked = (ids: string[], m: Mode = mode) => setParams(new URLSearchParams({ mode: m, ids: ids.join(",") }), { replace: true });

  const companyOptions = useMemo(() => [...s.byEmp.entries()]
    .filter(([id]) => s.employers[id] && !s.employers[id].person)
    .map(([id, l]) => ({ id, name: s.employers[id].name, n: uniqueAds(l).length }))
    .filter((x) => x.n >= 5).sort((a, b) => a.name.localeCompare(b.name, "ru")), [s]);

  const cols = useMemo(() => picked.map((id) => {
    const list = (mode === "p" ? s.vacancies.filter((v) => v.p === id) : s.byEmp.get(id) ?? []).filter(inScope(scope));
    const name = mode === "p" ? s.overview.professions[id]?.title ?? id : employerName(id, s);
    return { id, name, href: mode === "p" ? `/p/${id}` : `/c/${id}`, prof: profile(list, s) };
  }), [s, picked, mode, scope]);

  const weekMax = Math.max(1, ...cols.flatMap((c) => c.prof.weeks.map((w) => w.count)));
  const EXP = ["noExperience", "between1And3", "between3And6", "moreThan6"];
  const rows: Array<[string, (p: ReturnType<typeof profile>) => ReactNode]> = [
    ["Открыто сейчас", (p) => int(p.active)],
    ["Открылось за 30 дней", (p) => `+${int(p.opened)}`],
    ["Пропало за 30 дней", (p) => `−${int(p.closed)}`],
    ["Медианная зарплата", (p) => (p.salary ? usd(p.salary.median) : "—")],
    ["Половина вакансий платит", (p) => (p.salary ? `${usd(p.salary.p25)}–${usd(p.salary.p75)}` : "—")],
    ...EXP.map((e): [string, (p: ReturnType<typeof profile>) => ReactNode] => [
      `  опыт ${s.overview.experience_labels[e].toLowerCase()}`,
      (p) => { const q = quartiles(p.byExp.get(e) ?? []); return q ? usd(q.median) : "—"; },
    ]),
    ["Указывают зарплату", (p) => pct0(p.disclosed)],
    ["Закрывают раньше 30 дней", (p) => (p.early != null ? pct0(p.early) : "—")],
    ["Удалённая работа", (p) => pct0(p.remote)],
    ["Нужен английский", (p) => pct0(p.english)],
    ["Берут без опыта", (p) => pct0(p.noexp)],
  ];

  const skillSets = cols.map((c) => new Set(c.prof.skills.map((k) => k.key)));
  const common = cols.length > 1 ? [...skillSets[0]].filter((k) => skillSets.every((set) => set.has(k))) : [];

  return (
    <>
      <ScopeBar />
      <main className="wrap">
        <p className="eyebrow">Сравнение</p>
        <h1 className="page-title">{cols.length ? cols.map((c) => c.name.split(",")[0]).join(" · ") : "Что сравним?"}</h1>
        <p className="lede">До трёх {mode === "p" ? "профессий" : "компаний"} рядом {IN_COUNTRY[scope]}. Ссылку на сравнение можно переслать.</p>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 24, alignItems: "end" }}>
          <div className="field">
            <label>Что сравниваем</label>
            <div className="seg">
              <button type="button" aria-pressed={mode === "p"} onClick={() => setPicked(["devops", "developer", "qa"], "p")}>Профессии</button>
              <button type="button" aria-pressed={mode === "c"} onClick={() => setPicked([], "c")}>Компании</button>
            </div>
          </div>
          {[0, 1, 2].map((i) => (
            <div className="field" key={i} style={{ flex: "1 1 220px" }}>
              <label htmlFor={`cmp-${i}`}>{i + 1}-я</label>
              <select id={`cmp-${i}`} value={picked[i] ?? ""} onChange={(e) => {
                const next = [...picked];
                if (e.target.value) next[i] = e.target.value; else next.splice(i, 1);
                setPicked(next.filter(Boolean));
              }}>
                <option value="">— не выбрано —</option>
                {mode === "p"
                  ? Object.entries(s.overview.professions).sort((a, b) => a[1].title.localeCompare(b[1].title, "ru")).map(([k, v]) => <option key={k} value={k}>{v.title}</option>)
                  : companyOptions.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.n})</option>)}
              </select>
            </div>
          ))}
        </div>

        {cols.length > 0 && (
          <>
            <figure>
              <div className="tablewrap">
                <table className="data">
                  <thead><tr><th />{cols.map((c) => <th key={c.id}><Link to={c.href}>{c.name}</Link></th>)}</tr></thead>
                  <tbody>
                    {rows.map(([label, f]) => (
                      <tr key={label}>
                        <td style={{ color: label.startsWith("  ") ? "var(--muted)" : undefined, paddingLeft: label.startsWith("  ") ? 22 : undefined }}>{label.trim()}</td>
                        {cols.map((c) => <td key={c.id} className="num">{f(c.prof)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </figure>

            <section className="block">
              <p className="eyebrow">Спрос</p>
              <h2>Новые вакансии по неделям</h2>
              <p className="dek">Одна шкала на всех — высоту столбиков можно сравнивать между колонками.</p>
              <div className="three" style={{ marginTop: 20 }}>
                {cols.map((c) => (
                  <figure key={c.id} style={{ margin: 0 }}>
                    <h3 className="sub">{c.name}</h3>
                    <div style={{ marginTop: 10 }}>
                      <Columns color="var(--all)" label={`Новые вакансии: ${c.name}`} height={170} showValues={false} max={weekMax}
                        rows={c.prof.weeks.map((w) => ({ key: w.week, label: fmtDayShort(w.week), value: w.count, muted: w.partial,
                          tip: () => head(`${c.name}, неделя с ${fmtDayShort(w.week)}`) + row("Новых вакансий", int(w.count)) }))}
                      />
                    </div>
                  </figure>
                ))}
              </div>
            </section>

            <section className="block">
              <p className="eyebrow">Стек</p>
              <h2>{common.length ? `Общее: ${common.slice(0, 5).map((k) => cols[0].prof.skills.find((x) => x.key === k)?.name).join(", ")}` : "Навыки"}</h2>
              <div className="three" style={{ marginTop: 20 }}>
                {cols.map((c, i) => (
                  <div key={c.id}>
                    <h3 className="sub">{c.name}</h3>
                    <div className="chips" style={{ marginTop: 10 }}>
                      {c.prof.skills.map((k) => (
                        <Link key={k.key} className="chip" to={`/s/${encodeURIComponent(k.key)}`}
                          style={{ opacity: common.includes(k.key) ? 0.6 : 1, fontWeight: skillSets.filter((set, j) => j !== i && set.has(k.key)).length ? 400 : 600 }}>
                          {k.name}<b>{pct0(k.share)}</b>
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="subnote" style={{ marginTop: 12 }}>Бледные — общие для всех, жирные — встречаются только в этой колонке.</p>
            </section>
          </>
        )}
      </main>
    </>
  );
}
