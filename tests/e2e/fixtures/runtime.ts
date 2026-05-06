/**
 * Lightweight on-disk handoff between setup.spec.ts and perform.spec.ts.
 *
 *   {
 *     schemaVersion: 2,
 *     graphqlEndpoint: "http://127.0.0.1:3001/api/studio_graphql",
 *     runId: "1716393831112-abcd",
 *     stageId: "42",
 *     stageSlug: "r-and-j-a1s1-1716393831112",
 *     stageUrl: "/r-and-j-a1s1-1716393831112",
 *     mediaByPersona: { romeo: { id: "31", name: "..." }, ... },
 *     props: { swords: { id: "..." }, edict: { ... } },
 *     backdrops: { ... },
 *     adminToken: "eyJ...",
 *     lastValidatedAt: "..."
 *   }
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getE2eGraphQlEndpoint } from "../graphql";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface MediaRef {
  id: string;
  name: string;
}

/** Bump when required `runtime.json` fields or validation rules change. */
export const RUNTIME_SCHEMA_VERSION = 2;

export interface RuntimeState {
  schemaVersion?: number;
  /** Normalized `E2E_GRAPHQL_ENDPOINT` used when this file was written. */
  graphqlEndpoint?: string;
  lastValidatedAt?: string;
  runId: string;
  stageId: string;
  stageSlug: string;
  stageUrl: string;
  mediaByPersona: Record<string, MediaRef>;
  props: Record<string, MediaRef>;
  backdrops: Record<string, MediaRef>;
  adminToken: string;
  timestamp: string;
}

const FILE = path.join(__dirname, "..", "runtime.json");

export function writeRuntime(state: RuntimeState): void {
  mkdirSync(path.dirname(FILE), { recursive: true });
  const enriched: RuntimeState = {
    ...state,
    schemaVersion: RUNTIME_SCHEMA_VERSION,
    graphqlEndpoint: getE2eGraphQlEndpoint(),
  };
  writeFileSync(FILE, JSON.stringify(enriched, null, 2));
}

export function readRuntimeOptional(): RuntimeState | null {
  if (!existsSync(FILE)) return null;
  try {
    return JSON.parse(readFileSync(FILE, "utf8")) as RuntimeState;
  } catch {
    return null;
  }
}

/** Remove persisted handoff (e.g. `E2E_FORCE_FRESH_SETUP`). */
export function clearRuntimeFile(): void {
  if (existsSync(FILE)) unlinkSync(FILE);
}

export function readRuntime(): RuntimeState {
  if (!existsSync(FILE)) {
    throw new Error(
      `[e2e] runtime.json missing at ${FILE} — run 'pnpm e2e:setup' first.`,
    );
  }
  return JSON.parse(readFileSync(FILE, "utf8")) as RuntimeState;
}
