// Writes public/version.json — the server-side half of the "new version
// available, please reload" check (see src/utils/buildVersion.ts and App.vue).
//
//   { "version": "2026.08.22-013314", "builtAt": "2026-08-22T01:33:14.000Z" }
//
// vite.config.ts bakes the SAME two values into the bundle at build time, so a
// running page knows exactly which build it is and can compare it against
// what the server currently serves. Regenerated on every build (wired into
// the `build` / `build:dev` scripts) — deliberately no git access:
//   1. UPSTAGE_BUILD_VERSION env var, set by run_front_end_*.sh (deploy time)
//      and passed into the docker build;
//   2. otherwise the current UTC time, for a plain `pnpm run build`.
import fs from "fs";

const builtAt = new Date().toISOString();
const fallback = `${builtAt.slice(0, 10).replace(/-/g, ".")}-${builtAt.slice(11, 19).replace(/:/g, "")}`;
const version = process.env.UPSTAGE_BUILD_VERSION?.trim() || fallback;

fs.writeFileSync("public/version.json", JSON.stringify({ version, builtAt }, null, 2) + "\n");
console.log(`Generated public/version.json: ${version} (built ${builtAt})`);
