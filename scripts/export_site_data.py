"""Выгрузка агрегатов для публичного сайта.

Сайт статический: страница + этот JSON. Ни сервера, ни доступа к базе —
ломать нечего. Скрипт запускается после ночного dbt и пишет site/data.json.

    .venv/bin/python -m scripts.export_site_data --out site/data.json

Что сюда НЕ попадает намеренно:
  • названия работодателей — среди них ИП с именами людей (docs/legal-pii-decision.md)
  • тексты вакансий и постов — авторское право (docs/sources/telegram.md)
  • группы меньше MIN_N — медиана по пяти вакансиям ничего не значит
"""

from __future__ import annotations

import argparse
import csv
import json
import statistics
import sys
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

import psycopg

from enrichment.telegram_fields import parse_post
from enrichment.vacancy import ad_key, is_monthly, posting_city, salary_of
from ingestion.config import PostgresConfig

ROOT = Path(__file__).resolve().parent.parent
COUNTRIES = ("kz", "uz", "kg")
SCOPES = ("all", *COUNTRIES)
MIN_N = 10
# Зарплаты вне этого коридора в долларах — опечатки и почасовые ставки,
# пропущенные мимо salary_range.mode. Медиана к ним устойчива, квартили нет.
USD_FLOOR, USD_CEIL = 80, 25_000
EXPERIENCE = [
    ("noExperience", "Без опыта"),
    ("between1And3", "1–3 года"),
    ("between3And6", "3–6 лет"),
    ("moreThan6", "Больше 6 лет"),
]
WORK_FORMAT = {
    "ON_SITE": "В офисе",
    "HYBRID": "Гибрид",
    "REMOTE": "Удалённо",
    "FIELD_WORK": "Разъездная",
}


def quartiles(values: list[float]) -> dict | None:
    if len(values) < MIN_N:
        return None
    q = statistics.quantiles(values, n=4, method="inclusive")
    return {"n": len(values), "p25": round(q[0]), "median": round(q[1]), "p75": round(q[2])}


def point(sal: dict) -> float | None:
    lo, hi = sal.get("from"), sal.get("to")
    if lo and hi:
        return (lo + hi) / 2
    return float(lo or hi) if (lo or hi) else None


def load_soft_skills() -> set[str]:
    """Навыки из категории soft — «деловая коммуникация» и подобное.

    В общем топе они вытесняют технологии, хотя про рынок говорят мало.
    """
    with open(ROOT / "dbt/seeds/skill_categories.csv", encoding="utf-8") as f:
        return {r["skill_raw"].strip().lower()
                for r in csv.DictReader(f) if r["category"] == "soft"}


def load_professions() -> dict[str, dict]:
    with open(ROOT / "dbt/seeds/profession_map.csv", encoding="utf-8") as f:
        return {r["hh_role_id"]: r for r in csv.DictReader(f)}


class Rates:
    """Курс на дату или ближайшую раньше: у нацбанков нет курсов на выходные."""

    def __init__(self, rows):
        self.by_dt: dict[date, dict[str, float]] = defaultdict(dict)
        for dt, cur, rate in rows:
            self.by_dt[dt][cur.strip()] = float(rate)
        self.dates = sorted(self.by_dt)

    def usd(self, amount: float, currency: str, on: date) -> float | None:
        currency = "RUB" if currency == "RUR" else currency
        if currency == "USD":
            return amount
        for dt in reversed(self.dates):
            if dt <= on and currency in self.by_dt[dt]:
                return amount / self.by_dt[dt][currency]
        for dt in self.dates:  # вакансия старше первого курса — берём первый
            if currency in self.by_dt[dt]:
                return amount / self.by_dt[dt][currency]
        return None


