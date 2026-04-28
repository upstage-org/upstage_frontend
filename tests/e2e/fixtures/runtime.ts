/**
 * Lightweight on-disk handoff between setup.spec.ts and perform.spec.ts.
 *
 *   {
 *     runId: "1716393831112-abcd",
 *     stageId: "42",
 *     stageSlug: "r-and-j-a1s1-1716393831112",
 *     stageUrl: "/r-and-j-a1s1-1716393831112",
 *     mediaByPersona: { romeo: { id: "31", name: "..." }, ... },
 *     props: { swords: { id: "..." }, edict: { ... } },
 *     backdrops: { ... },
 *     adminToken: "eyJ..."
 *   }
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface MediaRef {
  id: string;
  name: string;
}

export interface RuntimeState {
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
  writeFileSync(FILE, JSON.stringify(state, null, 2));
}

export function readRuntime(): RuntimeState {
  if (!existsSync(FILE)) {
    throw new Error(
      `[e2e] runtime.json missing at ${FILE} — run 'pnpm e2e:setup' first.`,
    );
  }
  return JSON.parse(readFileSync(FILE, "utf8")) as RuntimeState;
}
