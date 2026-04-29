import { config as loadEnv } from "dotenv";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(__dirname, "..", ".env.test") });

import { PERSONAS } from "./personas";
import { gql, loginAsAdmin } from "./graphql";

const TCP_TIMEOUT_MS = 3_000;

/** Parsed from `E2E_GRAPHQL_ENDPOINT` — Studio listens here from Node (global-setup / graphql.ts). */
function graphqlEndpointTcp(): { host: string; port: number; label: string } {
  const raw =
    process.env.E2E_GRAPHQL_ENDPOINT ?? "http://127.0.0.1:3001/api/studio_graphql";
  const u = new URL(raw);
  const port = Number(u.port || (u.protocol === "https:" ? 443 : 80));
  return {
    host: u.hostname,
    port,
    label: `Studio GraphQL (${raw})`,
  };
}

function probeTcp(host: string, port: number, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const onError = (err: Error) =>
      reject(new Error(`[e2e] ${label} TCP ${host}:${port} unreachable — ${err.message}`));
    socket.setTimeout(TCP_TIMEOUT_MS);
    socket.once("error", onError);
    socket.once("timeout", () => onError(new Error("timeout")));
    socket.connect(port, host, () => {
      socket.end();
      resolve();
    });
  });
}

function shortHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i += 1) h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

const DEFAULT_E2E_BASE = "http://localhost:3000";

export default async function globalSetup() {
  // Keep defaults in sync with playwright.config.ts (Vite `pnpm dev` on 3000).
  const baseUrl = new URL(process.env.E2E_BASE_URL ?? DEFAULT_E2E_BASE);
  const mqttHost = process.env.E2E_MQTT_HOST ?? "localhost";
  const mqttPort = Number(process.env.E2E_MQTT_PORT ?? "2087");

  // Fail fast with a clear message instead of waiting for browser timeouts.
  await probeTcp(
    baseUrl.hostname,
    Number(baseUrl.port || (baseUrl.protocol === "https:" ? 443 : 80)),
    "frontend (Vite or reverse proxy for E2E_BASE_URL)",
  );

  const gqlTcp = graphqlEndpointTcp();
  await probeTcp(gqlTcp.host, gqlTcp.port, gqlTcp.label);

  // Live `loadStage` and Preloader are GraphQL-driven; MQTT is for realtime sync.
  // Do not fail the whole run if the broker is down — @full/perform will surface it.
  try {
    await probeTcp(mqttHost, mqttPort, "mosquitto (MQTT WS)");
  } catch (e) {
    console.warn(
      `[e2e] MQTT not reachable at ${mqttHost}:${mqttPort} — ${(e as Error).message}. ` +
        "Continuing. Chat/avatar tests need MQTT; see E2E_MQTT_HOST / E2E_MQTT_PORT.",
    );
  }

  const adminToken = await loginAsAdmin();

  // Idempotent: query existing usernames first, then batch-create only the
  // missing ones. The backend's batchUserCreation rejects duplicates, so we
  // can't just spam it on every run.
  const existing = await gql<{ users: Array<{ username: string }> }>(
    `query Users { users(active: true) { username } }`,
    {},
    adminToken,
  );
  const known = new Set(
    (existing.data?.users ?? []).map((u) => u.username.toLowerCase()),
  );
  const missing = PERSONAS.filter((p) => !known.has(p.username.toLowerCase()));

  if (missing.length === 0) {
    console.log(
      `[e2e] global-setup: all ${PERSONAS.length} player accounts already exist — nothing to do.`,
    );
  } else {
    const result = await gql<{
      batchUserCreation: { users: Array<{ username: string }> };
    }>(
      `mutation BatchCreate($users: [BatchUserInput]!) {
         batchUserCreation(users: $users) {
           users { username }
         }
       }`,
      {
        users: missing.map((p) => ({
          username: p.username,
          password: p.password,
          email: p.email,
        })),
      },
      adminToken,
    );
    if (result.errors?.length) {
      const safeUsers = missing.map((p) => ({
        username: p.username,
        email: p.email,
        passwordLength: p.password.length,
      }));
      const diag = {
        when: new Date().toISOString(),
        graphqlErrors: result.errors,
        graphqlData: result.data,
        payload: safeUsers,
      };
      const diagPath = path.join(__dirname, "..", "test-results", "global-setup-error.json");
      try {
        const fs = await import("node:fs");
        fs.mkdirSync(path.dirname(diagPath), { recursive: true });
        fs.writeFileSync(diagPath, JSON.stringify(diag, null, 2));
      } catch {
        // best-effort; diag still appears in the thrown message below
      }
      // Print the full payload to stderr so it can't be truncated by reporters.
      console.error("[e2e] batchUserCreation diagnostics:", JSON.stringify(diag, null, 2));
      throw new Error(
        `[e2e] batchUserCreation failed (full diagnostics at ${diagPath}): ${JSON.stringify(result.errors)}`,
      );
    }
    const created = result.data?.batchUserCreation?.users.map((u) => u.username) ?? [];
    console.log(
      `[e2e] global-setup: created ${created.length} player accounts: ${created.join(", ")}`,
    );
  }

  // Hand off `runId` and admin token to the specs via env.
  // Using the wallclock + pid keeps it unique per run; specs also accept
  // E2E_RUN_ID to allow rerunning perform against an already-set-up stage.
  if (!process.env.E2E_RUN_ID) {
    const runId = `${Date.now()}-${shortHash(String(process.pid))}`;
    process.env.E2E_RUN_ID = runId;
  }
  process.env.E2E_ADMIN_TOKEN = adminToken;

  // Heads-up if portraits aren't present — surfaces the right error before any
  // browser context spins up.
  const portraitsDir = path.join(__dirname, "assets", "portraits");
  const samplePortrait = path.join(portraitsDir, "romeo.png");
  if (!existsSync(samplePortrait)) {
    console.warn(
      `[e2e] WARNING: ${samplePortrait} missing — run 'pnpm e2e:assets' first.`,
    );
  }
}
