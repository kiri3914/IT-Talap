import { createContext, useContext } from "react";
import type { Store } from "./model/store";
import type { Scope } from "./model/types";
import { COUNTRY, fmtDay } from "./model/format";

// Контексты живут отдельно от App.tsx: иначе горячая перезагрузка каркаса
// пересоздаёт их, и открытые страницы теряют данные.

// ---------- данные ----------

export const DataCtx = createContext<Store | null>(null);
export function useStore(): Store {
  const s = useContext(DataCtx);
  if (!s) throw new Error("Store не загружен");
  return s;
}

// ---------- страна ----------

export const ScopeCtx = createContext<[Scope, (s: Scope) => void]>(["all", () => {}]);
export const useScope = () => useContext(ScopeCtx);
export const scopeColor = (s: Scope | string) => `var(--${s})`;

export function readScope(): Scope {
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

