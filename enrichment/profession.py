"""Профессия по заголовку вакансии — правилами, без LLM (ТЗ §6.4).

Нужна для источников, где роли нет в структуре: в телеграме есть только
текст поста. Коды — те же, что в dbt/seeds/profession_map.csv, чтобы
телеграм и hh сводились в одни и те же профессии.

Порядок правил важен: первое совпадение побеждает. Поэтому узкие роли идут
раньше широких — «DevOps-разработчик» должен стать devops, а не developer,
«руководитель отдела разработки» — dev_lead, а не developer.
"""

from __future__ import annotations

import re

_RULES: list[tuple[str, list[str]]] = [
    ("cto", [r"\bcto\b", "технический директор"]),
    ("cio", [r"\bcio\b", "директор по (ит|информационным)"]),
    (
        "dev_lead",
        [
            r"\b(team ?lead|тимлид|tech ?lead|head of (engineering|development))\b",
            r"руководител\w* (отдела |группы )?разработки",
        ],
    ),
    ("analytics_lead", ["head of (data|analytics)", r"руководител\w* (отдела )?аналитик"]),
    (
        "devops",
        [
            "dev ?ops",
            r"\bsre\b",
            "site reliability",
            "devsecops",
            "platform engineer",
            "kubernetes",
        ],
    ),
    (
        "security",
        [
            r"информационн\w* безопасност",
            r"\bиб\b",
            "security",
            "пентест",
            "pentest",
            "soc[- ]аналитик",
            "кибербезопасн",
        ],
    ),
    (
        "data_scientist",
        [
            "data scien",
            "дата[- ]?сайент",
            r"\bml\b",
            "machine learning",
            r"машинн\w* обучени",
            r"\bnlp\b",
            "computer vision",
            r"\bai engineer",
            r"\bllm\b",
        ],
    ),
    (
        "data_analyst",
        [
            "data analyst",
            "аналитик данных",
            r"\bbi\b",
            "bi[- ]аналитик",
            "bi[- ]разработчик",
            "data engineer",
            "инженер данных",
            r"\betl\b",
            "dwh",
        ],
    ),
    ("product_analyst", ["product analyst", r"продуктов\w* аналитик"]),
    ("systems_analyst", ["system analyst", r"системн\w* аналитик"]),
    ("business_analyst", ["business analyst", "бизнес[- ]аналитик"]),
    ("qa", [r"\bqa\b", r"\baqa\b", "тестировщ", "tester", "quality assurance", "автотест"]),
    (
        "product_manager",
        ["product manager", "product owner", "продакт", "менеджер продукта", "владелец продукта"],
    ),
    (
        "project_manager",
        [
            "project manager",
            "проджект",
            r"руководител\w* проект",
            "менеджер проект",
            r"\bpm\b",
            "scrum master",
            "delivery manager",
        ],
    ),
    ("game_designer", ["game ?designer", "гейм[- ]?дизайн", "геймдизайн"]),
    ("art_director", ["art director", "арт[- ]директор", r"креативн\w* директор"]),
    (
        "designer",
        [
            "дизайнер",
            "designer",
            r"\bui\b",
            r"\bux\b",
            "motion",
            "иллюстратор",
            "3d[- ]?(artist|художник)",
            "художник",
        ],
    ),
    ("tech_writer", ["technical writer", r"техническ\w* писател"]),
    ("network_engineer", [r"сетев\w* инженер", "network engineer", r"\bccna\b"]),
    ("systems_engineer", [r"системн\w* инженер", "system engineer", "инженер[- ]систем"]),
    (
        "sysadmin",
        [
            r"системн\w* администратор",
            "сисадмин",
            "sysadmin",
            "system administrator",
            "администратор (сети|серверов)",
        ],
    ),
    (
        "support",
        [
            r"техническ\w* поддержк",
            "support",
            "help ?desk",
            "хелпдеск",
            "service ?desk",
            "оператор",
            "специалист поддержки",
        ],
    ),
    ("analyst", ["аналитик", "analyst"]),
    (
        "developer",
        [
            "разработчик",
            "программист",
            "developer",
            "engineer",
            "backend",
            "frontend",
            "front-end",
            "back-end",
            "fullstack",
            "full-stack",
            r"\b(python|java|golang|go|php|ruby|node\.?js|react|vue|angular|ios|android|flutter|kotlin)\b",
            r"\b(swift|c#|\.net|c\+\+|1с|1c|laravel|django)\b",
        ],
    ),
]
_COMPILED = [(code, re.compile("|".join(alts), re.I)) for code, alts in _RULES]


def guess_profession(title: str | None) -> str | None:
    """Код профессии по заголовку или None, если правила не узнали."""
    if not title:
        return None
    for code, rx in _COMPILED:
        if rx.search(title):
            return code
    return None
