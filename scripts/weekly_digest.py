"""Недельный дайджест по профессии — текстом, готовым для телеграма.

    .venv/bin/python -m scripts.weekly_digest devops
    .venv/bin/python -m scripts.weekly_digest devops developer --aggregate-only
    .venv/bin/python -m scripts.weekly_digest --all --out /tmp/digests

Читает выгрузку приложения (web/public/data, см. scripts/sync_app_data.sh).

Два режима — из-за условий API hh (docs/sources/hh.md §5):
  • полный: компании, вакансии, ссылки — ТОЛЬКО ДЛЯ КОМАНДЫ. Отправка в
    телеграм-канал — это передача данных стороннему сервису (п. 4.6).
  • --aggregate-only: только цифры по рынку — «информация о рынке труда»
    по п. 3.3. Такой дайджест можно публиковать.

Скрипт ничего не отправляет: он печатает текст. Публикация — решение человека.
"""

from __future__ import annotations

import argparse
import csv
import json
import statistics
import sys
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web/public/data"
CUR = {"KZT": "₸", "UZS": "сум", "KGS": "сом", "USD": "$", "RUB": "₽", "RUR": "₽", "EUR": "€"}


def fmt_int(v: float) -> str:
    return f"{v:,.0f}".replace(",", " ")


def salary(s) -> str:
    if not s:
        return "—"
    lo, hi, cur = s[0], s[1], CUR.get(s[2] or "", s[2] or "")
    if lo and hi:
        return f"{fmt_int(lo)}–{fmt_int(hi)} {cur}"
    return f"от {fmt_int(lo)} {cur}" if lo else f"до {fmt_int(hi)} {cur}"


def digest(code: str, d: dict, aggregate_only: bool) -> str:
    days = d["meta"]["days"]
    last = date.fromisoformat(days[-1])
    start = last - timedelta(days=7)
    from_ix = next(i for i, x in enumerate(days) if date.fromisoformat(x) > start)
    title = d["professions"].get(code, {}).get("title", code)

    vac = [v for v in d["vacancies"] if v["p"] == code]
    ids = {v["id"] for v in vac}
    by_id = {v["id"]: v for v in vac}
    evs = [e for e in d["events"] if e[2] in ids and e[0] >= from_ix]
    counts = Counter(e[1] for e in evs)
    active = [v for v in vac if v["seg"][-1][1] == len(days) - 1]
    seen, fresh = set(), []
    for v in vac:
        if v["ad"] in seen:
            continue
        seen.add(v["ad"])
        if v["seg"][0][0] >= from_ix and v["seg"][0][0] > 0:
            fresh.append(v)
    paid = [v["usd"] for v in fresh if v["usd"]]

    lines = [f"📊 {title}: неделя до {last.strftime('%d.%m')}", ""]
    lines.append(f"Открыто сейчас: {fmt_int(len(active))}")
    lines.append(
        f"Новых за неделю: {fmt_int(len(fresh))} · пропало из выдачи: {fmt_int(counts['close'])}"
    )
    if counts["salary_up"] or counts["salary_down"]:
        lines.append(f"Вилку подняли: {counts['salary_up']} · снизили: {counts['salary_down']}")
    if len(paid) >= 5:
        lines.append(
            f"Медиана зарплаты в новых вакансиях: ${fmt_int(statistics.median(paid))} "
            f"(по {len(paid)} с вилкой)"
        )
    skills = Counter(s for v in fresh for s in {x.lower(): x for x in v["sk"]}.values())
    if skills:
        lines.append("Чаще всего просят: " + ", ".join(s for s, _ in skills.most_common(5)))

    if not aggregate_only:
        emp = Counter(
            d["employers"].get(v["emp"], {}).get("name")
            for v in fresh
            if v["emp"] and not d["employers"].get(v["emp"], {}).get("person")
        )
        if emp:
            lines += ["", "Кто открывал вакансии:"]
            lines += [f"  • {name} — {n}" for name, n in emp.most_common(5) if name]
        changes = [e for e in evs if e[1] in ("salary_up", "salary_down")][:5]
        if changes:
            lines += ["", "Изменили вилку:"]
            for e in changes:
                v = by_id[e[2]]
                arrow = "↑" if e[1] == "salary_up" else "↓"
                lines.append(f"  {arrow} {v['t']}: {salary(e[3])} → {salary(e[4])}  {v['url']}")
        top = sorted((v for v in fresh if v["usd"]), key=lambda v: -v["usd"])[:3]
        if top:
            lines += ["", "Самые высокие вилки среди новых:"]
            lines += [f"  • {v['t']} — {salary(v['sal'])}  {v['url']}" for v in top]
        lines += ["", "⚠️ Внутренний дайджест: компании и ссылки не публиковать (условия API hh)."]
    else:
        lines += ["", "Данные: hh.kz, hh.uz, hh.kg. Методология — Талап."]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("codes", nargs="*", help="коды профессий: devops developer qa …")
    parser.add_argument("--all", action="store_true", help="все профессии")
    parser.add_argument(
        "--aggregate-only", action="store_true", help="только цифры — можно публиковать"
    )
    parser.add_argument("--out", help="каталог: по файлу на профессию")
    args = parser.parse_args()

    if not (DATA / "vacancies.json").exists():
        print("нет выгрузки: запустите scripts/sync_app_data.sh", file=sys.stderr)
        return 1
    d = {
        name: json.loads((DATA / f"{name}.json").read_text(encoding="utf-8"))
        for name in ("meta", "vacancies", "events", "employers")
    }
    with open(ROOT / "dbt/seeds/profession_map.csv", encoding="utf-8") as f:
        d["professions"] = {
            r["profession_code"]: {"title": r["title_ru"]} for r in csv.DictReader(f)
        }

    codes = list(d["professions"]) if args.all else args.codes
    if not codes:
        parser.error("укажите коды профессий или --all")
    for code in codes:
        text = digest(code, d, args.aggregate_only)
        if args.out:
            out = Path(args.out)
            out.mkdir(parents=True, exist_ok=True)
            (out / f"{code}.txt").write_text(text, encoding="utf-8")
        else:
            print(text, end="\n\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
