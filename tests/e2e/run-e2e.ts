#!/usr/bin/env node
/**
 * Entry for `pnpm e2e*` scripts: merges `.env.test`, prints resolved config,
 * and (interactive only) waits for confirmation before invoking Playwright.
 */

import "./e2e-env-bootstrap";
import { spawnSync } from "node:child_process";
import { platform } from "node:os";
import { createInterface } from "node:readline/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  formatE2eConfigSummary,
  loadE2eConfig,
} from "./e2e-config";

async function promptContinue(): Promise<boolean> {
  if (process.env.CI) return true;
  if (process.env.E2E_SKIP_CONFIRM === "1") return true;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log(
      "[e2e] non-interactive session — skipping confirm (set CI=1 or E2E_SKIP_CONFIRM=1 explicitly if intended).",
    );
    return true;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (
      await rl.question("Proceed with Playwright using the settings above? [y/N] ")
    )
      .trim()
      .toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

const frontendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const cfg = loadE2eConfig();
console.log("");
console.log(formatE2eConfigSummary(cfg));

const proceed = await promptContinue();
if (!proceed) {
  console.error("[e2e] Aborted by user.");
  process.exitCode = 130;
  process.exit(process.exitCode);
}

const passArgs =
  process.argv.slice(2).length > 0 ? process.argv.slice(2) : ["test"];

const result = spawnSync("pnpm", ["exec", "playwright", ...passArgs], {
    cwd: frontendRoot,
    stdio: "inherit",
    env: process.env,
    shell: platform() === "win32",
  });

process.exit(typeof result.status === "number" ? result.status : 1);
