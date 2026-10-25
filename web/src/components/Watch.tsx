import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { useWatch, type WatchItem, type WatchKind } from "../model/watch";
import type { Store } from "../model/store";
import { firstIx, uniqueAds } from "../model/store";
import { countEvents, eventsFor, skillKey, windowStart } from "../model/derive";
import { fmtDay, int } from "../model/format";

export function WatchButton({ kind, id, label }: { kind: WatchKind; id: string; label: string }) {
  const w = useWatch();
  const on = w.has(kind, id);
  return (
    <button type="button" className="btn ghost" aria-pressed={on} onClick={() => w.toggle({ kind, id, label })}
      style={{ padding: "8px 14px", fontSize: "0.875rem" }}>
      {on ? "★ В избранном" : "☆ В избранное"}
    </button>
  );
}

const HREF: Record<WatchKind, (id: string) => string> = { p: (id) => `/p/${id}`, c: (id) => `/c/${id}`, s: (id) => `/s/${encodeURIComponent(id)}` };
const KIND: Record<WatchKind, string> = { p: "профессия", c: "компания", s: "навык" };

function idsFor(item: WatchItem, s: Store) {
  const list = item.kind === "p" ? s.vacancies.filter((v) => v.p === item.id)
    : item.kind === "c" ? s.byEmp.get(item.id) ?? []
    : s.vacancies.filter((v) => v.sk.some((x) => skillKey(x) === item.id));
  return list;
}

// Дата прошлого визита фиксируется один раз на загрузку страницы. Если брать
// её при монтировании, двойное монтирование в режиме разработки и любой
// повторный заход на главную показывали бы «ничего нового».
let sessionSince: string | null | undefined;

/** Что произошло с избранным с прошлого визита. */
export function WatchDigest({ s }: { s: Store }) {
  const w = useWatch();
  if (sessionSince === undefined) sessionSince = w.seenDay;
  const since = sessionSince;
  const lastDay = s.days[s.lastIx];
  const { markSeen } = w;
  useEffect(() => { markSeen(lastDay); }, [lastDay, markSeen]);

  const fromIx = useMemo(() => {
    // «неделя» везде одна: 7 календарных дней, как на главной и в дайджесте
    if (!since) return windowStart(s, 7);
    const i = s.days.findIndex((d) => d > since);
    return i < 0 ? s.lastIx + 1 : i;
  }, [since, s]);

  const rows = useMemo(() => w.items.map((item) => {
    const list = idsFor(item, s);
    const c = countEvents(eventsFor(new Set(list.map((v) => v.id)), s, fromIx));
    const fresh = uniqueAds(list).filter((v) => firstIx(v) >= fromIx && firstIx(v) > 0).length;
    return { item, fresh, closed: c.close, up: c.salary_up, down: c.salary_down };
  }), [w.items, s, fromIx]);

  if (!w.items.length) {
    return (
      <p className="dek">Отметьте профессии, компании или навыки звёздочкой на их страницах — здесь появится, что с ними произошло с вашего прошлого визита. Избранное хранится только в этом браузере.</p>
    );
  }
  const quiet = rows.every((r) => !r.fresh && !r.closed && !r.up && !r.down);
  return (
    <>
      <p className="dek">
        {since ? (fromIx > s.lastIx ? `С прошлого визита новых данных нет — последний снимок от ${fmtDay(lastDay)}.` : `С вашего прошлого визита, с ${fmtDay(s.days[fromIx])}.`) : "За последнюю неделю — это ваш первый визит."}
        {quiet && fromIx <= s.lastIx && " Ничего не изменилось."}
      </p>
      <div className="cards">
        {rows.map((r) => (
          <Link key={`${r.item.kind}-${r.item.id}`} className="card" to={HREF[r.item.kind](r.item.id)}>
            <div className="ct">{r.item.label}</div>
            <div className="cm">{KIND[r.item.kind]}</div>
            <div className="cv num" style={{ fontSize: "1rem", marginTop: 10, lineHeight: 1.5 }}>
              <span style={{ color: r.fresh ? "var(--good)" : "var(--muted)" }}>+{int(r.fresh)} новых</span>{" · "}
              <span style={{ color: "var(--muted)" }}>−{int(r.closed)} пропало</span>
              {(r.up > 0 || r.down > 0) && <><br /><span>вилку подняли {int(r.up)}, снизили {int(r.down)}</span></>}
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
