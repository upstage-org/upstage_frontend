/**
 * "New version available" check.
 *
 * Two halves, both written by `src/update-version.js` on every build:
 *   - the RUNNING build: `__UPSTAGE_BUILD__`, baked into the bundle by
 *     vite.config.ts (`define`), so the page knows exactly what it is;
 *   - the SERVED build: `/version.json`, fetched (no-store) on load and
 *     every few minutes by App.vue.
 *
 * A reload is needed when the stamps differ OR the server's build is newer
 * than ours (belt and braces: a stamp collision or hand-edited file still
 * triggers on the timestamp; a clock-skewed timestamp still triggers on
 * the stamp). An older server build (e.g. a rollback) also counts — the
 * page must match what is served, whichever way it differs.
 */
export interface BuildInfo {
  version: string;
  builtAt: string; // ISO-8601
}

declare const __UPSTAGE_BUILD__: BuildInfo | undefined;

const parseTime = (iso: string | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

/** Build info of the bundle currently executing (null in unstamped builds). */
export function runningBuild(): BuildInfo | null {
  try {
    const b = typeof __UPSTAGE_BUILD__ === "undefined" ? undefined : __UPSTAGE_BUILD__;
    return b && typeof b.version === "string" ? b : null;
  } catch {
    return null;
  }
}

/** Parse a `/version.json` body; null if it's not a usable BuildInfo. */
export function parseServedBuild(data: unknown): BuildInfo | null {
  if (!data || typeof data !== "object") return null;
  const { version, builtAt } = data as Partial<BuildInfo>;
  if (typeof version !== "string" || !version.trim()) return null;
  return { version: version.trim(), builtAt: typeof builtAt === "string" ? builtAt : "" };
}

/** True when the served build is not the one running in this page. */
export function needsReload(running: BuildInfo | null, served: BuildInfo | null): boolean {
  if (!running || !served) return false; // can't tell — never nag on missing data
  if (running.version !== served.version) return true;
  const mine = parseTime(running.builtAt);
  const theirs = parseTime(served.builtAt);
  if (mine === null || theirs === null) return false;
  return theirs !== mine;
}

/** "2026.08.22-013314 (built 22 Aug 2026, 01:33 UTC)" for the prompt. */
export function describeBuild(b: BuildInfo): string {
  const t = parseTime(b.builtAt);
  if (t === null) return b.version;
  const when = new Date(t).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${b.version} (built ${when})`;
}
