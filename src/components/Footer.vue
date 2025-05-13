<template>
  <footer v-if="notInIframe" class="footer">
    <div class="content has-text-centered">
      UpStage v{{ version }} -
      <span v-if="release">{{ release }}</span>
      <span v-else>{{ $t("under_construction") }}</span>
    </div>
  </footer>
</template>

<script>
import configs from "config";

export default {
  setup: () => {
    return {
      release: configs.ALIAS_RELEASE_VERSION,
      version: configs.RELEASE_VERSION,
      notInIframe: window.self === window.top,
    };
  },
};
</script>

<style>
footer.footer {
  clear: both;
  position: relative;
  padding: 1rem;
}
</style>
