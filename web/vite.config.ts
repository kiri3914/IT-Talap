import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" — собранное приложение открывается с любого пути и как файл
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: { port: 5180, host: "127.0.0.1" },
});
