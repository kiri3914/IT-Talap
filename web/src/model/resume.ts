import RULES from "./professionRules.json";
import type { Store } from "./store";
import { isActive, uniqueAds } from "./store";
import { skillIndex, skillKey } from "./derive";
import type { Country, Vacancy } from "./types";

// ---------- регулярки: Python → JavaScript ----------

// В JavaScript \w и \b знают только латиницу: «руководител\w*» на кириллице
// молча не сработает. Переводим в Unicode-классы.
const W = "[\\p{L}\\p{N}_]";
const B = `(?:(?<=${W})(?!${W})|(?<!${W})(?=${W}))`;
const toUnicode = (rx: string) => rx.replace(/\\w/g, W).replace(/\\b/g, B);

const COMPILED = (RULES as Array<[string, string[]]>).map(([code, alts]) => [code, new RegExp(alts.map(toUnicode).join("|"), "iu")] as const);

/** Профессия по тексту — те же правила, что enrichment/profession.py. */
export function guessProfession(text: string): string | null {
  for (const [code, rx] of COMPILED) if (rx.test(text)) return code;
  return null;
}

// ---------- разбор резюме ----------

export interface ParsedResume {
  role: string | null;
  experience: string | null;
  years: number | null;
  skills: string[]; // ключи навыков (lowercase)
  english: string | null;
  cities: string[];
}

const CITY = ["Алматы", "Астана", "Ташкент", "Бишкек", "Шымкент", "Караганда", "Самарканд", "Ош"];

const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function yearsToExperience(y: number | null): string | null {
  if (y == null) return null;
  if (y < 1) return "noExperience";
  if (y < 3) return "between1And3";
  if (y < 6) return "between3And6";
  return "moreThan6";
}

/** Опыт: «Опыт работы — 5 лет 3 месяца» (формат резюме hh), «5+ years of experience». */
function parseYears(text: string): number | null {
  const ru = text.match(/опыт\s+работы\s*[—–:-]?\s*(\d{1,2})\s*(год|года|лет)/iu);
  if (ru) return Number(ru[1]);
  const en = text.match(/(\d{1,2})\+?\s*years?\s+(of\s+)?(commercial\s+|professional\s+)?experience/iu);
  return en ? Number(en[1]) : null;
}

