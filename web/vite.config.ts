import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" — собранное приложение открывается с любого пути и как файл
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: { port: 5180, host: "127.0.0.1" },
  // pdf.js использует await верхнего уровня — нужна цель ES2022
  build: { target: "es2022" },
  optimizeDeps: { esbuildOptions: { target: "es2022" } },
});
