<template>
  <span class="text-xs whitespace-nowrap">
    UpStage v{{ version }} -
    <span v-if="release">{{ release }}</span>
    <span v-else>{{ $t("under_construction") }}</span>
  </span>
</template>

<script>
import configs from "config";

export default {
  setup: () => {
    return { release: configs.ALIAS_RELEASE_VERSION, version: configs.RELEASE_VERSION };
  },
};
</script>
