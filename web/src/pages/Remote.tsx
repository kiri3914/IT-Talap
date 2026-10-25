import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ScopeBar, scopeColor, useScope, useStore } from "../ctx";
import { ageDays, employerName, inScope, isActive, uniqueAds } from "../model/store";
import { premiumBy } from "../model/derive";
import { quartiles } from "../model/stats";
import { COUNTRY, IN_COUNTRY, dec1, int, nVac, pct, usd } from "../model/format";
import { HBars, Table, head, row } from "../charts/kit";
import type { Country, Vacancy } from "../model/types";

const remote = (v: Vacancy) => v.f === "REMOTE";
const hybrid = (v: Vacancy) => v.f === "HYBRID";
// Релокация определяется по координатам адреса, а не по названию города:
// названия расходятся из-за написания («Нур-Султан (Астана)») и пригородов
// («село Байсерке»), и такой признак ловил в основном шум.
const RELOCATION_KM = 300;
const REGION = [
  { lat: [40.5, 55.5], lng: [46.5, 87.4] }, // Казахстан
  { lat: [37.2, 45.6], lng: [56.0, 73.2] }, // Узбекистан
  { lat: [39.2, 43.3], lng: [69.2, 80.3] }, // Кыргызстан
];
const inRegion = (lat: number, lng: number) => REGION.some((b) => lat >= b.lat[0] && lat <= b.lat[1] && lng >= b.lng[0] && lng <= b.lng[1]);
function km(a: [number, number], b: [number, number]) {
  const r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
const med = (xs: number[]) => { const t = [...xs].sort((a, b) => a - b); return t[Math.floor(t.length / 2)]; };

export default function Remote() {
  const s = useStore();
  const [scope] = useScope();
  const color = scopeColor(scope);

  const d = useMemo(() => {
    const list = s.vacancies.filter(inScope(scope));
    const active = list.filter((v) => isActive(v, s));
    const ads = uniqueAds(list), aads = uniqueAds(active);
    const byProf = Object.keys(s.overview.professions).map((p) => {
      const pa = aads.filter((v) => v.p === p);
      return { p, n: pa.filter(remote).length, share: (100 * pa.filter(remote).length) / Math.max(pa.length, 1), total: pa.length };
    }).filter((x) => x.total >= 15).sort((a, b) => b.share - a.share);
    // центр города размещения — медиана координат его вакансий
    const pts = new Map<string, Array<[number, number]>>();
    for (const v of s.vacancies) if (v.city && v.lat != null && v.lng != null) (pts.get(v.city) ?? pts.set(v.city, []).get(v.city)!).push([v.lat, v.lng]);
    const center = new Map([...pts.entries()].filter(([, a]) => a.length >= 10).map(([c, a]) => [c, [med(a.map((x) => x[0])), med(a.map((x) => x[1]))] as [number, number]]));
    const reloc = ads.filter((v) => {
      if (v.lat == null || v.lng == null || !v.city || !center.has(v.city)) return false;
      return km([v.lat, v.lng], center.get(v.city)!) > RELOCATION_KM;
    });
    const abroad = reloc.filter((v) => !inRegion(v.lat!, v.lng!));
    const cities = new Map<string, number>();
    for (const v of abroad) if (v.wcity) cities.set(v.wcity, (cities.get(v.wcity) ?? 0) + 1);
    return {
      remoteShare: (100 * aads.filter(remote).length) / Math.max(aads.length, 1),
      hybridShare: (100 * aads.filter(hybrid).length) / Math.max(aads.length, 1),
      remoteOpen: aads.filter(remote),
      prem: premiumBy(remote, list),
      byProf,
      byCountry: (["kz", "uz", "kg"] as Country[]).map((c) => {
        const ca = uniqueAds(s.vacancies.filter((v) => v.c === c && isActive(v, s)));
        return { c, remote: (100 * ca.filter(remote).length) / Math.max(ca.length, 1), hybrid: (100 * ca.filter(hybrid).length) / Math.max(ca.length, 1) };
      }),
      remoteQ: quartiles(ads.filter(remote).map((v) => v.usd).filter((x): x is number => !!x)),
      reloc, abroad, relocQ: quartiles(abroad.map((v) => v.usd).filter((x): x is number => !!x), 5),
      cities: [...cities.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
    };
  }, [s, scope]);

  return (
    <>
      <ScopeBar />
      <main className="wrap">
        <p className="eyebrow">Формат работы</p>
        <h1 className="page-title">Удалёнка и релокация</h1>
        <p className="lede">
          {IN_COUNTRY[scope][0].toUpperCase() + IN_COUNTRY[scope].slice(1)} удалённо можно работать в <b>{pct(d.remoteShare)}</b> открытых IT-вакансий, в гибридном формате — в <b>{pct(d.hybridShare)}</b>. Остальное — офис.
          {d.prem && <> При той же роли и опыте удалённые вакансии предлагают на <b>{d.prem.pct >= 0 ? "" : "−"}{dec1(Math.abs(d.prem.pct))}%</b> {d.prem.pct >= 0 ? "больше" : "меньше"}.</>}
        </p>

        <section className="block">
          <p className="eyebrow">Где можно удалённо</p>
          <h2>{d.byProf[0] ? `Чаще всего — «${s.overview.professions[d.byProf[0].p]?.title}»: ${pct(d.byProf[0].share)}` : "По профессиям"}</h2>
          <div className="two" style={{ marginTop: 8 }}>
            <figure>
              <h3 className="sub">Доля удалённых среди открытых</h3>
              <div style={{ marginTop: 12 }}>
                <HBars color={color} label="Удалёнка по профессиям" labelW={230}
                  rows={d.byProf.slice(0, 14).map((x) => ({ key: x.p, label: s.overview.professions[x.p]?.title ?? x.p, value: x.share, display: pct(x.share), href: `/p/${x.p}`,
                    tip: () => head(s.overview.professions[x.p]?.title ?? x.p) + row("Удалённых", int(x.n)) + row("Открыто всего", int(x.total)) }))} />
              </div>
            </figure>
            <figure>
              <h3 className="sub">По странам</h3>
              <Table head={["Страна", "Удалённо", "Гибрид"]} rows={d.byCountry.map((r) => [COUNTRY[r.c], pct(r.remote), pct(r.hybrid)])} />
              {d.remoteQ && <p className="dek" style={{ marginTop: 16 }}>Медианная зарплата в удалённых вакансиях — <b>{usd(d.remoteQ.median)}</b>, половина предлагает {usd(d.remoteQ.p25)}–{usd(d.remoteQ.p75)}.</p>}
            </figure>
          </div>
        </section>

        <section className="block">
          <p className="eyebrow">Релокация</p>
          <h2>{nVac(d.abroad.length)} с работой за рубежом</h2>
          <p className="dek">
            Объявление висит в Алматы или Ташкенте, а адрес работы — в Лимассоле или Тбилиси. Считаем по координатам адреса: дальше {RELOCATION_KM} км от города
            размещения и за пределами трёх стран. Ещё {int(d.reloc.length - d.abroad.length)} — переезд в другой город внутри региона.
            {d.relocQ && <> Медиана зарплаты в вакансиях за рубежом — <b>{usd(d.relocQ.median)}</b>.</>}
          </p>
          <div className="two" style={{ marginTop: 8 }}>
            <figure>
              <h3 className="sub">Куда предлагают ехать</h3>
              <div style={{ marginTop: 12 }}>
                <HBars color={color} label="Города работы" labelW={170} rows={d.cities.map(([c, n]) => ({ key: c, label: c, value: n, display: int(n) }))} />
              </div>
            </figure>
            <figure>
              <h3 className="sub">Вакансии</h3>
              <Table head={["Вакансия", "Работа в", "Зарплата"]}
                rows={[...d.abroad].sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0)).slice(0, 14).map((v) => [<Link to={`/v/${v.id}`}>{v.t}</Link>, v.wcity ?? "", v.usd ? usd(v.usd) : "—"])} />
            </figure>
          </div>
        </section>

        <section className="block">
          <p className="eyebrow">Открыто сейчас</p>
          <h2>{nVac(d.remoteOpen.length)} на удалёнке</h2>
          <figure>
            <Table head={["Вакансия", "Компания", "Страна", "Зарплата", "Висит"]}
              rows={[...d.remoteOpen].sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0)).slice(0, 40).map((v) => {
                const age = ageDays(v, s);
                return [<Link to={`/v/${v.id}`}>{v.t}</Link>, employerName(v.emp, s), COUNTRY[v.c], v.usd ? usd(v.usd) : "—", age != null ? `${int(age)} дн.` : "—"];
              })} />
          </figure>
        </section>
      </main>
    </>
  );
}