export function parseResume(text: string, s: Store): ParsedResume {
  const head = text.slice(0, 400);
  const skills = skillIndex(s.vacancies, 5).filter((k) => {
    // границы слова — через Unicode, чтобы «C#» и «1С» находились, а «Go» не ловился в «Google»
    const rx = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRx(k.key)}(?![\\p{L}\\p{N}])`, "iu");
    return rx.test(text);
  }).map((k) => k.key);
  const eng = text.match(/(английск|english)[^\n]{0,60}?\b(A1|A2|B1|B2|C1|C2)\b/iu) ?? text.match(/\b(A1|A2|B1|B2|C1|C2)\b[^\n]{0,40}(английск|english)/iu);
  const years = parseYears(text);
  return {
    role: guessProfession(head) ?? guessProfession(text),
    experience: yearsToExperience(years),
    years,
    skills,
    english: eng ? (eng[2] ?? eng[1]).toUpperCase() : null,
    cities: CITY.filter((c) => new RegExp(`(?<!\\p{L})${c}(?!\\p{L})`, "u").test(text)),
  };
}

/** pdf.js расставляет пробелы между фрагментами: «Backend- разработчик»,
 *  «CI / CD», «( пример ,». На таком тексте навыки с дефисом и слешем не
 *  находились бы. Длинное тире не трогаем: «2022 — 2024» так и пишется. */
export function normalizePdf(t: string) {
  return t
    .replace(/[ \t]+([,.;:!?)\]])/g, "$1")
    .replace(/([(\[])[ \t]+/g, "$1")
    .replace(/([\p{L}\p{N}+#])[ \t]*([/-])[ \t]*(?=[\p{L}\p{N}])/gu, "$1$2")
    .replace(/[ \t]{2,}/g, " ");
}

// ---------- подбор ----------

const EXP_ORDER = ["noExperience", "between1And3", "between3And6", "moreThan6"];

export interface Match {
  v: Vacancy;
  score: number;
  matched: string[];
  missing: string[];
  roleMatch: boolean;
}

/** Подбор вакансий под резюме. Редкие навыки весят больше частых (как IDF):
 *  совпадение по Kubernetes говорит о вакансии больше, чем по «MS Office».
 *
 *  Две поправки, без которых наверх лезли случайные вакансии:
 *  • сглаживание — к весу требований добавляются ещё два «средних» навыка.
 *    Иначе вакансия с единственным требованием SQL давала 100% любому, кто
 *    знает SQL, и «Старший IT-аудитор» обгонял бэкенд-вакансии;
 *  • роль — если она известна и не совпадает, оценка снижается: сильнее для
 *    другого направления, мягче для соседней роли того же направления. */
export function matchVacancies(r: ParsedResume, s: Store, opts: { countries: Country[]; remoteOnly: boolean }): Match[] {
  const pool = uniqueAds(s.vacancies.filter((v) => isActive(v, s) && opts.countries.includes(v.c) && (!opts.remoteOnly || v.f === "REMOTE")));
  const df = new Map<string, number>();
  for (const v of pool) for (const k of new Set(v.sk.map(skillKey))) df.set(k, (df.get(k) ?? 0) + 1);
  const idf = (k: string) => Math.log((pool.length + 1) / ((df.get(k) ?? 0) + 1));
  const idfs = [...df.keys()].map(idf).sort((a, b) => a - b);
  const prior = 2 * (idfs[Math.floor(idfs.length / 2)] ?? 4);
  const mine = new Set(r.skills);
  const myExp = r.experience ? EXP_ORDER.indexOf(r.experience) : -1;
  const myFamily = r.role ? s.overview.professions[r.role]?.family : null;
  const out: Match[] = [];
  for (const v of pool) {
    const req = [...new Set(v.sk.map(skillKey))];
    const matched = req.filter((k) => mine.has(k));
    const roleMatch = !!r.role && v.p === r.role;
    if (!matched.length && !roleMatch) continue;
    const total = req.reduce((acc, k) => acc + idf(k), 0);
    const cov = matched.reduce((acc, k) => acc + idf(k), 0) / (total + prior);
    const need = v.e ? EXP_ORDER.indexOf(v.e) : -1;
    const expFit = myExp < 0 || need < 0 ? 0.5 : need <= myExp ? (myExp - need > 1 ? 0.6 : 1) : 0;
    const roleFactor = !r.role || roleMatch ? 1 : v.p && s.overview.professions[v.p]?.family === myFamily ? 0.8 : 0.55;
    const score = (0.6 * cov + 0.25 * (roleMatch ? 1 : 0) + 0.15 * expFit) * roleFactor;
    out.push({ v, score, matched, missing: req.filter((k) => !mine.has(k)), roleMatch });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Чего не хватает: навыки, которые чаще всего требуют в подобранных
 *  вакансиях, но которых нет в резюме. Вес — оценка совпадения вакансии. */
export function skillGaps(matches: Match[], top = 40) {
  const m = new Map<string, number>();
  const best = matches.slice(0, top);
  for (const x of best) for (const k of x.missing) m.set(k, (m.get(k) ?? 0) + x.score);
  const sum = best.reduce((a, x) => a + x.score, 0) || 1;
  return [...m.entries()].map(([k, w]) => ({ key: k, weight: (100 * w) / sum })).sort((a, b) => b.weight - a.weight);
}

/** Пример резюме для демонстрации. Человек выдуман. */
export const SAMPLE_RESUME = `Аскар Примеров (пример, вымышленный человек)
Желаемая должность: Backend-разработчик Python
Алматы, готов к удалённой работе

Опыт работы — 4 года 2 месяца

Backend-разработчик, финтех-компания (2022 — по настоящее время)
Разработка микросервисов на Python и FastAPI, PostgreSQL, Redis, Docker.
Настройка CI/CD в GitLab, работа с Kafka и RabbitMQ, покрытие тестами (pytest).

Python-разработчик, веб-студия (2021 — 2022)
Django, REST API, PostgreSQL, Celery, Linux, Git.

Ключевые навыки: Python, Django, FastAPI, PostgreSQL, Redis, Docker, Git, Linux, REST API, SQL, RabbitMQ
Английский язык — B2, средне-продвинутый`;