def kaplan_meier(spells: list[tuple[int, int, bool]], horizon: int = 90, min_risk: int = 30):
    """Доля вакансий, ещё открытых через t дней после создания.

    spells: (возраст при входе в наблюдение, возраст при выходе, закрылась ли).
    Вход с задержкой обязателен: сбор начался 11 сентября, и вакансии,
    созданные раньше и закрывшиеся до старта, мы не видели вовсе. Без
    поправки кривая врала бы в сторону долгожителей.
    """
    events = Counter(exit_ for entry, exit_, closed in spells if closed)
    last = max((exit_ for _, exit_, _ in spells), default=0)
    surv, out = 1.0, [{"day": 0, "open": 1.0, "at_risk": None}]
    # Не обрываем расчёт на маленькой группе: при отложенном входе она
    # сначала РАСТЁТ (вакансию, созданную ночью, мы видим на следующий день).
    # Надёжность точки отдаём наружу числом at_risk — сайт рисует только
    # точки, где под наблюдением не меньше min_risk вакансий.
    for t in range(1, min(horizon, last) + 1):
        at_risk = sum(1 for entry, exit_, _ in spells if entry < t <= exit_)
        if at_risk and events.get(t):
            surv *= 1 - events[t] / at_risk
        out.append({"day": t, "open": round(surv, 4), "at_risk": at_risk})
    at30 = next((p for p in out if p["day"] == 30 and (p["at_risk"] or 0) >= min_risk), None)
    return {
        "curve": out,
        "min_risk": min_risk,
        # hh снимает объявление сам через 30 дней — медиана «31 день» была бы
        # артефактом площадки. Содержательно другое: сколько закрыли РАНЬШЕ.
        "open_at_30_pct": round(100 * at30["open"], 1) if at30 else None,
        "n": len(spells),
        "closed": sum(1 for *_, c in spells if c),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", default="-")
    args = parser.parse_args()

    professions = load_professions()
    soft = load_soft_skills()
    with psycopg.connect(PostgresConfig.from_env().dsn) as conn, conn.cursor() as cur:
        cur.execute("""select source_id, country, min(dt), max(dt)
                       from raw_landing.hh_vacancies where kind = 'list' group by 1, 2""")
        presence = {(sid, c): (first, last) for sid, c, first, last in cur.fetchall()}

        cur.execute("""select dt, country, count(distinct source_id)
                       from raw_landing.hh_vacancies where kind = 'list' group by 1, 2""")
        listed = defaultdict(dict)
        for dt, c, n in cur.fetchall():
            listed[dt][c] = n

        cur.execute("""select distinct on (source_id) source_id, country, payload
                       from raw_landing.hh_vacancies where kind = 'details'
                       order by source_id, dt desc""")
        details = cur.fetchall()

        cur.execute("""select dt, country, vacancies_total, vacancies_it
                       from raw_landing.market_counters order by dt""")
        counters = cur.fetchall()

        cur.execute("select dt, currency, rate from raw_landing.currency_rates")
        rates = Rates(cur.fetchall())

        cur.execute("select channel, payload from raw_landing.telegram_posts")
        posts = cur.fetchall()

    first_dt, last_dt = min(listed), max(listed)
    all_days = [first_dt + timedelta(d) for d in range((last_dt - first_dt).days + 1)]
    missing = [d.isoformat() for d in all_days if d not in listed]

    # --- одна запись на размещение ---------------------------------------
    rows = []
    for sid, country, v in details:
        first, last = presence.get((sid, country), (None, None))
        if first is None:
            continue
        role = ((v.get("professional_roles") or [{}])[0] or {}).get("id")
        prof = professions.get(str(role))
        sal = salary_of(v)
        usd = None
        if sal and is_monthly(v) and (amount := point(sal)) and sal.get("currency"):
            usd = rates.usd(amount, sal["currency"], first)
            if usd is not None and not (USD_FLOOR <= usd <= USD_CEIL):
                usd = None
        created_raw = v.get("initial_created_at") or v.get("published_at")
        created = datetime.fromisoformat(created_raw).date() if created_raw else None
        rows.append({
            "country": country,
            "ad": ad_key(v),
            "first": first, "last": last,
            "active": last == last_dt,
            "created": created,
            "prof": prof["profession_code"] if prof else None,
            "has_salary": bool(sal and point(sal)),
            "usd": usd,
            "exp": (v.get("experience") or {}).get("id"),
            "format": ((v.get("work_format") or [{}])[0] or {}).get("id"),
            "skills": [s["name"].strip() for s in (v.get("key_skills") or []) if s.get("name")],
            "city": posting_city(v),
        })

    def scoped(scope):
        return [r for r in rows if scope == "all" or r["country"] == scope]

    def unique_ads(items):
        """Клоны одного объявления по городам считаем один раз (findings-04)."""
        seen, out = set(), []
        for r in items:
            if r["ad"] not in seen:
                seen.add(r["ad"])
                out.append(r)
        return out

    data: dict = {
        "generated_at": datetime.now().astimezone().isoformat(timespec="minutes"),
        "period": {"first": first_dt.isoformat(), "last": last_dt.isoformat(),
                   "days": len(listed), "missing": missing},
        "min_n": MIN_N,
        "professions": {r["profession_code"]: {"title": r["title_ru"], "family": r["family"],
                                               "core": r["is_core_it"] == "true"}
                        for r in professions.values()},
        "experience_labels": dict(EXPERIENCE),
        "format_labels": WORK_FORMAT,
    }

    # --- ряды по дням: счётчики рынка ------------------------------------
    series = defaultdict(dict)
    for dt, c, total, it in counters:
        series[dt.isoformat()][c] = {"total": total, "it": it}
    data["daily"] = [{"dt": d.isoformat(), "weekday": d.isoweekday(),
                      **{c: series.get(d.isoformat(), {}).get(c) for c in COUNTRIES}}
                     for d in all_days]

    # --- недельный цикл: средний прирост за день к предыдущему ------------
    weekday = {}
    for scope in SCOPES:
        changes = defaultdict(list)
        for prev, cur_ in zip(all_days, all_days[1:], strict=False):
            a, b = series.get(prev.isoformat()), series.get(cur_.isoformat())
            if not a or not b:
                continue
            keys = COUNTRIES if scope == "all" else (scope,)
            ta = sum(a[k]["total"] for k in keys if k in a)
            tb = sum(b[k]["total"] for k in keys if k in b)
            if ta and tb and all(k in a and k in b for k in keys):
                changes[cur_.isoweekday()].append((tb - ta) / ta * 100)
        weekday[scope] = [{"weekday": d, "change_pct": round(statistics.mean(changes[d]), 2),
                           "n": len(changes[d])} for d in range(1, 8) if changes[d]]
    data["weekday"] = weekday

    # --- срезы по стране ---------------------------------------------------
    by_scope = {}
    for scope in SCOPES:
        items = scoped(scope)
        active = [r for r in items if r["active"]]
        ads = unique_ads(items)
        ads_active = unique_ads(active)
        paid = [r["usd"] for r in ads if r["usd"]]

        counters_last = series.get(last_dt.isoformat(), {})
        keys = COUNTRIES if scope == "all" else (scope,)
        it_now = sum(counters_last[k]["it"] for k in keys if k in counters_last)
        total_now = sum(counters_last[k]["total"] for k in keys if k in counters_last)

        prof_rows = []
        for code in data["professions"]:
            group = [r for r in ads if r["prof"] == code]
            if not group:
                continue
            prof_rows.append({
                "code": code,
                "active": sum(1 for r in active if r["prof"] == code),
                "ads": len(group),
                "disclosed_pct": round(100 * sum(r["has_salary"] for r in group) / len(group), 1),
                "salary": quartiles([r["usd"] for r in group if r["usd"]]),
            })

        exp_rows = []
        for code, _ in EXPERIENCE:
            group = [r for r in ads if r["exp"] == code]
            exp_rows.append({"code": code, "ads": len(group),
                             "share_pct": round(100 * len(group) / max(len(ads), 1), 1),
                             "salary": quartiles([r["usd"] for r in group if r["usd"]])})

        fmt = Counter(r["format"] or "UNKNOWN" for r in ads_active)
        skills = Counter()
        casing: dict[str, Counter] = defaultdict(Counter)
        for r in ads:
            for s in set(x.lower() for x in r["skills"]):
                skills[s] += 1
            for s in r["skills"]:
                casing[s.lower()][s] += 1
        cities = Counter(r["city"] for r in active if r["city"])

        spells = []
        for r in items:
            if not r["created"] or r["created"] > r["last"]:
                continue
            entry = max(0, (r["first"] - r["created"]).days)
            if r["active"]:
                spells.append((entry, (last_dt - r["created"]).days, False))
            else:
                spells.append((entry, (r["last"] - r["created"]).days + 1, True))

        by_scope[scope] = {
            "kpi": {
                "active": sum(listed[last_dt].get(k, 0) for k in keys),
                "it_now": it_now,
                "total_now": total_now,
                "it_share_pct": round(100 * it_now / total_now, 2) if total_now else None,
                "unique_seen": len(items),
                "closed_seen": sum(1 for r in items if not r["active"]),
                "disclosed_pct": round(100 * sum(r["has_salary"] for r in ads_active)
                                       / max(len(ads_active), 1), 1),
                "salary": quartiles(paid),
            },
            "professions": sorted(prof_rows, key=lambda p: -p["ads"]),
            "experience": exp_rows,
            "formats": [{"code": k, "share_pct": round(100 * n / max(len(ads_active), 1), 1)}
                        for k, n in fmt.most_common()],
            "skills": [{"name": casing[s].most_common(1)[0][0],
                        "share_pct": round(100 * n / max(len(ads), 1), 1), "ads": n}
                       for s, n in skills.most_common() if s not in soft][:20],
            "soft_skills": [{"name": casing[s].most_common(1)[0][0],
                             "share_pct": round(100 * n / max(len(ads), 1), 1), "ads": n}
                            for s, n in skills.most_common() if s in soft][:8],
            "cities": [{"name": c, "active": n} for c, n in cities.most_common(8)],
            "lifetime": kaplan_meier(spells),
        }
    data["scopes"] = by_scope

    # --- телеграм: десять лет вилок ---------------------------------------
    yearly = defaultdict(list)
    for _channel, payload in posts:
        f = parse_post(payload)
        if not f.get("is_vacancy") or not f.get("published_at"):
            continue
        lo, hi, cur_ = f.get("salary_from"), f.get("salary_to"), f.get("currency")
        val = (lo + hi) / 2 if lo and hi else (lo or hi)
        if val and cur_ and f.get("country"):
            yearly[(f["country"], cur_, f["published_at"][:4])].append(val)
    data["telegram"] = [
        {"country": c, "currency": cur_, "year": int(y), **q}
        for (c, cur_, y), vals in sorted(yearly.items())
        if len(vals) >= 30 and (q := quartiles(vals))
    ]

    out = json.dumps(data, ensure_ascii=False, separators=(",", ":"), default=str)
    if args.out == "-":
        sys.stdout.write(out)
    else:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(out, encoding="utf-8")
        print(f"записано {args.out}: {len(out) // 1024} КБ", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
