<script>
import { inject } from "vue";
import Reorder from "./Reorder.vue";

export default {
  components: {
    Reorder,
  },
  setup: () => {
    const stage = inject("stage");

    return {
      selectedMedia: stage.value.assets || [],
    };
  },
};
</script>

<template>
  <div class="columns">
    <div class="column">
      <b><span>Media assigned to this Stage</span></b>
    </div>
  </div>

  <Reorder v-model="selectedMedia" />
</template>
