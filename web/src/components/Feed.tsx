import { useState } from "react";
import { Link } from "react-router-dom";
import type { Ev } from "../model/types";
import { type Store, employerName } from "../model/store";
import { fmtDayShort, salaryText } from "../model/format";

const MARK: Record<string, string> = {
  open: "m-open", return: "m-open", close: "m-close", raise: "m-raise",
  salary_up: "m-up", salary_set: "m-up", salary_down: "m-down", salary_drop: "m-down",
};

export function eventText(e: Ev): string {
  switch (e[1]) {
    case "open": return "открыта";
    case "close": return "пропала из выдачи";
    case "return": return "вернулась в выдачу";
    case "raise": return "поднята в поиске";
    case "salary_up": return `вилку подняли: ${salaryText(...e[3]!)} → ${salaryText(...e[4]!)}`;
    case "salary_down": return `вилку снизили: ${salaryText(...e[3]!)} → ${salaryText(...e[4]!)}`;
    case "salary_set": return `указали зарплату: ${salaryText(...e[4]!)}`;
    case "salary_drop": return `убрали зарплату (была ${salaryText(...e[3]!)})`;
  }
}

/** Лента событий: дата, отметка типа, вакансия и что с ней случилось. */
export function Feed({ events, s, showCompany = true, limit = 15 }: { events: Ev[]; s: Store; showCompany?: boolean; limit?: number }) {
  const [all, setAll] = useState(false);
  if (!events.length) return <p className="empty">За этот период событий нет.</p>;
  const shown = all ? events : events.slice(0, limit);
  return (
    <>
    <ul className="feed">
      {shown.map((e, i) => {
        const v = s.byId.get(e[2]);
        if (!v) return null;
        return (
          <li key={`${e[2]}-${e[0]}-${e[1]}-${i}`} className={MARK[e[1]]}>
            <span className="when">{fmtDayShort(s.days[Math.min(e[0], s.lastIx)])}</span>
            <span className="mark" aria-hidden="true" />
            <span className="what">
              <Link to={`/v/${v.id}`}>{v.t}</Link> — {eventText(e)}
              <span className="meta">
                {showCompany && v.emp && !s.employers[v.emp]?.person
                  ? <Link to={`/c/${v.emp}`}>{employerName(v.emp, s)}</Link>
                  : showCompany ? employerName(v.emp, s) : null}
                {showCompany ? " · " : ""}{v.city}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
    {events.length > limit && (
      <button type="button" className="btn ghost" style={{ marginTop: 14 }} onClick={() => setAll((x) => !x)}>
        {all ? "Свернуть" : `Показать все ${events.length}`}
      </button>
    )}
    </>
  );
}
