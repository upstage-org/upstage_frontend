<script>
import { useConfigStore } from "@stores/pinia/config";
import { storeToRefs } from "pinia";

export default {
  setup: () => {
    const { termsOfService: url } = storeToRefs(useConfigStore());
    return { url };
  },
};
</script>

<template>
  <!-- Open in a new tab: many sites (e.g. WordPress) block iframes via X-Frame-Options / CSP. -->
  <a v-if="url" :href="url" target="_blank" rel="noopener noreferrer" @click.stop>{{
    $t("tos.terms_of_service")
  }}</a>
  <span v-else class="has-text-grey">{{ $t("tos.terms_of_service") }}</span>
</template>
