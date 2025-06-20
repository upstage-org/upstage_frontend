<template>
  <span class="text-xs whitespace-nowrap">
    UpStage v{{ version }} -
    <span v-if="release">{{ release }}</span>
    <span v-else>{{ $t("under_construction") }}</span>
  </span>
</template>

<script setup lang="ts">
import configs from "config";

const release = configs.ALIAS_RELEASE_VERSION;
const version = configs.RELEASE_VERSION;
</script>
