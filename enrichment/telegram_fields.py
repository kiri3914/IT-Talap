"""Извлечение полей из текста телеграм-постов.

Это уровень staging: raw хранит пост целиком, здесь из него достаются
должность, компания, город, вилка. Правила, не LLM — сначала мерим,
сколько покрывают правила, и только потом решаем, нужна ли модель (ТЗ §6.4).

У каждого канала свой формат, поэтому правила разделены по каналам,
плюс общий проход по тем, что подходят всем.
"""

from __future__ import annotations

import re

from ingestion.sources.telegram import CHANNELS

CURRENCY_ALIASES = {
    "kzt": "KZT", "тг": "KZT", "тенге": "KZT", "₸": "KZT",
    "uzs": "UZS", "сум": "UZS", "сўм": "UZS",
    "so'm": "UZS", "so‘m": "UZS", "sum": "UZS",
    "kgs": "KGS", "сом": "KGS",
    "usd": "USD", "$": "USD", "долл": "USD",
    "rub": "RUB", "руб": "RUB", "₽": "RUB",
}

# «Должность: X», «Компания: X» — шаблон workitkz и частично uzdev_jobs
_LABELED = {
    "title": r"(?:должность|вакансия|позиция|position)\s*:\s*(.+)",
    "company": r"(?:компания|company|работодатель)\s*:\s*(.+)",
    "city": r"(?:город|city|локация|location)\s*:\s*(.+)",
    "employment": r"(?:занятость|формат|график|тип)\s*:\s*(.+)",
    # maosh / ish haqi — узбекский, встречается в uzdev_jobs
    "salary_line": r"(?:оплата|зарплата|зп|вилка|salary|доход|maosh|маош|ish\s*haqi)\s*:?\s*(.+)",
}

# «30000 - 70000 KGS в месяц», «От 150000 KGS в месяц» — шаблон findwork
_RANGE_WITH_CURRENCY = re.compile(
    r"(?:(?P<prefix>от|from)\s+)?(?P<a>\d[\d\s.,  ]{2,}\d)\s*"
    r"(?:[-–—]\s*(?P<b>\d[\d\s.,  ]{2,}\d))?\s*"
    r"(?P<cur>KZT|UZS|KGS|USD|RUB|тг|тенге|сум|сўм|so'm|so‘m|сом|руб|₸|\$|₽)",
    re.I,
)
# «Компания: Куратор» у findwork идёт как «EDU BRIDGE: Куратор по поступлению»
_FINDWORK_HEAD = re.compile(r"^(?P<company>[^\n:]{2,60}):\s*(?P<title>[^\n]{3,120})")
_FINDWORK_ID = re.compile(r"devkg\.com/tg/(j-\d+)")


def _clean_number(raw: str) -> int | None:
    digits = re.sub(r"[^\d]", "", raw)
    return int(digits) if digits else None


# «Оплата: 800000», «ЗП: 400 000 - 600 000» — число без валюты.
# Так пишет workitkz: валюту там подразумевают по стране канала.
_BARE_RANGE = re.compile(
    r"(?:(?P<prefix>от|from)\s+)?(?P<a>\d[\d\s  ]{4,})\s*(?:[-–—до]+\s*(?P<b>\d[\d\s  ]{4,}))?"
)
DEFAULT_CURRENCY = {"kz": "KZT", "uz": "UZS", "kg": "KGS"}


def parse_salary(text: str, default_currency: str | None = None) -> dict:
    """Вилка из свободного текста. Возвращает пустой dict, если не нашли.

    default_currency применяется только когда валюта не написана явно,
    а строка размечена как зарплатная — иначе легко принять за вилку
    номер телефона или год.
    """
    m = _RANGE_WITH_CURRENCY.search(text)
    if not m:
        if not default_currency:
            return {}
        bare = _BARE_RANGE.search(text)
        if not bare:
            return {}
        lo = _clean_number(bare.group("a"))
        hi = _clean_number(bare.group("b")) if bare.group("b") else None
        if not lo or lo < 10_000:  # ниже — почти наверняка не зарплата
            return {}
        if bare.group("prefix") and not hi:
            return {"salary_from": lo, "salary_to": None, "currency": default_currency}
        return {"salary_from": lo, "salary_to": hi, "currency": default_currency}
    lo = _clean_number(m.group("a"))
    hi = _clean_number(m.group("b")) if m.group("b") else None
    if not lo or lo < 1000:  # отсекаем годы, номера домов, «от 3 лет опыта»
        return {}
    cur = CURRENCY_ALIASES.get(m.group("cur").lower())
    if m.group("prefix") and not hi:
        return {"salary_from": lo, "salary_to": None, "currency": cur}
    return {"salary_from": lo, "salary_to": hi, "currency": cur}


# Пост не обязательно вакансия: в каналах попадаются новости и анонсы
_VACANCY_MARKERS = re.compile(
    r"(#вакансия|ищем|ищет|требуется|we'?re hiring|hiring|открыта вакансия|"
    r"в команду|обязанности|требования|компания\s*:|зарплата|оплата|зп\s*:|"
    r"maosh|вакансия|позиция|talab qilinadi)",
    re.I,
)

