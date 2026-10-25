import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

// ---------- подсказка ----------

let tipEl: HTMLDivElement | null = null;
function tip(): HTMLDivElement {
  if (!tipEl) {
    tipEl = document.createElement("div");
    tipEl.id = "tip";
    tipEl.hidden = true;
    document.body.appendChild(tipEl);
    window.addEventListener("scroll", hideTip, { passive: true });
  }
  return tipEl;
}
export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
export const row = (k: string, v: string) => `<div class="r"><span>${esc(k)}</span><b>${esc(v)}</b></div>`;
export const head = (s: string) => `<div class="h">${esc(s)}</div>`;

export function showTip(html: string, e: { clientX: number; clientY: number }) {
  const t = tip();
  t.innerHTML = html;
  t.hidden = false;
  const r = t.getBoundingClientRect(), pad = 14;
  let x = e.clientX + pad, y = e.clientY + pad;
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - pad;
  if (y + r.height > innerHeight - 8) y = e.clientY - r.height - pad;
  t.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
}
export function hideTip() { if (tipEl) tipEl.hidden = true; }

export function tipProps(html: () => string) {
  return {
    onMouseMove: (e: React.MouseEvent) => showTip(html(), e),
    onMouseLeave: hideTip,
    onTouchStart: (e: React.TouchEvent) => showTip(html(), e.touches[0]),
  };
}

// ---------- размеры ----------

