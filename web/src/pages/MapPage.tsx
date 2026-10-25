import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { scopeColor, useStore } from "../ctx";
import { employerName, isActive, uniqueAds } from "../model/store";
import { quantile } from "../model/stats";
import { int, nVac, usd } from "../model/format";
import { Table } from "../charts/kit";
import type { Country, Vacancy } from "../model/types";

const CITIES: Array<{ name: string; c: Country }> = [
  { name: "Алматы", c: "kz" }, { name: "Астана", c: "kz" }, { name: "Ташкент", c: "uz" }, { name: "Бишкек", c: "kg" },
];
const FAMILY: Record<string, string> = {
  "": "Все профессии", development: "Разработка", data: "Аналитика и данные", infrastructure: "Инфраструктура",
  support: "Поддержка", design: "Дизайн", management: "Управление",
};
const RADIUS_KM = 25;
/** Шаг сетки ~150 м: вакансии одного здания и соседних домов — один кружок. */
const CELL_DEG = 0.0015;

// Подложка: стандартные тайлы OpenStreetMap. В тёмной теме они инвертируются
// фильтром (класс map-dark в styles.css) — отдельного тёмного сервера без ключа нет:
// CARTO с 2026 года требует ключ API.
// ТОЛЬКО ДЛЯ ВНУТРЕННЕЙ ВЕРСИИ: правила tile.openstreetmap.org запрещают
// заметный трафик. Перед публикацией — собственные тайлы (Protomaps, PMTiles:
// один файл рядом с сайтом, без внешних запросов).
const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">участники OpenStreetMap</a>';

