import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { scopeColor, useStore } from "../ctx";
import { employerName, isActive, uniqueAds } from "../model/store";
import { quantile } from "../model/stats";
import { int, nVac, usd } from "../model/format";
import { Table, head, row, tipProps, useWidth } from "../charts/kit";
import type { Country, Vacancy } from "../model/types";

const CITIES: Array<{ name: string; c: Country }> = [
  { name: "Алматы", c: "kz" }, { name: "Астана", c: "kz" }, { name: "Ташкент", c: "uz" }, { name: "Бишкек", c: "kg" },
];
const FAMILY: Record<string, string> = {
  "": "Все профессии", development: "Разработка", data: "Аналитика и данные", infrastructure: "Инфраструктура",
  support: "Поддержка", design: "Дизайн", management: "Управление",
};

const RADIUS_KM = 25;
function km(a: [number, number], b: [number, number]) {
  const r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/** Карта плотности без подложки. Берём точки в радиусе 25 км от центра города:
 *  у части «алматинских» вакансий адрес в Астане, и рамка по процентилям
 *  растягивалась на сотни километров. */
function DensityMap({ points: all, color, selected, onPick }: {
  points: Vacancy[]; color: string; selected: string | null; onPick: (cell: string, items: Vacancy[]) => void;
}) {
  const [ref, W] = useWidth<HTMLDivElement>();
  if (all.length < 5) return <div ref={ref} className="empty">Мало вакансий с адресом.</div>;
  const cLat = quantile(all.map((p) => p.lat!).sort((a, b) => a - b), 0.5);
  const cLng = quantile(all.map((p) => p.lng!).sort((a, b) => a - b), 0.5);
  const points = all.filter((p) => km([p.lat!, p.lng!], [cLat, cLng]) <= RADIUS_KM);
  const outside = all.length - points.length;
  const lats = points.map((p) => p.lat!).sort((a, b) => a - b), lngs = points.map((p) => p.lng!).sort((a, b) => a - b);
  const la0 = quantile(lats, 0.01), la1 = quantile(lats, 0.99), lo0 = quantile(lngs, 0.01), lo1 = quantile(lngs, 0.99);
  const k = Math.cos(((la0 + la1) / 2) * Math.PI / 180);
  const spanX = (lo1 - lo0) * k || 0.01, spanY = la1 - la0 || 0.01;
  const H = Math.min(620, Math.max(320, (W * spanY) / spanX));
  const cell = Math.max(14, Math.round(W / 34));
  const X = (lng: number) => ((lng - lo0) * k / spanX) * (W - 20) + 10;
  const Y = (lat: number) => H - 10 - ((lat - la0) / spanY) * (H - 20);
  const cells = new Map<string, Vacancy[]>();
  for (const p of points) {
    if (p.lat! < la0 || p.lat! > la1 || p.lng! < lo0 || p.lng! > lo1) continue;
    const key = `${Math.floor(X(p.lng!) / cell)}:${Math.floor(Y(p.lat!) / cell)}`;
    (cells.get(key) ?? cells.set(key, []).get(key)!).push(p);
  }
  const max = Math.max(...[...cells.values()].map((v) => v.length));
  const top = [...cells.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 3).map(([key]) => key);
  return (
    <div ref={ref} className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Карта плотности вакансий" style={{ ["--c" as string]: color }}>
        <rect x={0} y={0} width={W} height={H} rx={12} style={{ fill: "var(--wash)" }} />
        {[...cells.entries()].map(([key, items]) => {
          const [cx, cy] = key.split(":").map(Number);
          const op = 0.15 + 0.85 * Math.sqrt(items.length / max);
          return (
            <g key={key} {...tipProps(() => head(`${nVac(items.length)} здесь`) + row("Например", items[0].t.slice(0, 40)) + row("", "нажмите, чтобы увидеть все"))}
              onClick={() => onPick(key, items)} style={{ cursor: "pointer" }}>
              <rect x={cx * cell + 1} y={cy * cell + 1} width={cell - 2} height={cell - 2} rx={3}
                style={{ fill: "var(--c)", opacity: op, stroke: selected === key ? "var(--ink)" : "none", strokeWidth: 2 }} />
              {top.includes(key) && <text x={cx * cell + cell / 2} y={cy * cell + cell / 2 + 4} textAnchor="middle" className="t-strong" style={{ fontSize: 11 }}>{items.length}</text>}
            </g>
          );
        })}
      </svg>
      {outside > 0 && <p className="subnote" style={{ marginTop: 8 }}>Не показано {int(outside)} — адрес дальше {RADIUS_KM} км от центра города.</p>}
    </div>
  );
}

export default function MapPage() {
  const s = useStore();
  const [city, setCity] = useState(CITIES[0].name);
  const [family, setFamily] = useState("");
  const [picked, setPicked] = useState<{ cell: string; items: Vacancy[] } | null>(null);
  const meta = CITIES.find((c) => c.name === city)!;

  const points = useMemo(() => uniqueAds(s.vacancies.filter((v) =>
    v.city === city && isActive(v, s) && v.lat != null && v.lng != null &&
    (!family || (v.p && s.overview.professions[v.p]?.family === family)))), [s, city, family]);

  return (
    <main className="wrap">
      <p className="eyebrow">Карта</p>
      <h1 className="page-title">Где в городе открыты IT-вакансии</h1>
      <p className="lede">Каждая клетка — участок города, чем темнее, тем больше открытых вакансий с этим адресом. Подложки нет: мы не подключаем сторонние картографические сервисы. Нажмите на клетку, чтобы увидеть вакансии.</p>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 24, alignItems: "end" }}>
        <div className="field">
          <label>Город</label>
          <div className="seg">
            {CITIES.map((c) => (
              <button key={c.name} type="button" aria-pressed={c.name === city} onClick={() => { setCity(c.name); setPicked(null); }}>
                <i className="dot" style={{ ["--c" as string]: scopeColor(c.c) }} />{c.name}
              </button>
            ))}
          </div>
        </div>
        <div className="field" style={{ minWidth: 220 }}>
          <label htmlFor="map-family">Направление</label>
          <select id="map-family" value={family} onChange={(e) => { setFamily(e.target.value); setPicked(null); }}>
            {Object.entries(FAMILY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <span className="subnote">{nVac(points.length)} с адресом</span>
      </div>
      <figure>
        <DensityMap points={points} color={scopeColor(meta.c)} selected={picked?.cell ?? null} onPick={(cell, items) => setPicked({ cell, items })} />
        <figcaption>Север сверху. Адрес указывают не все работодатели, а некоторые пишут адрес головного офиса.</figcaption>
      </figure>
      {picked && (
        <section className="block">
          <h2>{nVac(picked.items.length)} в выбранной клетке</h2>
          <figure>
            <Table head={["Вакансия", "Компания", "Зарплата"]}
              rows={picked.items.map((v) => [<Link to={`/v/${v.id}`}>{v.t}</Link>, employerName(v.emp, s), v.usd ? usd(v.usd) : "—"])} />
          </figure>
          <p className="subnote">Всего в клетке {int(picked.items.length)}.</p>
        </section>
      )}
    </main>
  );
}
