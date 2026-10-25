import { describe, expect, it } from "vitest";
import quantileCases from "../../../tests/quantile_cases.json";
import professionCases from "../../../tests/profession_cases.json";
import { kaplanMeier, percentileOf, quantile, quartiles } from "./stats";
import { guessProfession, normalizePdf, yearsToExperience } from "./resume";
import { estimate, uniqueAds, type Store } from "./store";
import type { Vacancy } from "./types";

// Эталоны посчитаны Python-ом (statistics.quantiles, method="inclusive") —
// тем же методом, что в выгрузке. Если TypeScript разойдётся, медианы на
// сайте перестанут совпадать с данными.
describe("квантили совпадают с Python", () => {
  for (const c of quantileCases as Array<{ values: number[]; p25: number; median: number; p75: number }>) {
    it(`[${c.values.join(", ")}]`, () => {
      const s = [...c.values].sort((a, b) => a - b);
      expect(quantile(s, 0.25)).toBeCloseTo(c.p25, 9);
      expect(quantile(s, 0.5)).toBeCloseTo(c.median, 9);
      expect(quantile(s, 0.75)).toBeCloseTo(c.p75, 9);
    });
  }
  it("меньше порога — квартилей нет", () => {
    expect(quartiles([1, 2, 3])).toBeNull();
  });
  it("процентиль: равные значения делятся пополам", () => {
    expect(percentileOf([1, 2, 3, 4], 2)).toBe(37.5);
  });
});

// Те же примеры, что в tests/test_profession.py: правила одни, проверка одна.
describe("профессия по заголовку — как в Python", () => {
  for (const [title, code] of professionCases.match as Array<[string, string]>) {
    it(`${title} → ${code}`, () => expect(guessProfession(title)).toBe(code));
  }
  for (const title of professionCases.none) {
    it(`«${title}» → не узнаём`, () => expect(guessProfession(title)).toBeNull());
  }
  it("кириллица с \\w работает (в JS \\w знает только латиницу)", () => {
    expect(guessProfession("Руководительница группы разработки")).toBe("dev_lead");
  });
});

describe("Каплан — Мейер", () => {
  it("без закрытий все открыты", () => {
    const km = kaplanMeier([[0, 10, false], [0, 10, false]], 10, 1);
    expect(km.curve.at(-1)!.open).toBe(1);
  });
  it("одна из двух закрылась на 5-й день — половина открыта", () => {
    const km = kaplanMeier([[0, 5, true], [0, 10, false]], 10, 1);
    expect(km.curve.find((p) => p.day === 5)!.open).toBeCloseTo(0.5);
  });
  it("отложенный вход: вакансия не считается под наблюдением до входа", () => {
    // вторая вакансия вошла в наблюдение только на 6-й день и не должна
    // разбавлять закрытие на 5-й
    const km = kaplanMeier([[0, 5, true], [6, 10, false]], 10, 1);
    expect(km.curve.find((p) => p.day === 5)!.open).toBe(0);
  });
});

describe("разбор резюме", () => {
  it("пробелы из PDF убираются, длинное тире остаётся", () => {
    expect(normalizePdf("Backend- разработчик , CI / CD (2022   —   2024)")).toBe("Backend-разработчик, CI/CD (2022 — 2024)");
  });
  it("годы опыта → категория hh", () => {
    expect(yearsToExperience(0)).toBe("noExperience");
    expect(yearsToExperience(2)).toBe("between1And3");
    expect(yearsToExperience(4)).toBe("between3And6");
    expect(yearsToExperience(9)).toBe("moreThan6");
  });
});

describe("оценка зарплаты по похожим", () => {
  const vac = (id: string, usd: number | null, ad = id): Vacancy => ({
    id, c: "kz", t: "Разработчик", p: "developer", e: "between3And6", f: "ON_SITE", emp: "e1", city: "Алматы", cg: "Алматы",
    wcity: null, sal: null, usd, sk: [], soft: [], lg: [], test: false, intern: false, letter: false, created: null,
    seg: [[0, 0]], ad, lat: null, lng: null, url: "",
  });
  const store = (list: Vacancy[]) => {
    const comps = new Map<string, Array<{ ad: string; usd: number }>>();
    for (const v of uniqueAds(list)) {
      if (!v.usd) continue;
      for (const k of [`${v.p}|${v.e}|${v.cg}`, `${v.p}|${v.e}|${v.c}`, `${v.p}||${v.c}`, `${v.p}|${v.e}|all`, `${v.p}||all`]) {
        (comps.get(k) ?? comps.set(k, []).get(k)!).push({ ad: v.ad, usd: v.usd });
      }
    }
    for (const a of comps.values()) a.sort((x, y) => x.usd - y.usd);
    return { comps } as unknown as Store;
  };

  it("сама вакансия исключается из группы похожих", () => {
    const list = Array.from({ length: 10 }, (_, i) => vac(`v${i}`, 1000 + i * 100));
    const target = vac("me", 99999);
    const e = estimate(target, store([...list, target]));
    expect(e!.n).toBe(10);
    expect(e!.values).not.toContain(99999);
  });
  it("меньше 10 похожих — оценки нет", () => {
    const list = Array.from({ length: 9 }, (_, i) => vac(`v${i}`, 1000));
    expect(estimate(vac("me", null), store(list))).toBeNull();
  });
  it("клоны одного объявления считаются один раз", () => {
    const clones = Array.from({ length: 12 }, (_, i) => vac(`c${i}`, 5000, "same-ad"));
    expect(estimate(vac("me", null), store(clones))).toBeNull();
  });
});
