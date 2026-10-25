const nf0 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dayLong = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" });
const dayShort = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });

export const int = (v: number) => nf0.format(Math.round(v));
export const usd = (v: number) => "$" + int(v);
export const pct = (v: number) => nf1.format(v) + "%";
export const pct0 = (v: number) => int(v) + "%";
export const dec1 = (v: number) => nf1.format(v);
export const kUsd = (v: number) => (v >= 1000 ? "$" + nf1.format(v / 1000).replace(",0", "") + "k" : usd(v));

export const toDate = (s: string) => new Date(s + "T12:00:00");
export const fmtDay = (s: string) => dayLong.format(toDate(s));
export const fmtDayShort = (s: string) => dayShort.format(toDate(s)).replace(".", "");

export function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}
export const nVac = (n: number) => `${int(n)} ${plural(n, "вакансия", "вакансии", "вакансий")}`;
export const nDays = (n: number) => `${int(n)} ${plural(n, "день", "дня", "дней")}`;

const CURRENCY_SIGN: Record<string, string> = { KZT: "₸", UZS: "сум", KGS: "сом", USD: "$", RUB: "₽", RUR: "₽", EUR: "€" };

/** Вилка в валюте оригинала: «от 400 000 до 600 000 ₸». */
export function salaryText(from: number | null, to: number | null, cur: string | null) {
  const sign = cur ? CURRENCY_SIGN[cur] ?? cur : "";
  if (from && to) return `${int(from)} – ${int(to)} ${sign}`;
  if (from) return `от ${int(from)} ${sign}`;
  if (to) return `до ${int(to)} ${sign}`;
  return "не указана";
}

export const COUNTRY: Record<string, string> = { all: "Все страны", kz: "Казахстан", uz: "Узбекистан", kg: "Кыргызстан" };
export const IN_COUNTRY: Record<string, string> = { all: "в трёх странах", kz: "в Казахстане", uz: "в Узбекистане", kg: "в Кыргызстане" };

export function cityGroupLabel(cg: string) {
  if (cg.startsWith("other_")) return { other_kz: "другие города Казахстана", other_uz: "другие города Узбекистана", other_kg: "другие города Кыргызстана" }[cg] ?? cg;
  return cg;
}
