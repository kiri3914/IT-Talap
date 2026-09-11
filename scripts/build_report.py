"""Самодостаточный HTML-отчёт по собранным данным.

Открывается двойным кликом, ничего не грузит из сети: графики — inline SVG.
Это превью Фазы 3: прежде чем поднимать Metabase, стоит увидеть,
какие разрезы вообще осмысленны.

    .venv/bin/python scripts/build_report.py
    .venv/bin/python scripts/build_report.py --out /tmp/talap.html
"""

from __future__ import annotations

import argparse
import html
import re
import statistics
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ingestion.config import S3Config  # noqa: E402
from ingestion.storage.s3 import RawStorage  # noqa: E402

MIN_COUNT = 5
MAJOR_CITIES = {"Алматы", "Астана", "Ташкент", "Бишкек"}
COUNTRY_TITLE = {"kz": "Казахстан", "uz": "Узбекистан", "kg": "Кыргызстан"}
CURRENCY_BY_COUNTRY = {"kz": "KZT", "uz": "UZS", "kg": "KGS"}
EXPERIENCE_ORDER = ["Нет опыта", "От 1 года до 3 лет", "От 3 до 6 лет", "Более 6 лет"]


def fmt(value: float) -> str:
    return f"{value:,.0f}".replace(",", " ")


def esc(value) -> str:
    return html.escape(str(value))


def point(sal: dict) -> float | None:
    lo, hi = sal.get("from"), sal.get("to")
    if lo and hi:
        return (lo + hi) / 2
    return float(lo or hi) if (lo or hi) else None


def bars(rows: list[tuple[str, int, float]], unit: str, width: int = 620) -> str:
    """Горизонтальные столбцы. rows: (подпись, N, значение)."""
    if not rows:
        return '<p class="empty">Нет групп, прошедших порог.</p>'
    top = max(v for _, _, v in rows) or 1
    row_h, label_w, pad = 26, 250, 8
    out = [f'<svg viewBox="0 0 {width} {len(rows)*row_h + pad}" class="chart" '
           f'role="img" aria-label="Медианы по группам">']
    for i, (label, n, value) in enumerate(rows):
        y = i * row_h
        w = max(2, (value / top) * (width - label_w - 110))
        out.append(
            f'<text x="{label_w - 8}" y="{y + 17}" class="lbl" text-anchor="end">{esc(label)}</text>'
            f'<rect x="{label_w}" y="{y + 5}" width="{w:.1f}" height="15" rx="2" class="bar"/>'
            f'<text x="{label_w + w + 8}" y="{y + 17}" class="val">{fmt(value)}'
            f'<tspan class="dim"> {esc(unit)} · n={n}</tspan></text>'
        )
    out.append("</svg>")
    return "".join(out)


def load_details(storage: RawStorage, dt: str) -> list[dict]:
    out = []
    for country in COUNTRY_TITLE:
        for key in sorted(storage.list_keys(f"raw/hh/country={country}/dt={dt}/vacancy_details-")):
            for v in storage.read_json(key) or []:
                v["_country"] = country
                out.append(v)
    return out


def section_market(storage: RawStorage, dt: str) -> str:
    cells = []
    for country, title in COUNTRY_TITLE.items():
        for key in storage.list_keys(f"raw/hh/country={country}/dt={dt}/market_counters-"):
            c = storage.read_json(key)
            if not c:
                continue
            cells.append(
                f'<div class="card"><h3>{esc(title)}</h3>'
                f'<div class="big">{fmt(c["vacancies_it"])}</div>'
                f'<div class="sub">IT-вакансий</div>'
                f'<div class="meta">из {fmt(c["vacancies_total"])} всего · '
                f'доля {100 * (c.get("it_share") or 0):.1f}%</div></div>'
            )
    if not cells:
        return ""
    return ('<h2>Рынок труда</h2>'
            '<p class="note">Доля IT во всех вакансиях страны. Метрику не публикует '
            'ни одна площадка: для неё нужны ежедневные срезы, которых никто не хранит.</p>'
            f'<div class="cards">{"".join(cells)}</div>')


