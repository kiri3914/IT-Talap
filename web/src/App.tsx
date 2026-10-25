import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { HashRouter, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { loadStore, type Store } from "./model/store";
import type { Scope } from "./model/types";
import { COUNTRY, fmtDay } from "./model/format";
import { hideTip } from "./charts/kit";
import { Search } from "./components/Search";
import Home from "./pages/Home";
import Vacancy from "./pages/Vacancy";
import Profession from "./pages/Profession";
import Professions from "./pages/Professions";
import Company from "./pages/Company";
import Companies from "./pages/Companies";

// ---------- данные ----------

const DataCtx = createContext<Store | null>(null);
export function useStore(): Store {
  const s = useContext(DataCtx);
  if (!s) throw new Error("Store не загружен");
  return s;
}

// ---------- страна ----------

const ScopeCtx = createContext<[Scope, (s: Scope) => void]>(["all", () => {}]);
export const useScope = () => useContext(ScopeCtx);
export const scopeColor = (s: Scope | string) => `var(--${s})`;

function readScope(): Scope {
  try {
    const v = localStorage.getItem("talap-scope");
    if (v && v in COUNTRY) return v as Scope;
  } catch { /* приватный режим — просто без памяти */ }
  return "all";
}

export function ScopeBar() {
  const [scope, setScope] = useScope();
  const s = useStore();
  return (
    <div className="scopebar">
      <div className="wrap">
        <span className="label" id="scope-label">Страна</span>
        <div className="seg" role="group" aria-labelledby="scope-label">
          {(Object.keys(COUNTRY) as Scope[]).map((c) => (
            <button key={c} type="button" id={`scope-${c}`} aria-pressed={c === scope} onClick={() => setScope(c)}>
              <i className="dot" style={{ ["--c" as string]: scopeColor(c) }} />
              {c === "all" ? "Все" : COUNTRY[c]}
            </button>
          ))}
        </div>
        <span className="updated">Данные на {fmtDay(s.days[s.lastIx])}</span>
      </div>
    </div>
  );
}

// ---------- каркас ----------

function Layout({ children }: { children: ReactNode }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => { window.scrollTo(0, 0); hideTip(); }, [loc.pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setSearchOpen((o) => !o); }
      if (e.key === "/" && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); setSearchOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <>
      <header className="top">
        <div className="wrap">
          <NavLink to="/" className="logo">Талап</NavLink>
          <nav className="mainnav" aria-label="Разделы">
            <NavLink to="/" end>Обзор</NavLink>
            <NavLink to="/p">Профессии</NavLink>
            <NavLink to="/c">Компании</NavLink>
          </nav>
          <button type="button" className="searchbtn" onClick={() => setSearchOpen(true)}>
            Поиск или ссылка на вакансию <kbd>⌘K</kbd>
          </button>
          <span className="private" title="Данные по отдельным вакансиям. Публикация — после разрешения hh.">не для публикации</span>
        </div>
      </header>
      {children}
      <footer className="foot">
        <div className="wrap">Талап — внутренняя версия. Данные hh используются по условиям API для собственных нужд; публикация — после разрешения hh.</div>
      </footer>
      {searchOpen && <Search onClose={() => setSearchOpen(false)} />}
    </>
  );
}

function NotFound() {
  const nav = useNavigate();
  return (
    <main className="wrap">
      <h1 className="page-title">Такой страницы нет</h1>
      <p className="lede">Возможно, ссылка устарела. <button className="btn ghost" onClick={() => nav("/")}>На главную</button></p>
    </main>
  );
}

export default function App() {
  const [store, setStore] = useState<Store | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScopeState] = useState<Scope>(readScope);
  const setScope = (s: Scope) => {
    setScopeState(s);
    try { localStorage.setItem("talap-scope", s); } catch { /* без памяти */ }
  };
  useEffect(() => { loadStore().then(setStore).catch((e) => setError(String(e.message ?? e))); }, []);
  const scopeValue = useMemo<[Scope, (s: Scope) => void]>(() => [scope, setScope], [scope]);

  if (error) {
    return (
      <main className="wrap">
        <h1 className="page-title">Нет данных</h1>
        <p className="lede">{error}</p>
        <pre style={{ marginTop: 20, overflowX: "auto" }}>.venv/bin/python -m scripts.export_app_data --out web/public/data</pre>
      </main>
    );
  }
  if (!store) return <main className="wrap"><p className="lede">Загружаем данные…</p></main>;

  return (
    <DataCtx.Provider value={store}>
      <ScopeCtx.Provider value={scopeValue}>
        <HashRouter>
          <Layout>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/v/:id" element={<Vacancy />} />
              <Route path="/p" element={<Professions />} />
              <Route path="/p/:code" element={<Profession />} />
              <Route path="/c" element={<Companies />} />
              <Route path="/c/:id" element={<Company />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Layout>
        </HashRouter>
      </ScopeCtx.Provider>
    </DataCtx.Provider>
  );
}