function isDark() {
  const t = document.documentElement.dataset.theme;
  if (t === "dark") return true;
  if (t === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function km(a: [number, number], b: [number, number]) {
  const r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

interface Cell { key: string; lat: number; lng: number; items: Vacancy[] }

/** Точки в радиусе 25 км от центра города: у части «алматинских» вакансий адрес
 *  в Астане, и без этого карта показывала бы полстраны. */
function cellsFor(points: Vacancy[]): { cells: Cell[]; outside: number } {
  if (!points.length) return { cells: [], outside: 0 };
  const c: [number, number] = [
    quantile(points.map((p) => p.lat!).sort((a, b) => a - b), 0.5),
    quantile(points.map((p) => p.lng!).sort((a, b) => a - b), 0.5),
  ];
  const inside = points.filter((p) => km([p.lat!, p.lng!], c) <= RADIUS_KM);
  const m = new Map<string, Cell>();
  for (const p of inside) {
    const key = `${Math.round(p.lat! / CELL_DEG)}:${Math.round(p.lng! / CELL_DEG)}`;
    const cell = m.get(key) ?? { key, lat: 0, lng: 0, items: [] };
    cell.items.push(p);
    m.set(key, cell);
  }
  for (const cell of m.values()) {
    cell.lat = cell.items.reduce((s, p) => s + p.lat!, 0) / cell.items.length;
    cell.lng = cell.items.reduce((s, p) => s + p.lng!, 0) / cell.items.length;
  }
  return { cells: [...m.values()], outside: points.length - inside.length };
}

function LeafletMap({ cells, colorVar, selected, onPick }: {
  cells: Cell[]; colorVar: string; selected: string | null; onPick: (cell: Cell) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const tiles = useRef<L.TileLayer | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);

  // карта создаётся один раз; подложка переключается вместе с темой
  useEffect(() => {
    if (!box.current) return;
    const m = L.map(box.current, { scrollWheelZoom: false, attributionControl: true });
    tiles.current = L.tileLayer(TILES, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    const sync = () => box.current?.classList.toggle("map-dark", isDark());
    sync();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", sync);
    const mo = new MutationObserver(sync);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => { mq.removeEventListener("change", sync); mo.disconnect(); m.remove(); map.current = null; };
  }, []);

  // кружки: размер — число вакансий в точке
  useEffect(() => {
    const m = map.current, g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    // Leaflet пишет цвет в атрибуты SVG, а там CSS-переменные не работают —
    // берём вычисленное значение
    const color = getComputedStyle(document.documentElement).getPropertyValue(colorVar.replace(/var\((.*)\)/, "$1")).trim() || "#2a78d6";
    const max = Math.max(1, ...cells.map((c) => c.items.length));
    for (const c of cells) {
      const n = c.items.length;
      L.circleMarker([c.lat, c.lng], {
        radius: 3 + 11 * Math.sqrt(n / max),
        // тонкая обводка цветом фона разделяет соседние кружки
        color: c.key === selected ? (isDark() ? "#fff" : "#000") : (isDark() ? "#0d1319" : "#ffffff"),
        weight: c.key === selected ? 3 : 1,
        fillColor: color,
        fillOpacity: 0.7,
      })
        .bindTooltip(`${nVac(n)}${n === 1 ? `: ${c.items[0].t}` : ""}`, { direction: "top" })
        .on("click", () => onPick(c))
        .addTo(g);
    }
  }, [cells, colorVar, selected, onPick]);

  // кадрирование — по основной массе вакансий (5–95-й процентили), иначе
  // одиночные дальние адреса уводят масштаб и центр сливается в пятно.
  // Только при смене набора точек, а не при выборе кружка.
  useEffect(() => {
    const m = map.current;
    if (!m || !cells.length) return;
    const lats: number[] = [], lngs: number[] = [];
    for (const c of cells) for (let i = 0; i < c.items.length; i++) { lats.push(c.lat); lngs.push(c.lng); }
    lats.sort((a, b) => a - b); lngs.sort((a, b) => a - b);
    const b = L.latLngBounds([quantile(lats, 0.05), quantile(lngs, 0.05)], [quantile(lats, 0.95), quantile(lngs, 0.95)]);
    m.fitBounds(b, { padding: [16, 16], maxZoom: 15 });
  }, [cells]);

  return <div ref={box} style={{ height: "min(70vh, 620px)", borderRadius: 12, overflow: "hidden", border: "1px solid var(--hair)" }} />;
}

export default function MapPage() {
  const s = useStore();
  const [city, setCity] = useState(CITIES[0].name);
  const [family, setFamily] = useState("");
  const [picked, setPicked] = useState<Cell | null>(null);
  const meta = CITIES.find((c) => c.name === city)!;

  const points = useMemo(() => uniqueAds(s.vacancies.filter((v) =>
    v.city === city && isActive(v, s) && v.lat != null && v.lng != null &&
    (!family || (v.p && s.overview.professions[v.p]?.family === family)))), [s, city, family]);
  const { cells, outside } = useMemo(() => cellsFor(points), [points]);
  const top = useMemo(() => [...cells].sort((a, b) => b.items.length - a.items.length).slice(0, 5), [cells]);

  return (
    <main className="wrap">
      <p className="eyebrow">Карта</p>
      <h1 className="page-title">Где в городе открыты IT-вакансии</h1>
      <p className="lede">Кружок — здание или соседние дома, чем он больше, тем больше там открытых вакансий. Нажмите на кружок, чтобы увидеть вакансии.</p>
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
        <span className="subnote">{nVac(points.length)} с адресом{outside ? `, ${int(outside)} — дальше ${RADIUS_KM} км от центра, не показаны` : ""}</span>
      </div>
      <figure>
        <LeafletMap cells={cells} colorVar={scopeColor(meta.c)} selected={picked?.key ?? null} onPick={setPicked} />
        <figcaption>Подложка: © участники OpenStreetMap. Адрес указывают не все работодатели, а некоторые пишут адрес головного офиса.</figcaption>
      </figure>

      <section className="block">
        {picked ? (
          <>
            <h2>{nVac(picked.items.length)} в этой точке</h2>
            <figure>
              <Table head={["Вакансия", "Компания", "Зарплата"]}
                rows={picked.items.map((v) => [<Link to={`/v/${v.id}`}>{v.t}</Link>, employerName(v.emp, s), v.usd ? usd(v.usd) : "—"])} />
            </figure>
          </>
        ) : (
          <>
            <h2>Где больше всего вакансий</h2>
            <figure>
              <Table head={["Точка", "Вакансий", "Компании"]}
                rows={top.map((c, i) => [
                  <button type="button" className="btn ghost" style={{ padding: "6px 10px" }} onClick={() => setPicked(c)}>Показать #{i + 1}</button>,
                  int(c.items.length),
                  [...new Set(c.items.map((v) => employerName(v.emp, s)))].slice(0, 3).join(", "),
                ])} />
            </figure>
          </>
        )}
      </section>
    </main>
  );
}