def section_salary(vacancies: list[dict], fx: dict) -> str:
    blocks = []
    for country, title in COUNTRY_TITLE.items():
        cur = CURRENCY_BY_COUNTRY[country]
        rows = []
        for v in vacancies:
            if v["_country"] != country:
                continue
            sal = v.get("salary") or v.get("salary_range")
            if not isinstance(sal, dict) or sal.get("currency") != cur:
                continue
            value = point(sal)
            if value:
                rows.append({
                    "v": value,
                    "role": (v.get("professional_roles") or [{}])[0].get("name") or "—",
                    "exp": (v.get("experience") or {}).get("name") or "—",
                    "net": sal.get("gross") is False,
                })
        if not rows:
            continue

        net = [r for r in rows if r["net"]]
        by_role = defaultdict(list)
        by_exp = defaultdict(list)
        for r in net:
            by_role[r["role"]].append(r["v"])
            by_exp[r["exp"]].append(r["v"])

        role_rows = sorted(
            ((k, len(v), statistics.median(v)) for k, v in by_role.items() if len(v) >= MIN_COUNT),
            key=lambda x: -x[2],
        )
        exp_rows = [
            (e, len(by_exp[e]), statistics.median(by_exp[e]))
            for e in EXPERIENCE_ORDER
            if len(by_exp.get(e, [])) >= MIN_COUNT
        ]
        usd = ""
        if fx.get(cur) and role_rows:
            top_name, top_n, top_val = role_rows[0]
            usd = (f'<p class="note">Для ориентира: {esc(top_name)} — '
                   f'${fmt(top_val / fx[cur])} по курсу нацбанка на дату.</p>')

        blocks.append(
            f'<h3>{esc(title)} · {esc(cur)}, на руки</h3>'
            f'<p class="note">{len(net)} вакансий с указанной зарплатой из {len(rows)}. '
            f'Группы меньше {MIN_COUNT} наблюдений не показаны.</p>'
            f'<h4>По профессиям</h4>{bars(role_rows, cur)}'
            f'<h4>По опыту</h4>{bars(exp_rows, cur)}{usd}'
        )
    return "<h2>Сколько предлагают</h2>" + "".join(blocks) if blocks else ""


def section_skills(vacancies: list[dict]) -> str:
    skills = Counter(
        s["name"] for v in vacancies for s in (v.get("key_skills") or []) if s.get("name")
    )
    if not skills:
        return ""
    total = len(vacancies)
    rows = [(name, n, 100 * n / total) for name, n in skills.most_common(18)]
    return (
        "<h2>Что требуют</h2>"
        f'<p class="note">Доля вакансий, где навык указан. Справочник hh не чистый: '
        f'{fmt(len(skills))} уникальных значений на {fmt(total)} вакансий, '
        f'рядом с технологиями встречаются «мягкие» навыки.</p>'
        + bars(rows, "%")
    )


def section_methodology(dt: str, vacancies: list[dict]) -> str:
    with_sal = sum(
        1 for v in vacancies
        if isinstance(v.get("salary") or v.get("salary_range"), dict)
    )
    full = sum(
        1 for v in vacancies
        if isinstance((s := v.get("salary") or v.get("salary_range")), dict)
        and s.get("from") and s.get("to")
    )
    return f"""
<h2>Как это считается и чего не показывает</h2>
<div class="method">
<p><strong>Источник.</strong> Публичные вакансии hh по IT-ролям, срез
на {esc(dt)}. Собрано {fmt(len(vacancies))} вакансий, покрытие 100%
от того, что отдаёт API.</p>

<p><strong>Это заявленные вилки, а не зарплаты нанятых.</strong> Мы видим,
сколько работодатель <em>предлагает</em> в объявлении. Реальная компенсация
нанятого человека публично недоступна нигде.</p>

<p><strong>Размер выборки.</strong> Зарплата указана у {fmt(with_sal)} вакансий
({100 * with_sal / len(vacancies):.0f}%), полная вилка «от и до» —
у {fmt(full)} ({100 * full / len(vacancies):.0f}%). Остальное в статистику
не попадает.</p>

<p><strong>Одна вакансия — одно наблюдение:</strong> берётся середина вилки.
Где указана только граница «от», берётся она, и медиана смещается вниз.</p>

<p><strong>Gross и net не смешиваются.</strong> Показаны суммы «на руки»:
разница с суммами до вычета налогов около 10%, и усреднять их вместе
значит получить величину, не означающую ничего.</p>

<p><strong>Порог публикации — {MIN_COUNT} наблюдений.</strong> Группы меньше
не показываются: по ним нельзя сделать осмысленный вывод. Поэтому малых
городов в разрезах нет.</p>

<p><strong>Чего мы не можем.</strong> Количество откликов не публикует
ни одна площадка. Факт закрытия вакансии по найму не виден — мы наблюдаем
только исчезновение из выдачи, а это не одно и то же.</p>

<p class="src">Код и методология открыты:
<a href="https://github.com/kiri3914/IT-Talap">github.com/kiri3914/IT-Talap</a></p>
</div>"""


