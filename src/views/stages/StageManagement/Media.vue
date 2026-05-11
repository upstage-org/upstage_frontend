<script>
import { inject } from "vue";
import Reorder from "./Reorder.vue";

export default {
  components: {
    Reorder,
  },
  setup: () => {
    const stage = inject("stage");

    return { selectedMedia: stage.value.assets || [] };
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

<style scoped lang="scss">
.media-preview {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 0;
  width: 48px;
  height: 48px;
  border-radius: 5px;
  overflow: hidden;
}

.type-icon {
  align-self: center;
  padding: 0 16px;
}
</style>
