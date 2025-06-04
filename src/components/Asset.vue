<template>
  <audio controls v-if="asset.assetType === 'audio'" :src="src"></audio>
  <template v-else-if="asset.assetType === 'video'">
    <video controls :src="src"></video>
  </template>
  <img
    v-else
    :src="src"
    style="max-width: 100%; max-height: 100%"
    @load="handleLoad"
  />
</template>

<script>
import { computed } from "vue";
import { absolutePath } from "utils/common";

export default {
  props: ["asset"],
  emits: ["detectSize"],
  components: { },
  setup: (props, { emit }) => {
    if (props.asset.assetType?.name) {
      Object.assign(props.asset, { assetType: props.asset.assetType.name });
    }
    const src = computed(
      () => props.asset.base64 ?? absolutePath(props.asset.src || props.asset.fileLocation),
    );
    const meta = computed(() => {
      if (props.asset.description) {
        return JSON.parse(props.asset.description);
      }
      return {};
    });
    const handleLoad = (e) => {
      emit("detectSize", {
        width: e.target.width,
        height: e.target.height,
      });
    };

    return { src, meta, handleLoad };
  },
};
</script>

<style lang="scss" scoped>
audio,
img {
  max-width: 100%;
  max-height: 100%;
}
</style>
