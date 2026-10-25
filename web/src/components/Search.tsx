import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../ctx";
import { uniqueAds } from "../model/store";
import { nVac } from "../model/format";

interface Item { kind: string; title: string; meta: string; href: string; weight: number }

/** Ссылка на вакансию hh в любом виде: hh.kz/vacancy/123, almaty.hh.kz/vacancy/123?…, просто 123. */
export function parseVacancyId(text: string): string | null {
  const m = text.match(/vacancy\/(\d{5,})/) ?? text.trim().match(/^(\d{6,})$/);
  return m ? m[1] : null;
}

export function Search({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const index = useMemo<Item[]>(() => {
    const items: Item[] = [];
    const byProf = new Map<string, number>();
    for (const v of s.vacancies) if (v.p) byProf.set(v.p, (byProf.get(v.p) ?? 0) + 1);
    for (const [code, p] of Object.entries(s.overview.professions)) {
      items.push({ kind: "профессия", title: p.title, meta: nVac(byProf.get(code) ?? 0), href: `/p/${code}`, weight: 1e6 + (byProf.get(code) ?? 0) });
    }
    for (const [id, list] of s.byEmp) {
      const e = s.employers[id];
      if (!e || e.person) continue;
      const n = uniqueAds(list).length;
      items.push({ kind: "компания", title: e.name, meta: nVac(n), href: `/c/${id}`, weight: n });
    }
    return items;
  }, [s]);

  const vacId = parseVacancyId(q);
  const results = useMemo(() => {
    if (vacId) return [];
    const t = q.trim().toLowerCase();
    if (!t) return index.filter((i) => i.kind === "профессия").sort((a, b) => b.weight - a.weight).slice(0, 8);
    return index
      .map((i) => {
        const name = i.title.toLowerCase();
        const pos = name.indexOf(t);
        return pos < 0 ? null : { ...i, rank: (pos === 0 ? 2e6 : 0) + i.weight };
      })
      .filter((x): x is Item & { rank: number } => x !== null)
      .sort((a, b) => b.rank - a.rank)
      .slice(0, 12);
  }, [q, index, vacId]);

  const go = (href: string) => { onClose(); nav(href); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((x) => Math.min(x + 1, results.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSel((x) => Math.max(x - 1, 0)); }
    if (e.key === "Enter") {
      if (vacId && s.byId.has(vacId)) go(`/v/${vacId}`);
      else if (results[sel]) go(results[sel].href);
    }
  };

  return (
    <div className="palette-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-label="Поиск">
        <input
          ref={input}
          id="search-input"
          value={q}
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={onKey}
          placeholder="Профессия, компания или ссылка на вакансию hh"
          aria-label="Поиск"
        />
        {vacId ? (
          <div className="hint">
            {s.byId.has(vacId)
              ? <a href={`#/v/${vacId}`} onClick={(e) => { e.preventDefault(); go(`/v/${vacId}`); }}>Открыть рентген вакансии {vacId} →</a>
              : <>Вакансии {vacId} нет в наших данных. Мы собираем IT-вакансии Казахстана, Узбекистана и Кыргызстана с 11 сентября 2026 года.</>}
          </div>
        ) : (
          <ul role="listbox">
            {results.map((r, i) => (
              <li key={r.href}>
                <a href={`#${r.href}`} aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={(e) => { e.preventDefault(); go(r.href); }}>
                  <span>{r.title}</span>
                  <span className="subnote" style={{ marginTop: 0 }}>{r.meta}</span>
                  <span className="kind">{r.kind}</span>
                </a>
              </li>
            ))}
            {!results.length && <li className="hint">Ничего не нашлось.</li>}
          </ul>
        )}
        <div className="hint">↑↓ — выбор, Enter — открыть, Esc — закрыть</div>
      </div>
    </div>
  );
}
