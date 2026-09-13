{#
  JSON-null и SQL NULL — разные вещи.

  `payload -> 'salary'` при "salary": null возвращает jsonb 'null',
  а не SQL NULL. Отсюда два тихих бага:

    coalesce(payload -> 'salary', payload -> 'salary_range')
        вернёт jsonb 'null' и НИКОГДА не дойдёт до salary_range

    where payload -> 'salary' is not null
        истинно для вакансий БЕЗ зарплаты — даёт «100% раскрытия»

  Второй случай реально встретился при анализе 2026-09-14.
  Использовать этот макрос вместо `->` везде, где поле может быть null.
#}

{% macro jget(column, key) -%}
    nullif({{ column }} -> '{{ key }}', 'null'::jsonb)
{%- endmacro %}


{% macro jhas(column, key) -%}
    jsonb_typeof({{ column }} -> '{{ key }}') = 'object'
{%- endmacro %}
