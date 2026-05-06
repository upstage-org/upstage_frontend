import "./e2e-env-bootstrap";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

import { loadE2eConfig } from "./e2e-config";
import { forceFreshSetup } from "./fixtures/e2e-env";
import { readRuntimeOptional } from "./fixtures/runtime";
import { validateRuntimeStateForReuse } from "./fixtures/validate-runtime";
import { PERSONAS } from "./personas";
import { gql, loginAsAdmin } from "./graphql";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TCP_TIMEOUT_MS = 3_000;

function graphqlEndpointTcp(): { host: string; port: number; label: string } {
  const raw = loadE2eConfig().graphqlEndpoint;
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

export default async function globalSetup() {
  const e2eCfg = loadE2eConfig();
  const baseUrl = new URL(e2eCfg.baseUrl);
  const mqttHost = e2eCfg.mqttHost;
  const mqttPort = e2eCfg.mqttWsPort;

  // Fail fast with a clear message instead of waiting for browser timeouts.
  await probeTcp(
    baseUrl.hostname,
    Number(baseUrl.port || (baseUrl.protocol === "https:" ? 443 : 80)),
    "frontend (SPA on baseURL — embedded Vite :3000 unless E2E_BASE_URL points elsewhere)",
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
        "Continuing. Chat/avatar tests need MQTT (browser uses ws — external port often 9001; 1883 is internal TCP). See E2E_MQTT_HOST / E2E_MQTT_PORT.",
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

  // Hand off `runId` to setup.spec via env. Prefer a validated `runtime.json`
  // so local reruns reuse the same media names / stage slug unless
  // E2E_FORCE_FRESH_SETUP or the backend no longer matches the file.
  if (!process.env.E2E_RUN_ID) {
    let runId: string | undefined;
    if (!forceFreshSetup()) {
      const persisted = readRuntimeOptional();
      if (persisted) {
        try {
          const v = await validateRuntimeStateForReuse(persisted, adminToken);
          if (v.ok) {
            runId = persisted.runId;
            console.log(
              `[e2e] global-setup: reuse runId (${persisted.runId.slice(0, 12)}…) stage ${persisted.stageSlug}`,
            );
          } else {
            console.log(`[e2e] global-setup: new run — not reusing runtime.json (${v.reason})`);
          }
        } catch (e) {
          console.warn(
            `[e2e] global-setup: runtime validation threw — ${(e as Error).message}`,
          );
        }
      }
    } else {
      console.log("[e2e] global-setup: E2E_FORCE_FRESH_SETUP — skipping runtime.json reuse");
    }
    process.env.E2E_RUN_ID =
      runId ?? `${Date.now()}-${shortHash(String(process.pid))}`;
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
