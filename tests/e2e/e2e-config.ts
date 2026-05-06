/**
 * Single source for Playwright/e2e environment and defaults after `.env.test`
 * has been merged into `process.env`. Call {@link loadE2eDotenv} from each entry
 * file before importing modules that freeze env-dependent constants.
 */

import { config as dotenvLoad } from "dotenv";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Port Playwright waits on when it starts embedded Vite (`pnpm dev`) for e2e when
 * `E2E_BASE_URL` is not set.
 */
export const E2E_PLAYWRIGHT_VITE_PORT = 3000;

export interface E2eConfig {
  readonly envTestLoadedFrom: string | null;
  readonly baseUrl: string;
  readonly webServerStartsVite: boolean;
  readonly headless: boolean;
  readonly graphqlEndpoint: string;
  readonly mqttHost: string;
  readonly mqttWsPort: number;
  readonly adminUsername: string;
  readonly adminPassword: string;
  readonly playerPassword: string;
  readonly runIdExplicit: boolean;
  readonly runId: string | undefined;
  readonly forceFreshSetup: boolean;
  readonly beatsSmoke: boolean;
}

/**
 * Locate `upstage_frontend/.env.test` by walking upward from `import.meta.url`
 * directory (handles `tests/e2e/` and repo root playwright config alike).
 */
export function loadE2eDotenv(fromImportMetaUrl: string): string | null {
  if (process.env.__E2E_ENV_TEST_MERGED === "1") {
    return process.env.__E2E_ENV_TEST_PATH ?? null;
  }
  let dir = path.dirname(fileURLToPath(fromImportMetaUrl));
  let foundPath: string | null = null;
  for (let i = 0; i < 8; i += 1) {
    const candidate = path.join(dir, ".env.test");
    if (existsSync(candidate)) {
      dotenvLoad({ path: candidate });
      foundPath = candidate;
      process.env.__E2E_ENV_TEST_PATH = candidate;
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  process.env.__E2E_ENV_TEST_MERGED = "1";
  return foundPath;
}

function parsedBoolUnsetFalse(v: string | undefined): boolean {
  if (!v) return false;
  const x = v.trim().toLowerCase();
  return x !== "0" && x !== "false" && x !== "no" && x !== "off";
}

/** Lazy read of merged env — safe after {@link loadE2eDotenv} has run. */
export function loadE2eConfig(): E2eConfig {
  const explicitBaseUrl = process.env.E2E_BASE_URL?.trim();
  const ci = Boolean(process.env.CI);

  let baseUrl: string;
  let webServerStartsVite: boolean;

  if (explicitBaseUrl) {
    baseUrl = explicitBaseUrl;
    webServerStartsVite = false;
  } else {
    baseUrl = `http://127.0.0.1:${String(E2E_PLAYWRIGHT_VITE_PORT)}`;
    webServerStartsVite = true;
  }

  const headlessExplicit = process.env.PWHEADLESS;
  let headless: boolean;
  if (headlessExplicit !== undefined) {
    headless =
      headlessExplicit !== "0" && headlessExplicit.toLowerCase() !== "false";
  } else {
    headless = ci;
  }

  return {
    envTestLoadedFrom: process.env.__E2E_ENV_TEST_PATH ?? null,
    baseUrl,
    webServerStartsVite,
    headless,
    graphqlEndpoint:
      process.env.E2E_GRAPHQL_ENDPOINT ??
      "http://127.0.0.1:3001/api/studio_graphql",
    mqttHost: process.env.E2E_MQTT_HOST ?? "localhost",
    mqttWsPort: Number(process.env.E2E_MQTT_PORT ?? "9001"),
    adminUsername: process.env.E2E_ADMIN_USERNAME ?? "admin",
    adminPassword: process.env.E2E_ADMIN_PASSWORD ?? "12345678",
    playerPassword: process.env.E2E_PLAYER_PASSWORD ?? "e2e-pw",
    runIdExplicit: Boolean(process.env.E2E_RUN_ID),
    runId: process.env.E2E_RUN_ID,
    forceFreshSetup: parsedBoolUnsetFalse(process.env.E2E_FORCE_FRESH_SETUP),
    beatsSmoke:
      (process.env.E2E_BEATS ?? "").trim().toLowerCase() === "smoke",
  };
}

export function getE2eGraphQlEndpoint(): string {
  return loadE2eConfig().graphqlEndpoint;
}

export function maskSecret(value: string, visibleEnd = 0): string {
  if (!value) return "****";
  const tailChars = visibleEnd <= 0 ? 0 : Math.min(visibleEnd, value.length);
  const tail = tailChars ? value.slice(-tailChars) : "";
  const maskLen = Math.min(
    12,
    Math.max(4, value.length - tailChars),
  );
  return `${"*".repeat(maskLen)}${tail}`;
}

export function formatE2eConfigSummary(cfg: E2eConfig): string {
  const viteHint = cfg.webServerStartsVite
    ? `yes (embedded Vite on :${E2E_PLAYWRIGHT_VITE_PORT})`
    : `no — use E2E_BASE_URL for a server you start yourself (e.g. preview)`;
  const lines = [
    "E2E configuration (effective after `.env.test` merge)",
    "",
    `  · .env.test path     ${cfg.envTestLoadedFrom ?? "(not found on disk)"}`,
    `  · baseURL            ${cfg.baseUrl}`,
    `  · embedded Vite      ${viteHint}`,
    `  · headless           ${cfg.headless}`,
    `  · GraphQL (Studio)   ${cfg.graphqlEndpoint}`,
    `  · MQTT WS probe TCP  ${cfg.mqttHost}:${cfg.mqttWsPort} (broker plain TCP often 1883 internally)`,
    `  · admin user         ${cfg.adminUsername}`,
    `  · admin password     ${maskSecret(cfg.adminPassword, 2)}`,
    `  · player password    ${maskSecret(cfg.playerPassword)}`,
    `  · E2E_RUN_ID         ${cfg.runIdExplicit ? cfg.runId : "(unset — global-setup assigns)"}`,
    `  · force fresh setup  ${cfg.forceFreshSetup}`,
    `  · beats mode         ${cfg.beatsSmoke ? "smoke" : "full"}`,
    "",
  ];
  return lines.join("\n");
}
