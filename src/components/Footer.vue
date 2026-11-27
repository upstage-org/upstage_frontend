<script setup lang="ts">
import configs from "config";

const release = configs.ALIAS_RELEASE_VERSION;
const version = configs.RELEASE_VERSION;
const notInIframe = window.self === window.top;
</script>

<template>
  <footer v-if="notInIframe" class="footer">
    <div class="content has-text-centered">
      UpStage v{{ version }} -
      <span v-if="release">{{ release }}</span>
      <span v-else>{{ $t("under_construction") }}</span>
    </div>
  </footer>
</template>

<style>
footer.footer {
  clear: both;
  position: relative;
  padding: 1rem;
}
</style>
