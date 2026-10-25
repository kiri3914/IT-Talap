import { Component, type ErrorInfo, type ReactNode } from "react";

/** Ошибка на одной странице не должна оставлять пустой экран: показываем,
 *  что случилось, а шапка и навигация продолжают работать. Сброс — при смене
 *  адреса (key на маршруте). */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Страница упала:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="wrap">
        <p className="eyebrow">Ошибка</p>
        <h1 className="page-title">Эта страница не смогла построиться</h1>
        <p className="lede">Остальные разделы работают — выберите другой в меню. Текст ошибки для разработчиков:</p>
        <pre style={{ marginTop: 16, overflowX: "auto", fontSize: "0.8125rem", color: "var(--ink-2)" }}>{String(this.state.error.message || this.state.error)}</pre>
      </main>
    );
  }
}
