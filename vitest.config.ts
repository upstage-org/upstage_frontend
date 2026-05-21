import { defineConfig, mergeConfig } from "vitest/config";
import type { UserConfig } from "vite";
import viteBase from "./vite.config";

type ViteExport = UserConfig | Promise<UserConfig> | undefined;

export default defineConfig(async (env) => {
  const resolved: ViteExport =
    typeof viteBase === "function" ? await viteBase(env) : await Promise.resolve(viteBase);
  return mergeConfig(
    resolved ?? {},
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
});
