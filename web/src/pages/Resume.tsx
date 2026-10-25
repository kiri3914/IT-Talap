import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { scopeColor, useStore } from "../ctx";
import { ageDays, employerName, estimate } from "../model/store";
import { premiumBy, skillIndex, skillKey } from "../model/derive";
import { type ParsedResume, SAMPLE_RESUME, matchVacancies, normalizePdf, parseResume, skillGaps } from "../model/resume";
import { COUNTRY, dec1, int, nVac, pct0, usd } from "../model/format";
import { SalaryStrip } from "../charts/kit";
import type { Country } from "../model/types";

const EXP = ["noExperience", "between1And3", "between3And6", "moreThan6"];
const CITY_GROUP: Record<string, { cg: string; c: Country }> = {
  Алматы: { cg: "Алматы", c: "kz" }, Астана: { cg: "Астана", c: "kz" }, Ташкент: { cg: "Ташкент", c: "uz" }, Бишкек: { cg: "Бишкек", c: "kg" },
};

/** PDF → текст прямо в браузере: pdf.js с собственным воркером, сеть не нужна.
 *  Библиотека грузится только когда человек выбрал PDF — она тяжёлая. */
async function pdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" "));
  }
  return normalizePdf(pages.join("\n"));
}

export default function Resume() {
  const s = useStore();
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParsedResume | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [countries, setCountries] = useState<Country[]>(["kz", "uz", "kg"]);
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [addSkill, setAddSkill] = useState("");
  const [limit, setLimit] = useState(20);

  const allSkills = useMemo(() => skillIndex(s.vacancies, 5), [s]);
  const nameOf = useMemo(() => new Map(allSkills.map((k) => [k.key, k.name])), [allSkills]);

  const analyze = (t: string) => {
    setText(t);
    setError(null);
    const p = parseResume(t, s);
    if (!p.skills.length && !p.role) setError("Не нашли в тексте ни навыков, ни должности. Проверьте, что это резюме, или вставьте текст вручную.");
    setParsed(p);
    if (p.cities.some((c) => CITY_GROUP[c])) setCountries([...new Set(p.cities.filter((c) => CITY_GROUP[c]).map((c) => CITY_GROUP[c].c))]);
    setLimit(20);
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      analyze(f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf") ? await pdfText(f) : await f.text());
    } catch {
      setError("Не удалось прочитать файл. Если это скан, в нём нет текста — вставьте резюме текстом.");
    } finally { setBusy(false); }
  };

  const res = useMemo(() => {
    if (!parsed) return null;
    const matches = matchVacancies(parsed, s, { countries, remoteOnly });
    const roleList = s.vacancies.filter((v) => (!parsed.role || v.p === parsed.role) && countries.includes(v.c));
    const gaps = skillGaps(matches).slice(0, 10).map((g) => ({ ...g, prem: premiumBy((v) => v.sk.some((x) => skillKey(x) === g.key), roleList) }));
    const home = parsed.cities.map((c) => CITY_GROUP[c]).find(Boolean) ?? { cg: countries[0] === "uz" ? "Ташкент" : countries[0] === "kg" ? "Бишкек" : "Алматы", c: countries[0] ?? "kz" };
    const worth = parsed.role ? estimate({ p: parsed.role, e: parsed.experience, cg: home.cg, c: home.c, usd: null }, s) : null;
    return { matches, gaps, worth, home };
  }, [parsed, s, countries, remoteOnly]);

  const update = (patch: Partial<ParsedResume>) => parsed && setParsed({ ...parsed, ...patch });
  const color = scopeColor(res?.home.c ?? "all");

  return (
    <main className="wrap">
      <p className="eyebrow">Подбор по резюме</p>
      <h1 className="page-title">Какие вакансии подходят под ваше резюме</h1>
      <p className="lede">
        Загрузите резюме — найдём подходящие открытые вакансии, покажем, сколько стоит ваша роль и каких навыков не хватает.
        <b> Резюме не покидает ваш браузер</b>: разбор идёт на этом устройстве, мы ничего не получаем и не храним.
      </p>

      <div style={{ display: "grid", gap: 14, marginTop: 24 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <label className="btn" htmlFor="resume-file" style={{ cursor: "pointer" }}>{busy ? "Читаем…" : "Загрузить PDF или TXT"}</label>
          <input id="resume-file" type="file" accept=".pdf,.txt,application/pdf,text/plain" hidden onChange={(e) => onFile(e.target.files?.[0])} />
          <button type="button" className="btn ghost" onClick={() => analyze(SAMPLE_RESUME)}>Показать на примере</button>
          <span className="subnote">Скан без текстового слоя не прочитается — тогда вставьте текст ниже.</span>
        </div>
        <div className="field">
          <label htmlFor="resume-text">Или вставьте текст резюме</label>
          <textarea id="resume-text" value={text} onChange={(e) => setText(e.target.value)} rows={6}
            style={{ font: "400 0.9375rem/1.5 var(--font-body)", color: "var(--ink)", background: "var(--panel)", border: "1px solid var(--hair)", borderRadius: 10, padding: "10px 12px", resize: "vertical" }} />
        </div>
        <div><button type="button" className="btn" disabled={!text.trim()} onClick={() => analyze(text)}>Подобрать вакансии</button></div>
        {error && <p className="error">{error}</p>}
      </div>

      {parsed && res && (
        <>
          <section className="block">
            <p className="eyebrow">Что мы поняли из резюме</p>
            <h2>Проверьте и поправьте, если нужно</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginTop: 18 }}>
              <div className="field">
                <label htmlFor="r-role">Роль</label>
                <select id="r-role" value={parsed.role ?? ""} onChange={(e) => update({ role: e.target.value || null })}>
                  <option value="">не определена</option>
                  {Object.entries(s.overview.professions).sort((a, b) => a[1].title.localeCompare(b[1].title, "ru")).map(([k, v]) => <option key={k} value={k}>{v.title}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="r-exp">Опыт{parsed.years != null ? ` (нашли: ${int(parsed.years)} г.)` : ""}</label>
                <select id="r-exp" value={parsed.experience ?? ""} onChange={(e) => update({ experience: e.target.value || null })}>
                  <option value="">не определён</option>
                  {EXP.map((x) => <option key={x} value={x}>{s.overview.experience_labels[x]}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Где искать</label>
                <div className="chips">
                  {(["kz", "uz", "kg"] as Country[]).map((c) => {
                    const on = countries.includes(c);
                    return (
                      <button key={c} type="button" className="chip" aria-pressed={on} onClick={() => setCountries(on ? countries.filter((x) => x !== c) : [...countries, c])}
                        style={{ border: 0, cursor: "pointer", background: on ? "var(--ink)" : undefined, color: on ? "var(--bg)" : undefined }}>{COUNTRY[c]}</button>
                    );
                  })}
                </div>
                <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: "0.875rem", color: "var(--ink-2)", marginTop: 6 }}>
                  <input type="checkbox" id="r-remote" checked={remoteOnly} onChange={(e) => setRemoteOnly(e.target.checked)} /> только удалённо
                </label>
              </div>
            </div>
            <div style={{ marginTop: 18 }}>
              <p className="subnote">Навыки ({int(parsed.skills.length)}) — нажмите, чтобы убрать:</p>
              <div className="chips" style={{ marginTop: 8 }}>
                {parsed.skills.map((k) => (
                  <button key={k} type="button" className="chip" onClick={() => update({ skills: parsed.skills.filter((x) => x !== k) })} style={{ border: 0, cursor: "pointer" }}>
                    {nameOf.get(k) ?? k} ×
                  </button>
                ))}
                <form onSubmit={(e) => {
                  e.preventDefault();
                  const k = skillKey(addSkill);
                  if (k && !parsed.skills.includes(k)) update({ skills: [...parsed.skills, k] });
                  setAddSkill("");
                }} style={{ display: "inline-flex" }}>
                  <input id="r-add-skill" list="skill-list" value={addSkill} onChange={(e) => setAddSkill(e.target.value)} placeholder="+ навык"
                    style={{ font: "400 0.8125rem var(--font-body)", border: "1px dashed var(--axis)", borderRadius: 999, padding: "5px 10px", background: "transparent", color: "var(--ink)", width: 140 }} />
                  <datalist id="skill-list">{allSkills.slice(0, 400).map((k) => <option key={k.key} value={k.name} />)}</datalist>
                </form>
              </div>
              {parsed.english && <p className="subnote" style={{ marginTop: 8 }}>Английский: {parsed.english}</p>}
            </div>
          </section>

          {res.worth && (
            <section className="block">
              <p className="eyebrow">Сколько стоит ваша роль · {res.worth.level}</p>
              <h2>Похожие вакансии предлагают {usd(res.worth.p25)}–{usd(res.worth.p75)} в месяц</h2>
              <p className="dek">Медиана — <b>{usd(res.worth.median)}</b> по {nVac(res.worth.n)} с зарплатой. <Link to="/calc">Уточнить в калькуляторе →</Link></p>
              <figure><SalaryStrip values={res.worth.values} p25={res.worth.p25} median={res.worth.median} p75={res.worth.p75} color={color} format={usd} /></figure>
            </section>
          )}

          <section className="block">
            <p className="eyebrow">Подходящие вакансии</p>
            <h2>{res.matches.length ? `${nVac(res.matches.length)} — лучшие сверху` : "Подходящих открытых вакансий не нашли"}</h2>
            <p className="dek">Совпадение — какую долю требований вакансии закрывают ваши навыки; редкие навыки весят больше частых. Плюс бонус за совпадение роли и опыта.</p>
            <div className="cards">
              {res.matches.slice(0, limit).map((m) => {
                const est = m.v.usd ? null : estimate(m.v, s);
                const age = ageDays(m.v, s);
                return (
                  <Link key={m.v.id} className="card" to={`/v/${m.v.id}`}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <div className="ct">{m.v.t}</div>
                      <span className="tag" style={{ color: "var(--good)", whiteSpace: "nowrap" }}>{pct0(100 * m.score)}</span>
                    </div>
                    <div className="cm">{employerName(m.v.emp, s)} · {m.v.city}{age != null ? ` · ${int(age)} дн.` : ""}</div>
                    <div className="cv num">{m.v.usd ? usd(m.v.usd) : est ? <span>≈{usd(est.median)} <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>оценка</span></span> : <span style={{ fontSize: "0.875rem", color: "var(--muted)" }}>без зарплаты</span>}</div>
                    <div className="chips" style={{ marginTop: 10, gap: 4 }}>
                      {m.matched.slice(0, 6).map((k) => <span key={k} className="chip" style={{ padding: "2px 7px", fontSize: "0.75rem", color: "var(--good)" }}>{nameOf.get(k) ?? k}</span>)}
                      {m.missing.slice(0, 3).map((k) => <span key={k} className="chip" style={{ padding: "2px 7px", fontSize: "0.75rem", opacity: 0.6 }}>нет: {nameOf.get(k) ?? k}</span>)}
                    </div>
                  </Link>
                );
              })}
            </div>
            {res.matches.length > limit && <button className="btn ghost" style={{ marginTop: 14 }} onClick={() => setLimit((x) => x + 20)}>Показать ещё</button>}
          </section>

          {res.gaps.length > 0 && (
            <section className="block">
              <p className="eyebrow">Чего не хватает</p>
              <h2>Навыки, которые чаще всего просят в подходящих вам вакансиях</h2>
              <p className="dek">Вес — насколько часто навык требуют в лучших совпадениях. Надбавка — по вашей роли, при том же опыте; это связь, а не гарантия прибавки.</p>
              <div className="chips" style={{ marginTop: 16 }}>
                {res.gaps.map((g) => (
                  <Link key={g.key} className="chip" to={`/s/${encodeURIComponent(g.key)}`}>
                    {nameOf.get(g.key) ?? g.key}<b>{pct0(g.weight)}</b>
                    {g.prem && <span style={{ color: g.prem.pct >= 0 ? "var(--good)" : "var(--bad)" }}>{g.prem.pct >= 0 ? "+" : "−"}{dec1(Math.abs(g.prem.pct))}%</span>}
                  </Link>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