# «We're Hiring: X», «Компания ищет X», «ищем в команду: X» — шелуха перед должностью
_TITLE_PREFIX = re.compile(
    r"^.*?(?:we'?re hiring|hiring|ищ[еу]\w*(?:\s+в\s+команду)?|"
    r"открыта вакансия|требуется|в команду)\s*:?\s*",
    re.I,
)
# Строка целиком из хештегов и эмодзи — не заголовок
_ONLY_TAGS = re.compile(r"^[\s#\w]*$")


def _title_from_first_line(text: str) -> tuple[str | None, str | None]:
    """Должность (и, если видно, компания) из первой содержательной строки.

    В devkz_jobs и uzdev_jobs размеченных полей нет: заголовок — просто
    первая строка после хештегов. Встречаются три формы:
        «Python разработчик»                    -> должность
        «ITCBootcamp Алматы: Python разработчик» -> компания: должность
        «We're Hiring: DevOps-инженер (AWS)»     -> префикс + должность
    """
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") and _ONLY_TAGS.match(line):
            continue
        line = re.sub(r"#\w+", "", line).strip(" \t—-–·•|")
        if len(line) < 4:
            continue
        # Размеченное поле разберут правила выше, здесь оно только помешает
        if re.match(r"(?i)^(компания|город|занятость|тип|оплата|зп|зарплата)\s*:", line):
            continue

        company = None
        if stripped := _TITLE_PREFIX.sub("", line):
            if stripped != line and len(stripped) >= 4:
                line = stripped
            elif ":" in line:
                left, right = line.split(":", 1)
                # «Компания: Должность» — только если слева похоже на название,
                # а не на начало предложения
                if 2 < len(left.strip()) < 45 and len(right.strip()) >= 4:
                    company, line = left.strip(" «»\"'"), right.strip()

        line = line.strip(" «»\"'.,;")
        if 4 <= len(line) <= 130:
            return line, company
    return None, None


def parse_post(post: dict) -> dict:
    """Пост -> поля вакансии. Ничего не выдумывает: не нашли — None."""
    text = post.get("text") or ""
    channel = post.get("channel", "")
    # Страну берём из справочника каналов: полагаться на поле, которое
    # проставляет вызывающий код, — источник тихих ошибок
    country = post.get("country") or CHANNELS.get(channel, {}).get("country")
    out: dict = {
        "source": "telegram",
        "source_id": post.get("post_id"),
        "url": post.get("url"),
        "published_at": post.get("published_at"),
        "views": post.get("views"),
        "country": country,
        # Хештеги извлекаем сами, если их не передали: полагаться на поле,
        # которое заполняет вызывающий код, — тот же источник тихих ошибок,
        # что и со страной. В продуктиве их ставит parse_page, в тестах нет.
        "hashtags": post.get("hashtags") or re.findall(r"#(\w+)", text),
    }

    for field, pattern in _LABELED.items():
        m = re.search(pattern, text, re.I)
        if m:
            out[field] = m.group(1).strip().strip(".,;")

    out["is_vacancy"] = bool(_VACANCY_MARKERS.search(text))

    # findwork: «КОМПАНИЯ: Должность» первой строкой + внешний стабильный ID
    if channel == "findwork":
        head = _FINDWORK_HEAD.match(text.strip())
        if head:
            out.setdefault("company", head.group("company").strip())
            out.setdefault("title", head.group("title").strip())
        if ext := _FINDWORK_ID.search(text):
            out["external_id"] = ext.group(1)

    # Свободный формат: должность — первая содержательная строка.
    # Так пишут devkz_jobs и uzdev_jobs, где размеченных полей нет.
    if not out.get("title") and out["is_vacancy"]:
        title, company = _title_from_first_line(text)
        if title:
            out["title"] = title
        if company and not out.get("company"):
            out["company"] = company

    # Зарплата: из размеченной строки (там валюту можно подразумевать
    # по стране), иначе из всего текста — но уже только с явной валютой
    default_cur = DEFAULT_CURRENCY.get(country or "")
    salary = (
        parse_salary(out.get("salary_line", ""), default_cur)
        or parse_salary(text)
    )
    out.update(salary)

    # Город из хештегов, если явного поля нет
    if not out.get("city"):
        cities = {
            "almaty": "Алматы", "алматы": "Алматы", "astana": "Астана",
            "астана": "Астана", "bishkek": "Бишкек", "бишкек": "Бишкек",
            "tashkent": "Ташкент", "ташкент": "Ташкент", "shymkent": "Шымкент",
        }
        for tag in out["hashtags"]:
            if city := cities.get(tag.lower()):
                out["city"] = city
                break

    blob = f"{out.get('salary_line', '')} {text[:400]}".lower()
    if re.search(r"на руки|net|после налог", blob):
        out["gross"] = False
    elif re.search(r"до вычет|gross|грязными", blob):
        out["gross"] = True

    if remote := re.search(r"#(remote|удал[её]нк\w*|офис|office|гибрид|hybrid)", text, re.I):
        out.setdefault("employment", remote.group(1))

    return out
