import { defineConfig } from "vite";

// C 只调用 HTTP，不再解析、抽取 B 源代码。部署 dist 时也需要 /api 反向代理。
export default defineConfig({
  server: {
    host: "127.0.0.1",
    proxy: { "/api": { target: "http://127.0.0.1:3001", changeOrigin: true, timeout: 210000 } }
  }
});
