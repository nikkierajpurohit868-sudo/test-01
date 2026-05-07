import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  // GitHub Pages 部署到 https://<user>.github.io/test-01/，base 必须匹配仓库名
  // 本地 dev 用相对根路径
  base: process.env.GITHUB_PAGES === "true" ? "/test-01/" : "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@ilp/schema": path.resolve(__dirname, "../../packages/schema/src/index.ts"),
    },
  },
  server: { port: 5173, host: true },
});
