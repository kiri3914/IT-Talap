export type Country = "kz" | "uz" | "kg";
export type Scope = "all" | Country;

/** Вакансия: факты из выгрузки scripts/export_app_data.py. Ключи короткие — файл большой. */
export interface Vacancy {
  id: string;
  c: Country;
  t: string;
  p: string | null; // код профессии из dbt/seeds/profession_map.csv
  e: string | null; // опыт: noExperience | between1And3 | between3And6 | moreThan6
  f: string | null; // формат: ON_SITE | HYBRID | REMOTE | FIELD_WORK
  emp: string | null;
  city: string | null;
  cg: string; // группа города: крупный город или other_<страна>
  wcity: string | null; // город работы из адреса — расходится с city у релокации
  sal: [number | null, number | null, string | null, boolean | null] | null;
  usd: number | null; // месячная зарплата в долларах, середина вилки
  sk: string[];
  soft: string[];
  lg: [string, string | null][];
  test: boolean;
  intern: boolean;
  letter: boolean;
  created: string | null;
  seg: [number, number][]; // отрезки присутствия в выдаче, индексы наблюдённых дней
  ad: string; // ключ объявления: клоны по городам совпадают
  lat: number | null;
  lng: number | null;
  url: string;
}

export type EventType =
  | "open" | "close" | "return" | "raise"
  | "salary_up" | "salary_down" | "salary_set" | "salary_drop";

/** [индекс дня, тип, id вакансии, вилка до, вилка после] */
export type Ev = [number, EventType, string, SalaryTuple | null | undefined, SalaryTuple | null | undefined];
export type SalaryTuple = [number | null, number | null, string | null];

export interface Employer {
  name: string;
  person: boolean;
  country: Country;
}

export interface Meta {
  generated_at: string;
  days: string[];
  counts: { vacancies: number; events: number; employers: number };
}

export interface Quartiles { n: number; p25: number; median: number; p75: number }

/** Агрегаты обзора рынка — site/data.json (scripts/export_site_data.py). */
export interface Overview {
  generated_at: string;
  period: { first: string; last: string; days: number; missing: string[] };
  min_n: number;
  professions: Record<string, { title: string; family: string; core: boolean }>;
  experience_labels: Record<string, string>;
  format_labels: Record<string, string>;
  daily: Array<{ dt: string; weekday: number } & Partial<Record<Country, { total: number; it: number } | null>>>;
  weekday: Record<Scope, Array<{ weekday: number; change_pct: number; n: number }>>;
  telegram: Array<{ country: Country; currency: string; year: number } & Quartiles>;
  scopes: Record<Scope, {
    kpi: {
      active: number; it_now: number; total_now: number; it_share_pct: number;
      unique_seen: number; closed_seen: number; disclosed_pct: number; salary: Quartiles | null;
    };
  }>;
}