export function useWidth<T extends HTMLElement>(fallback = 640): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    setW(el.clientWidth || fallback);
    const ro = new ResizeObserver(() => setW((prev) => (Math.abs(prev - el.clientWidth) > 4 ? el.clientWidth : prev)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return [ref, Math.max(280, w)];
}

export function niceStep(span: number, count: number) {
  const raw = span / Math.max(count, 1);
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}
export function ticks(lo: number, hi: number, count: number) {
  const step = niceStep(hi - lo, count);
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

/** Столбик со скруглённым концом данных и прямым основанием. */
export function barV(x: number, y0: number, y1: number, w: number, r = 4) {
  const up = y1 < y0, h = Math.abs(y1 - y0);
  r = Math.min(r, h, w / 2);
  if (h < 0.5) return "";
  const s = up ? 1 : -1;
  return `M${x},${y0}V${y1 + s * r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + s * r}V${y0}Z`;
}
export function barH(x0: number, x1: number, y: number, h: number, r = 4) {
  const w = x1 - x0;
  r = Math.min(r, w, h / 2);
  if (w < 0.5) return "";
  return `M${x0},${y}H${x1 - r}Q${x1},${y} ${x1},${y + r}V${y + h - r}Q${x1},${y + h} ${x1 - r},${y + h}H${x0}Z`;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

// ---------- горизонтальные столбики ----------

export interface BarRow { key: string; label: string; value: number; display: string; tip?: () => string; href?: string; tag?: string }

export function HBars({ rows, color, labelW = 220, valueW = 64, rowH = 28, max, label }: {
  rows: BarRow[]; color: string; labelW?: number; valueW?: number; rowH?: number; max?: number; label: string;
}) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const nav = useNavigate();
  if (!rows.length) return <div ref={ref} className="empty">Нет данных для этого среза.</div>;
  const lw = Math.min(labelW, W * 0.45);
  const top = max ?? Math.max(...rows.map((r) => r.value), 1);
  const x0 = lw, x1 = W - valueW, bh = 12;
  const chars = Math.floor(lw / 7.2);
  return (
    <div ref={ref} className="chart">
      <svg viewBox={`0 0 ${W} ${rows.length * rowH + 4}`} role="img" aria-label={label} style={{ ["--c" as string]: color }}>
        {rows.map((r, i) => {
          const y = i * rowH;
          return (
            <g key={r.key} {...(r.tip ? tipProps(r.tip) : {})} onClick={r.href ? () => nav(r.href!) : undefined} style={{ cursor: r.href ? "pointer" : "default" }}>
              <rect x={0} y={y} width={W} height={rowH} fill="transparent" />
              <text x={0} y={y + rowH / 2 + 4} className="t-ink2">
                {clip(r.label, chars - (r.tag ? 9 : 0))}
                {r.tag && <tspan dx={6} className="tag" style={{ fontSize: 10 }}>{r.tag}</tspan>}
                <title>{r.label}</title>
              </text>
              <path d={barH(x0, x0 + Math.max(2, ((x1 - x0) * r.value) / top), y + (rowH - bh) / 2, bh)} style={{ fill: "var(--c)" }} />
              <text x={W} y={y + rowH / 2 + 4} textAnchor="end" className="t-ink num">{r.display}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---------- медиана и разброс ----------

export interface RangeRow { key: string; label: string; tag?: string; p25: number; median: number; p75: number; tip?: () => string; href?: string }

export function DotRange({ rows, color, label, format }: { rows: RangeRow[]; color: string; label: string; format: (v: number) => string }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const nav = useNavigate();
  if (!rows.length) return <div ref={ref} className="empty">Мало вакансий с зарплатой для этого среза.</div>;
  const stacked = W < 640;
  const labelW = stacked ? 0 : Math.min(300, W * 0.34);
  const rowH = stacked ? 46 : 30, top = 26, right = 64;
  const H = top + rows.length * rowH + 6;
  const max = Math.max(...rows.map((r) => r.p75)) * 1.05;
  const X = (v: number) => labelW + ((W - right - labelW) * v) / max;
  const chars = Math.floor(labelW / 7.2);
  return (
    <div ref={ref} className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} style={{ ["--c" as string]: color }}>
        <g className="grid">
          {ticks(0, max, stacked ? 3 : 5).map((v) => <line key={v} x1={X(v)} x2={X(v)} y1={top - 4} y2={H} />)}
        </g>
        {ticks(0, max, stacked ? 3 : 5).map((v) => (
          <text key={v} x={X(v)} y={12} textAnchor="middle" className="tick">{v === 0 ? "0" : format(v)}</text>
        ))}
        {rows.map((r, i) => {
          const y = top + i * rowH;
          const cy = stacked ? y + 31 : y + rowH / 2;
          return (
            <g key={r.key} {...(r.tip ? tipProps(r.tip) : {})} onClick={r.href ? () => nav(r.href!) : undefined} style={{ cursor: r.href ? "pointer" : "default" }}>
              <rect x={0} y={y} width={W} height={rowH} fill="transparent" />
              <text x={0} y={stacked ? y + 14 : y + rowH / 2 + 4} className="t-ink2">
                {stacked ? r.label : clip(r.label, chars - (r.tag ? 9 : 0))}
                {r.tag && <tspan dx={6} className="tag" style={{ fontSize: 10 }}>{r.tag}</tspan>}
              </text>
              <path d={barH(X(r.p25), X(r.p75), cy - 4, 8)} style={{ fill: "var(--c)", opacity: 0.28 }} />
              <circle cx={X(r.median)} cy={cy} r={5} style={{ fill: "var(--c)", stroke: "var(--bg)", strokeWidth: 2 }} />
              <text x={W} y={cy + 4} textAnchor="end" className="t-ink num">{format(r.median)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---------- столбики по времени ----------

export interface ColRow { key: string; label: string; value: number; tip?: () => string; muted?: boolean }

export function Columns({ rows, color, label, height = 200, format = (v: number) => String(Math.round(v)), showValues = true }: {
  rows: ColRow[]; color: string; label: string; height?: number; format?: (v: number) => string; showValues?: boolean;
}) {
  const [ref, W] = useWidth<HTMLDivElement>();
  if (!rows.length) return <div ref={ref} className="empty">Нет данных.</div>;
  const m = { l: 36, r: 6, t: 20, b: 26 };
  const max = Math.max(...rows.map((r) => r.value), 1);
  const yTop = Math.ceil(max / niceStep(max, 3)) * niceStep(max, 3);
  const bw = (W - m.l - m.r) / rows.length;
  const Y = (v: number) => m.t + (height - m.t - m.b) * (1 - v / yTop);
  const every = Math.ceil(rows.length / Math.max(1, Math.floor((W - m.l) / 56)));
  return (
    <div ref={ref} className="chart">
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={label} style={{ ["--c" as string]: color }}>
        <g className="grid">{ticks(0, yTop, 3).map((v) => <line key={v} x1={m.l} x2={W - m.r} y1={Y(v)} y2={Y(v)} />)}</g>
        {ticks(0, yTop, 3).map((v) => <text key={v} x={m.l - 6} y={Y(v) + 4} textAnchor="end" className="tick">{format(v)}</text>)}
        {rows.map((r, i) => {
          const x = m.l + bw * i, w = Math.max(2, Math.min(36, bw * 0.62));
          return (
            <g key={r.key} {...(r.tip ? tipProps(r.tip) : {})}>
              <rect x={x} y={m.t - 18} width={bw} height={height - m.t - m.b + 18} fill="transparent" />
              <path d={barV(x + (bw - w) / 2, Y(0), Y(r.value), w)} style={{ fill: "var(--c)", opacity: r.muted ? 0.4 : 1 }} />
              {showValues && bw > 26 && r.value > 0 && (
                <text x={x + bw / 2} y={Y(r.value) - 5} textAnchor="middle" className="t-ink num" style={{ fontSize: 11 }}>{format(r.value)}</text>
              )}
              {i % every === 0 && <text x={x + bw / 2} y={height - 8} textAnchor="middle" className="tick">{r.label}</text>}
            </g>
          );
        })}
        <line x1={m.l} x2={W - m.r} y1={Y(0)} y2={Y(0)} className="baseline" />
      </svg>
    </div>
  );
}

// ---------- кривая «сколько вакансий ещё открыто» ----------

export function Survival({ curve, color, label }: { curve: Array<{ day: number; open: number; atRisk: number }>; color: string; label: string }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  if (curve.length < 3) return <div ref={ref} className="empty">Мало закрытых вакансий для оценки.</div>;
  const H = W < 560 ? 250 : 300, m = { l: 44, r: 16, t: 18, b: 34 }, dmax = 90;
  const X = (d: number) => m.l + ((W - m.l - m.r) * d) / dmax;
  const Y = (v: number) => m.t + (H - m.t - m.b) * (1 - v);
  let d = `M${X(curve[0].day)},${Y(curve[0].open)}`;
  for (let i = 1; i < curve.length; i++) d += `H${X(curve[i].day)}V${Y(curve[i].open)}`;
  const p30 = curve.find((p) => p.day === 30);
  return (
    <div ref={ref} className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} style={{ ["--c" as string]: color }}>
        <g className="grid">{[0, 0.25, 0.5, 0.75, 1].map((v) => <line key={v} x1={m.l} x2={W - m.r} y1={Y(v)} y2={Y(v)} />)}</g>
        {[0, 0.25, 0.5, 0.75, 1].map((v) => <text key={v} x={m.l - 8} y={Y(v) + 4} textAnchor="end" className="tick">{Math.round(v * 100)}%</text>)}
        {[0, 15, 30, 45, 60, 75, 90].map((t) => <text key={t} x={X(t)} y={H - m.b + 18} textAnchor="middle" className="tick">{t}</text>)}
        <text x={W - m.r} y={H - 2} textAnchor="end">дней с момента создания →</text>
        <line x1={X(30)} x2={X(30)} y1={m.t} y2={H - m.b} style={{ stroke: "var(--ink-2)", strokeDasharray: "3 3" }} />
        <text x={X(30) + 8} y={m.t + 12} className="t-ink2">30 дней — hh снимает объявление</text>
        <path d={`${d}V${Y(0)}H${X(0)}Z`} style={{ fill: "var(--c)", opacity: 0.08 }} />
        <path d={d} style={{ fill: "none", stroke: "var(--c)", strokeWidth: 2 }} />
        {p30 && (
          <>
            <circle cx={X(30)} cy={Y(p30.open)} r={5} style={{ fill: "var(--c)", stroke: "var(--bg)", strokeWidth: 2 }} />
            <text x={X(30) - 10} y={Y(p30.open) - 10} textAnchor="end" className="t-strong num">{Math.round(p30.open * 100)}% дожили</text>
          </>
        )}
      </svg>
    </div>
  );
}

// ---------- распределение зарплат с отметкой ----------

/** Точки — зарплаты похожих вакансий, полоса — середина распределения,
 *  вертикальная черта — эта вакансия. Показывает «где она среди похожих». */
export function SalaryStrip({ values, p25, median, p75, mark, color, format, markLabel = "эта вакансия" }: {
  values: number[]; p25: number; median: number; p75: number; mark?: number | null; color: string; format: (v: number) => string; markLabel?: string;
}) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const H = 120, m = { l: 8, r: 8, t: 30, b: 28 };
  const lo = Math.min(...values, mark ?? Infinity), hi = Math.max(...values, mark ?? 0);
  const pad = (hi - lo) * 0.04 || 1;
  const X = (v: number) => m.l + ((W - m.l - m.r) * (v - lo + pad)) / (hi - lo + 2 * pad);
  // точки раскладываются по вертикали, чтобы одинаковые суммы не слипались
  const bins = new Map<number, number>();
  const dots = values.map((v) => {
    const b = Math.round(X(v) / 7);
    const k = bins.get(b) ?? 0;
    bins.set(b, k + 1);
    return { x: X(v), y: m.t + 20 + ((k % 6) - 2.5) * 6 };
  });
  const yMid = m.t + 20;
  return (
    <div ref={ref} className="chart gauge">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Зарплаты похожих вакансий" style={{ ["--c" as string]: color }}>
        <rect x={X(p25)} y={yMid - 22} width={Math.max(2, X(p75) - X(p25))} height={44} rx={6} style={{ fill: "var(--c)", opacity: 0.12 }} />
        {dots.map((d, i) => <circle key={i} cx={d.x} cy={d.y} r={2.6} style={{ fill: "var(--c)", opacity: 0.55 }} />)}
        <line x1={X(median)} x2={X(median)} y1={yMid - 24} y2={yMid + 24} style={{ stroke: "var(--c)", strokeWidth: 2 }} />
        <text x={X(median)} y={m.t - 12} textAnchor="middle" className="t-ink2">медиана {format(median)}</text>
        <text x={X(p25)} y={H - 8} textAnchor="middle" className="tick">{format(p25)}</text>
        <text x={X(p75)} y={H - 8} textAnchor="middle" className="tick">{format(p75)}</text>
        {mark != null && (
          <>
            <line x1={X(mark)} x2={X(mark)} y1={yMid - 30} y2={yMid + 30} style={{ stroke: "var(--ink)", strokeWidth: 2.5 }} />
            <text x={X(mark)} y={yMid + 44} textAnchor={X(mark) > W - 80 ? "end" : X(mark) < 80 ? "start" : "middle"} className="t-strong">
              {markLabel}: {format(mark)}
            </text>
          </>
        )}
      </svg>
    </div>
  );
}

// ---------- мини-график для карточек ----------

export function Spark({ values, color, w = 120, h = 30 }: { values: number[]; color: string; w?: number; h?: number }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1), min = Math.min(...values);
  const X = (i: number) => (w * i) / (values.length - 1);
  const Y = (v: number) => h - 2 - ((h - 4) * (v - min)) / (max - min || 1);
  const d = values.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join("");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ ["--c" as string]: color, display: "block" }}>
      <path d={d} style={{ fill: "none", stroke: "var(--c)", strokeWidth: 1.5 }} />
      <circle cx={X(values.length - 1)} cy={Y(values[values.length - 1])} r={2.5} style={{ fill: "var(--c)" }} />
    </svg>
  );
}

export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="tablewrap">
      <table className="data">
        <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
