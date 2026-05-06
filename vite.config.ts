import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tsconfigPaths from "vite-tsconfig-paths";
import Components from "unplugin-vue-components/vite";
import AutoImport from "unplugin-auto-import/vite";
import VueDevTools from "vite-plugin-vue-devtools";
import { AntDesignVueResolver } from "unplugin-vue-components/resolvers";

/** Studio REST/GraphQL for same-origin `/api` in dev and dockerized `pnpm preview`. */
const studioApiTarget =
  process.env.VITE_STUDIO_API_PROXY ?? "http://127.0.0.1:3001";

/** Port for `vite preview` (e.g. `FRONTEND_PORT` from docker-compose.dev). */
const previewPort = Number(process.env.FRONTEND_PORT) || 4173;

export default defineConfig({
  base: "/",
  plugins: [
    vue(),
    VueDevTools(),
    tsconfigPaths(),
    AutoImport({
      imports: [
        "vue",
        "vue-router",
        "pinia",
        "@vueuse/core",
        { "vue-i18n": ["useI18n"] },
        { vuex: ["useStore"] },
      ],
      dts: "src/auto-imports.d.ts",
      eslintrc: { enabled: true },
    }),
    Components({
      resolvers: [
        AntDesignVueResolver({ importStyle: "less", resolveIcons: true }),
      ],
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    fs: {
      allow: [".."],
    },
    proxy: {
      "/api": {
        target: studioApiTarget,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: previewPort,
    strictPort: true,
    proxy: {
      "/api": {
        target: studioApiTarget,
        changeOrigin: true,
      },
    },
  },
  css: {
    preprocessorOptions: {
      less: {
        javascriptEnabled: true,
      },
    },
  },
});
