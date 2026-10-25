import { useCallback, useEffect, useState } from "react";

/** Избранное: профессии, компании, навыки. Живёт только в браузере —
 *  без аккаунтов и сервера, поэтому ничего никуда не отправляется. */
export type WatchKind = "p" | "c" | "s";
export interface WatchItem { kind: WatchKind; id: string; label: string }
interface WatchState { items: WatchItem[]; seenDay: string | null }

const KEY = "talap-watch";
const EVENT = "talap-watch-change";

function read(): WatchState {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (v && Array.isArray(v.items)) return { items: v.items, seenDay: v.seenDay ?? null };
  } catch { /* приватный режим или повреждённые данные — начинаем с пустого */ }
  return { items: [], seenDay: null };
}
function write(s: WatchState) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* без памяти */ }
  window.dispatchEvent(new Event(EVENT));
}

export function useWatch() {
  const [state, setState] = useState<WatchState>(read);
  useEffect(() => {
    const on = () => setState(read());
    window.addEventListener(EVENT, on);
    window.addEventListener("storage", on);
    return () => { window.removeEventListener(EVENT, on); window.removeEventListener("storage", on); };
  }, []);
  const has = useCallback((kind: WatchKind, id: string) => state.items.some((i) => i.kind === kind && i.id === id), [state]);
  const toggle = useCallback((item: WatchItem) => {
    const cur = read();
    const exists = cur.items.some((i) => i.kind === item.kind && i.id === item.id);
    write({ ...cur, items: exists ? cur.items.filter((i) => !(i.kind === item.kind && i.id === item.id)) : [...cur.items, item] });
  }, []);
  /** Отметить, что пользователь видел данные по этот день. */
  const markSeen = useCallback((day: string) => { const cur = read(); if (cur.seenDay !== day) write({ ...cur, seenDay: day }); }, []);
  return { items: state.items, seenDay: state.seenDay, has, toggle, markSeen };
}
