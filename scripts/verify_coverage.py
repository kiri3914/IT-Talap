"""Проверка полноты сбора: не теряем ли вакансии.

Сравнивает три числа:
  1. found при запросе всех 25 IT-ролей разом — сколько их по мнению API
  2. сумма found по каждой роли отдельно — с учётом пересечений
  3. сколько мы реально собрали и положили в бакет

Расхождение 1 и 3 означает потерю. Расхождение 1 и 2 — нормально:
у вакансии может быть несколько ролей.

    .venv/bin/python scripts/verify_coverage.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402

from ingestion.config import HHConfig, S3Config  # noqa: E402
from ingestion.sources.hh import COUNTRIES, HHClient  # noqa: E402
from ingestion.storage.s3 import RawStorage  # noqa: E402


def main() -> int:
    hh_cfg = HHConfig.from_env()
    storage = RawStorage(S3Config.from_env())

    dates = sorted({m.group(1) for k in storage.list_keys("raw/hh/")
                    if (m := re.search(r"dt=([\d-]+)", k))})
    dt = dates[-1] if dates else None

    with HHClient(hh_cfg) as client:
        roles = client.resolve_it_role_ids()
        token = hh_cfg.resolve_token()
        headers = {"User-Agent": hh_cfg.user_agent, "Accept": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"

        with httpx.Client(base_url="https://api.hh.ru", headers=headers, timeout=30.0) as http:
            for country, meta in COUNTRIES.items():
                area = client.resolve_area_id(meta["area_name"])

                # 1. Все роли одним запросом — истинное число IT-вакансий
                r = http.get("/vacancies", params=[
                    ("area", area), ("per_page", 1),
                    *[("professional_role", rid) for rid in roles],
                ])
                all_roles_found = (
                    r.json().get("found") if r.status_code == 200
                    else f"HTTP {r.status_code}"
                )

                # 2. Сумма по ролям отдельно
                per_role = {}
                for rid in roles:
                    rr = http.get("/vacancies", params={
                        "area": area, "professional_role": rid, "per_page": 1
                    })
                    if rr.status_code == 200:
                        per_role[rid] = rr.json().get("found", 0)
                total_sum = sum(per_role.values())

                # 3. Сколько лежит в бакете
                collected = 0
                if dt:
                    prefix = f"raw/hh/country={country}/dt={dt}/vacancies_list-"
                    ids = set()
                    for key in storage.list_keys(prefix):
                        payload = storage.read_json(key) or []
                        ids |= {str(i["id"]) for i in payload if i.get("id")}
                    collected = len(ids)

                # 4. Вся выдача по стране без фильтра ролей
                rt = http.get("/vacancies", params={"area": area, "per_page": 1})
                country_total = rt.json().get("found") if rt.status_code == 200 else "?"

                print(f"\n{'=' * 58}\n{meta['area_name']} (area={area})\n{'=' * 58}")
                print(f"  всего вакансий в стране:          {country_total}")
                print(f"  IT: все 25 ролей одним запросом:  {all_roles_found}")
                print(f"  IT: сумма по ролям по отдельности:{total_sum:>6}  "
                      "(пересечения посчитаны дважды)")
                print(f"  собрано и лежит в бакете:         {collected:>6}")

                if isinstance(all_roles_found, int) and collected:
                    diff = all_roles_found - collected
                    pct = 100 * collected / all_roles_found if all_roles_found else 0
                    mark = "✓ полнота" if abs(diff) <= all_roles_found * 0.02 else "⚠ РАСХОЖДЕНИЕ"
                    print(f"  покрытие:                         {pct:5.1f}%  "
                          f"{mark} (разница {diff:+})")

                over = {k: v for k, v in per_role.items() if v > 2000}
                if over:
                    print(f"  ⚠ роли выше лимита глубины 2000: {over}")

                top = sorted(per_role.items(), key=lambda kv: -kv[1])[:5]
                print(f"  топ-5 ролей по found: {top}")

    print("\nПримечание: поиск на сайте hh по слову (например «IT» или «Аналитик») —")
    print("это ТЕКСТОВЫЙ поиск, а не фильтр по профессиональным ролям.")
    print("Сравнивать его с нашим сбором напрямую нельзя.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
