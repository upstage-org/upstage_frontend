<template>
  <!-- Open in a new tab: many sites (e.g. WordPress) block iframes via X-Frame-Options / CSP. -->
  <a
    v-if="url"
    :href="url"
    target="_blank"
    rel="noopener noreferrer"
    @click.stop
  >{{ $t("tos.terms_of_service") }}</a>
  <span v-else class="has-text-grey">{{ $t("tos.terms_of_service") }}</span>
</template>

<script>
import { computed } from "vue";
import { useStore } from "vuex";

export default {
  setup: () => {
    const store = useStore();
    const url = computed(() => store.getters["config/termsOfService"]);
    return { url };
  },
};
</script>
