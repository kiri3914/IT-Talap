import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { scopeColor, useScope, useStore } from "../ctx";
import { ageDays, employerName, estimate, isActive, uniqueAds } from "../model/store";
import { skillIndex, skillKey, skillPremium } from "../model/derive";
import { percentileOf, quartiles } from "../model/stats";
import { COUNTRY, cityGroupLabel, dec1, int, nVac, pct0, usd } from "../model/format";
import { SalaryStrip } from "../charts/kit";
import type { Country } from "../model/types";

const EXP = ["noExperience", "between1And3", "between3And6", "moreThan6"];
const CITIES: Record<Country, string[]> = { kz: ["Алматы", "Астана", "other_kz"], uz: ["Ташкент", "other_uz"], kg: ["Бишкек", "other_kg"] };

function readState() {
  try { return JSON.parse(localStorage.getItem("talap-calc") ?? "{}"); } catch { return {}; }
}

export default function Calculator() {
  const s = useStore();
  const [scope] = useScope();
  const saved = readState();
  const [p, setP] = useState<string>(saved.p ?? "developer");
  const [e, setE] = useState<string>(saved.e ?? "between3And6");
  const startC: Country = saved.c in CITIES ? saved.c : scope === "all" ? "kz" : scope;
  const [c, setC] = useState<Country>(startC);
  const [cg, setCg] = useState<string>(CITIES[startC].includes(saved.cg) ? saved.cg : CITIES[startC][0]);
  const [mine, setMine] = useState<string>(saved.mine ?? "");
  const [picked, setPicked] = useState<string[]>(saved.picked ?? []);
  const persist = (patch: object) => { try { localStorage.setItem("talap-calc", JSON.stringify({ p, e, c, cg, mine, picked, ...patch })); } catch { /* без памяти */ } };

  const mySalary = Number(mine.replace(/\s/g, "")) || null;
  const color = scopeColor(c);

  const d = useMemo(() => {
    const base = estimate({ p, e, c, cg, usd: mySalary }, s);
    const countryList = s.vacancies.filter((v) => v.c === c);
    const pool = uniqueAds(countryList.filter((v) => v.p === p));
    const skills = skillIndex(pool, 5).slice(0, 30);
    // те же роль и опыт в стране — и среди них те, где есть ВСЕ выбранные навыки
    const peers = pool.filter((v) => v.e === e && v.usd);
    const keys = picked.map(skillKey);
    const all = peers.filter((v) => keys.every((k) => v.sk.some((x) => skillKey(x) === k)));
    const any = peers.filter((v) => keys.some((k) => v.sk.some((x) => skillKey(x) === k)));
    const subset = !keys.length ? null : all.length >= 10 ? { kind: "все выбранные навыки", list: all } : any.length >= 10 ? { kind: "хотя бы один из выбранных навыков", list: any } : null;
    const subQ = subset ? quartiles(subset.list.map((v) => v.usd!)) : null;
    const premiums = picked.map((name) => ({ name, prem: skillPremium(skillKey(name), countryList) }));
    const matching = uniqueAds(countryList.filter((v) => v.p === p && v.e === e && isActive(v, s)))
      .map((v) => ({ v, score: keys.filter((k) => v.sk.some((x) => skillKey(x) === k)).length + (v.cg === cg ? 1 : 0) + (v.usd ? 0.5 : 0) }))
      .sort((a, b) => b.score - a.score).slice(0, 8).map((x) => x.v);
    return { base, skills, subset, subQ, premiums, matching, subPct: subset && mySalary ? percentileOf(subset.list.map((v) => v.usd!).sort((a, b) => a - b), mySalary) : null };
  }, [s, p, e, c, cg, mySalary, picked]);

  const toggle = (name: string) => {
    const next = picked.includes(name) ? picked.filter((x) => x !== name) : [...picked, name];
    setPicked(next); persist({ picked: next });
  };

  return (
    <main className="wrap">
      <p className="eyebrow">Калькулятор</p>
      <h1 className="page-title">Сколько стоит ваша роль на рынке</h1>
      <p className="lede">Выберите роль, опыт и город — покажем, сколько предлагают похожие вакансии. Укажите свою зарплату, чтобы увидеть, где вы среди них. Ничего не отправляется на сервер: расчёт идёт прямо в браузере.</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginTop: 28 }}>
        <div className="field">
          <label htmlFor="calc-p">Роль</label>
          <select id="calc-p" value={p} onChange={(ev) => { setP(ev.target.value); setPicked([]); persist({ p: ev.target.value, picked: [] }); }}>
            {Object.entries(s.overview.professions).sort((a, b) => a[1].title.localeCompare(b[1].title, "ru")).map(([code, pr]) => <option key={code} value={code}>{pr.title}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="calc-e">Опыт</label>
          <select id="calc-e" value={e} onChange={(ev) => { setE(ev.target.value); persist({ e: ev.target.value }); }}>
            {EXP.map((x) => <option key={x} value={x}>{s.overview.experience_labels[x]}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="calc-c">Страна</label>
          <select id="calc-c" value={c} onChange={(ev) => { const nc = ev.target.value as Country; setC(nc); setCg(CITIES[nc][0]); persist({ c: nc, cg: CITIES[nc][0] }); }}>
            {(["kz", "uz", "kg"] as Country[]).map((x) => <option key={x} value={x}>{COUNTRY[x]}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="calc-cg">Город</label>
          <select id="calc-cg" value={cg} onChange={(ev) => { setCg(ev.target.value); persist({ cg: ev.target.value }); }}>
            {CITIES[c].map((x) => <option key={x} value={x}>{cityGroupLabel(x)}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="calc-mine">Ваша зарплата, $ в месяц</label>
          <input id="calc-mine" inputMode="numeric" value={mine} onChange={(ev) => { setMine(ev.target.value); persist({ mine: ev.target.value }); }} placeholder="необязательно" />
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <p className="subnote">Навыки — частые в этой роли. Выберите свои:</p>
        <div className="chips" style={{ marginTop: 8 }}>
          {d.skills.map((k) => (
            <button key={k.key} type="button" className="chip" onClick={() => toggle(k.name)}
              style={{ border: 0, cursor: "pointer", background: picked.includes(k.name) ? "var(--ink)" : undefined, color: picked.includes(k.name) ? "var(--bg)" : undefined }}
              aria-pressed={picked.includes(k.name)}>
              {k.name}
            </button>
          ))}
        </div>
      </div>

      <section className="block">
        {d.base ? (
          <>
            <p className="eyebrow">Похожие вакансии · {d.base.level}</p>
            <h2>
              {mySalary && d.base.percentile != null
                ? `Ваша зарплата выше, чем в ${pct0(d.base.percentile)} похожих вакансий`
                : `Половина похожих вакансий предлагает ${usd(d.base.p25)}–${usd(d.base.p75)}`}
            </h2>
            <p className="dek">
              {nVac(d.base.n)} с зарплатой, медиана <b>{usd(d.base.median)}</b>. Это то, что работодатели <b>предлагают</b> в вакансиях, а не то, сколько получают нанятые.
              Зарплату указывают не все: в дорогих ролях реже, поэтому реальный рынок, скорее всего, выше.
            </p>
            <figure><SalaryStrip values={d.base.values} p25={d.base.p25} median={d.base.median} p75={d.base.p75} mark={mySalary} markLabel="вы" color={color} format={usd} /></figure>
          </>
        ) : <p className="dek">Для этой роли мало вакансий с зарплатой — оценивать не по чему.</p>}
      </section>

      {picked.length > 0 && (
        <section className="block">
          <p className="eyebrow">С вашими навыками</p>
          {d.subQ && d.subset ? (
            <>
              <h2>Вакансии, где нужны {d.subset.kind}: медиана {usd(d.subQ.median)}</h2>
              <p className="dek">
                {nVac(d.subQ.n)} той же роли и опыта в стране ({COUNTRY[c]}), половина предлагает <b>{usd(d.subQ.p25)}–{usd(d.subQ.p75)}</b>.
                {d.subPct != null && <> Ваша зарплата выше, чем в <b>{pct0(d.subPct)}</b> из них.</>}
              </p>
            </>
          ) : <h2>С этими навыками мало вакансий с зарплатой, чтобы считать отдельно</h2>}
          <div className="chips" style={{ marginTop: 16 }}>
            {d.premiums.map(({ name, prem }) => (
              <span key={name} className="chip">{name}
                <b style={{ color: prem ? (prem.pct >= 0 ? "var(--good)" : "var(--bad)") : "var(--muted)" }}>
                  {prem ? `${prem.pct >= 0 ? "+" : "−"}${dec1(Math.abs(prem.pct))}%` : "мало данных"}
                </b>
              </span>
            ))}
          </div>
          <p className="subnote" style={{ marginTop: 8 }}>Надбавка каждого навыка при той же роли и опыте — по всей стране. Надбавки не складываются: навыки часто идут вместе.</p>
        </section>
      )}

      {d.matching.length > 0 && (
        <section className="block">
          <p className="eyebrow">Открыто сейчас</p>
          <h2>Вакансии, которые вам подходят</h2>
          <div className="cards">
            {d.matching.map((v) => {
              const age = ageDays(v, s);
              return (
                <Link key={v.id} className="card" to={`/v/${v.id}`}>
                  <div className="ct">{v.t}</div>
                  <div className="cm">{employerName(v.emp, s)} · {v.city}{age != null ? ` · ${int(age)} дн.` : ""}</div>
                  <div className="cv num">{v.usd ? usd(v.usd) : <span style={{ fontSize: "0.875rem", color: "var(--muted)" }}>без зарплаты</span>}</div>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}
