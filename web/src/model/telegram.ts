import type { Store } from "./store";
import type { Scope, TgPost } from "./types";
import { quartiles } from "./stats";

/** Посты за последние N дней — по дате публикации, а не сбора (data_notes §10). */
export function recentPosts(s: Store, days: number, scope: Scope, prof?: string): TgPost[] {
  const last = Date.parse(s.days[s.lastIx]);
  const from = new Date(last - days * 86400000).toISOString().slice(0, 10);
  return s.telegram.filter((p) => p[6] >= from && (scope === "all" || p[1] === scope) && (!prof || p[4] === prof));
}

/** Сводка по постам: сколько, доля с вилкой, медиана в долларах. */
export function postStats(posts: TgPost[]) {
  return {
    n: posts.length,
    disclosed: posts.length ? (100 * posts.filter((p) => p[3]).length) / posts.length : 0,
    salary: quartiles(posts.map((p) => p[9]).filter((x): x is number => !!x)),
  };
}
