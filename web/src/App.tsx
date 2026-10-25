import { useEffect, useMemo, useState, type ReactNode } from "react";
import { HashRouter, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { loadStore, type Store } from "./model/store";
import { DataCtx, ScopeCtx, readScope } from "./ctx";
import type { Scope } from "./model/types";
import { hideTip } from "./charts/kit";
import { Search } from "./components/Search";
import Home from "./pages/Home";
import Vacancy from "./pages/Vacancy";
import Profession from "./pages/Profession";
import Professions from "./pages/Professions";
import Company from "./pages/Company";
import Companies from "./pages/Companies";
import Skills from "./pages/Skills";
import Skill from "./pages/Skill";
import Calculator from "./pages/Calculator";
import Market from "./pages/Market";
import Method from "./pages/Method";

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
            <NavLink to="/" end>Главная</NavLink>
            <NavLink to="/m">Рынок</NavLink>
            <NavLink to="/p">Профессии</NavLink>
            <NavLink to="/c">Компании</NavLink>
            <NavLink to="/s">Навыки</NavLink>
            <NavLink to="/calc">Калькулятор</NavLink>
            <NavLink to="/method">Методология</NavLink>
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
              <Route path="/s" element={<Skills />} />
              <Route path="/s/:key" element={<Skill />} />
              <Route path="/calc" element={<Calculator />} />
              <Route path="/m" element={<Market />} />
              <Route path="/method" element={<Method />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Layout>
        </HashRouter>
      </ScopeCtx.Provider>
    </DataCtx.Provider>
  );
}
