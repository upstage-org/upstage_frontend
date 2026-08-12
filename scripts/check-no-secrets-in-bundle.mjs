#!/usr/bin/env node
/**
 * Fail the build if a broker credential ends up in the public bundle.
 *
 * The MQTT password used to be a `VITE_MQTT_PASSWORD` build-time variable, so
 * Vite inlined it as a literal string into dist/assets/*.js — served
 * unauthenticated to every visitor. Credentials now arrive at runtime on the
 * GraphQL `Stage.mqtt` field instead. This guard is what stops that quietly
 * regressing: reintroducing any `import.meta.env.VITE_MQTT_PASSWORD` reference
 * (even inside a branch that never executes — Vite substitutes textually) puts
 * the secret straight back into the bundle.
 *
 * Runs automatically after `pnpm build` / `pnpm build:dev`.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const DIST = join(process.cwd(), "dist");

// Any of these appearing in built output means a secret was inlined.
const FORBIDDEN_ENV_KEYS = ["VITE_MQTT_PASSWORD", "VITE_MQTT_USERNAME"];

// Values to scan for, taken from the environment so the real secret never has
// to be committed here. The deploy/CI runner can export MQTT_PASSWORD (and
// optionally the previous one during a rotation) to get value-level checking;
// with neither set we still catch the variable-name case above.
const FORBIDDEN_VALUES = [process.env.MQTT_PASSWORD, process.env.MQTT_PASSWORD_PREVIOUS]
  .filter(Boolean)
  // Ignore trivially short values — too easy to match by chance.
  .filter((v) => v.length >= 8);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(js|mjs|cjs|css|map|html)$/.test(entry.name)) out.push(full);
  }
  return out;
}

if (!existsSync(DIST)) {
  console.error(`[secret-scan] No dist/ directory at ${DIST} — run the build first.`);
  process.exit(1);
}

const findings = [];
for (const file of walk(DIST)) {
  const text = readFileSync(file, "utf8");
  for (const key of FORBIDDEN_ENV_KEYS) {
    if (text.includes(key)) findings.push(`${file}: contains the string "${key}"`);
  }
  for (const value of FORBIDDEN_VALUES) {
    if (text.includes(value)) findings.push(`${file}: contains a known broker password`);
  }
}

if (findings.length > 0) {
  console.error("\n[secret-scan] FAILED — broker credentials found in the built bundle:\n");
  for (const f of findings) console.error(`  ${f}`);
  console.error(
    "\nBroker credentials must never be bundled. They are served at runtime on the\n" +
      "GraphQL `Stage.mqtt` field and passed to mqtt.connect(credentials). Remove any\n" +
      "`import.meta.env.VITE_MQTT_*` credential reference — including fallbacks, which\n" +
      "Vite inlines whether or not the branch executes.\n",
  );
  process.exit(1);
}

const scope = FORBIDDEN_VALUES.length
  ? "variable names and known password values"
  : "variable names (set MQTT_PASSWORD in the environment to also scan for the value)";
console.log(`[secret-scan] OK — no broker credentials in dist/ (checked ${scope}).`);
