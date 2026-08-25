<script lang="ts" setup>
import { computed } from "vue";
import configs from "config";
import { runningBuild, type BuildInfo } from "@utils/buildVersion";
import { startServedBuildPolling, useServedBuild } from "@composables/useServedBuild";

const release = configs.ALIAS_RELEASE_VERSION;
const version = configs.RELEASE_VERSION;

// Same stamps the "new version, please reload" prompt compares: the build
// baked into this page vs the one the server currently deploys.
const build = runningBuild();
const served = useServedBuild();
startServedBuildPolling();

const builtAtText = (b: BuildInfo): string => {
  const t = Date.parse(b.builtAt);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
};

const runningText = computed(() => {
  if (!build) return "";
  const when = builtAtText(build);
  return when ? `${build.version} · ${when}` : build.version;
});

const deployedText = computed(() => {
  if (!build || !served.value) return "";
  if (served.value.version === build.version && served.value.builtAt === build.builtAt) {
    return "deployed ✓";
  }
  const when = builtAtText(served.value);
  return when ? `deployed ${served.value.version} · ${when}` : `deployed ${served.value.version}`;
});
</script>

<template>
  <span class="text-xs whitespace-nowrap">
    UpStage v{{ version }} -
    <span v-if="release">{{ release }}</span>
    <span v-else>{{ $t("under_construction") }}</span>
    <template v-if="runningText"> · build {{ runningText }}</template>
    <template v-if="deployedText"> · {{ deployedText }}</template>
  </span>
</template>
