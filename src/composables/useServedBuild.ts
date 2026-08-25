import { ref, type Ref } from "vue";
import { parseServedBuild, type BuildInfo } from "@utils/buildVersion";

/**
 * The build currently DEPLOYED on the server (`/version.json`), polled every
 * 3 minutes. Module-level singleton so App.vue (reload prompt) and
 * StudioVersion.vue (navbar readout) share one poll and one value.
 */
const servedBuild: Ref<BuildInfo | null> = ref(null);
let pollTimer: ReturnType<typeof setInterval> | null = null;

const checkVersion = async (): Promise<void> => {
  try {
    const response = await fetch("/version.json", {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return; // mid-deploy 500s etc. — keep the last good value
    servedBuild.value = parseServedBuild(await response.json());
  } catch (error) {
    console.error("Failed to check version:", error);
  }
};

/** Fetch now and every 3 minutes thereafter; safe to call more than once. */
export function startServedBuildPolling(): void {
  void checkVersion();
  if (pollTimer !== null) return;
  pollTimer = setInterval(
    () => {
      void checkVersion();
    },
    3 * 60 * 1000,
  );
}

export function useServedBuild(): Ref<BuildInfo | null> {
  return servedBuild;
}
