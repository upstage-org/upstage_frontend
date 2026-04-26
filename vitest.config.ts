import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      globals: true,
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      include: ["src/**/*.{test,spec}.{ts,js}"],
      exclude: ["node_modules", "dist", "tests/e2e/**"],
      coverage: {
        provider: "v8",
        reporter: ["text", "html"],
        exclude: [
          "node_modules/",
          "src/test/",
          "**/*.d.ts",
          "**/*.config.*",
          "src/**/__generated__/**",
        ],
      },
    },
  }),
);