TEMPLATE = """<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Talap — рынок IT-труда, {dt}</title>
<style>
  :root {{
    --bg:#fbfaf8; --fg:#1a1a18; --dim:#6b6862; --line:#e3e0da;
    --accent:#2f6f4f; --card:#fff;
  }}
  @media (prefers-color-scheme:dark) {{
    :root {{ --bg:#16161a; --fg:#e8e6e1; --dim:#9a968e; --line:#2c2c32;
             --accent:#6aab85; --card:#1e1e23; }}
  }}
  * {{ box-sizing:border-box }}
  body {{ margin:0; background:var(--bg); color:var(--fg);
    font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }}
  .wrap {{ max-width:860px; margin:0 auto; padding:48px 24px 80px }}
  header {{ border-bottom:2px solid var(--fg); padding-bottom:20px; margin-bottom:36px }}
  h1 {{ font-size:34px; margin:0 0 6px; letter-spacing:-.02em }}
  .tagline {{ color:var(--dim); margin:0 }}
  h2 {{ font-size:22px; margin:44px 0 4px; letter-spacing:-.01em }}
  h3 {{ font-size:17px; margin:28px 0 4px }}
  h4 {{ font-size:14px; margin:20px 0 6px; color:var(--dim);
        text-transform:uppercase; letter-spacing:.06em; font-weight:600 }}
  .note {{ color:var(--dim); font-size:13.5px; margin:4px 0 14px }}
  .cards {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr));
            gap:14px; margin:18px 0 }}
  .card {{ background:var(--card); border:1px solid var(--line);
           border-radius:10px; padding:18px }}
  .card h3 {{ margin:0 0 10px; font-size:14px; color:var(--dim) }}
  .big {{ font-size:32px; font-weight:650; letter-spacing:-.02em; line-height:1 }}
  .sub {{ font-size:13px; color:var(--dim); margin-top:2px }}
  .meta {{ font-size:12.5px; color:var(--dim); margin-top:10px;
           padding-top:10px; border-top:1px solid var(--line) }}
  .chart {{ width:100%; height:auto; display:block; margin:6px 0 4px;
            overflow:visible }}
  .bar {{ fill:var(--accent) }}
  .lbl {{ font-size:12.5px; fill:var(--fg) }}
  .val {{ font-size:12.5px; fill:var(--fg); font-variant-numeric:tabular-nums }}
  .dim {{ fill:var(--dim) }}
  .empty {{ color:var(--dim); font-style:italic }}
  .method p {{ margin:0 0 12px; font-size:14px }}
  .method {{ border-left:3px solid var(--line); padding-left:18px; margin-top:14px }}
  .src {{ font-size:13px; color:var(--dim); padding-top:8px }}
  a {{ color:var(--accent) }}
  footer {{ margin-top:56px; padding-top:18px; border-top:1px solid var(--line);
            color:var(--dim); font-size:12.5px }}
  @media (max-width:620px) {{ .wrap {{ padding:28px 16px 60px }} h1 {{ font-size:26px }} }}
</style></head>
<body><div class="wrap">
<header>
  <h1>Рынок IT-труда Центральной Азии</h1>
  <p class="tagline">Срез на {dt} · Казахстан, Узбекистан, Кыргызстан</p>
</header>
{market}
{salary}
{skills}
{methodology}
<footer>Talap · сгенерировано {generated} · данные hh, срез на {dt}</footer>
</div></body></html>"""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dt")
    parser.add_argument("--out", default="talap-report.html")
    args = parser.parse_args()

    storage = RawStorage(S3Config.from_env())
    dates = sorted({m.group(1) for k in storage.list_keys("raw/hh/")
                    if (m := re.search(r"dt=([\d-]+)", k))})
    if not dates:
        print("в бакете пусто")
        return 1
    dt = args.dt or dates[-1]

    vacancies = load_details(storage, dt)
    if not vacancies:
        print(f"нет деталей за {dt} — отчёт строится по ним")
        print(f"доступные даты: {', '.join(dates)}")
        return 1

    rates = storage.read_json(f"raw/currency/dt={dt}/rates-000.json.gz") or {}
    page = TEMPLATE.format(
        dt=esc(dt),
        generated=datetime.now().strftime("%Y-%m-%d %H:%M"),
        market=section_market(storage, dt),
        salary=section_salary(vacancies, rates.get("rates", {})),
        skills=section_skills(vacancies),
        methodology=section_methodology(dt, vacancies),
    )
    out = Path(args.out)
    out.write_text(page, encoding="utf-8")
    print(f"готово: {out.resolve()}  ({len(page) // 1024} КБ, {len(vacancies)} вакансий)")
    print("Скачать к себе:")
    print(f"  scp kiri@31.58.244.248:{out.resolve()} .")
    return 0


if __name__ == "__main__":
    sys.exit(main())
