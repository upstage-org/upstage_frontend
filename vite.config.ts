import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tsconfigPaths from "vite-tsconfig-paths";
import Components from "unplugin-vue-components/vite";
import AutoImport from "unplugin-auto-import/vite";
import VueDevTools from "vite-plugin-vue-devtools";
import { AntDesignVueResolver } from "unplugin-vue-components/resolvers";

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
    // Same-origin /api/... in the browser (Apollo + e2e page.evaluate) — avoids
    // CORS when the studio API is on a different port than Vite.
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
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
