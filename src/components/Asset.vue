<script>
import { computed } from "vue";
import { absolutePath } from "utils/common";

export default {
  components: {},
  props: { asset: Object },
  emits: ["detectSize"],
  setup: (props, { emit }) => {
    // Normalize the polymorphic assetType (object {name} or string) into a
    // single string for the template. Previously this was done by
    // Object.assign(props.asset, ...) in setup, which mutated the parent's
    // prop (vue/no-mutating-props) and silently flipped asset.assetType from
    // an object to a string for everyone holding a reference to it.
    const assetTypeName = computed(() =>
      typeof props.asset.assetType === "object"
        ? props.asset.assetType?.name
        : props.asset.assetType,
    );
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

    return { src, meta, handleLoad, assetTypeName };
  },
};
</script>

<template>
  <audio v-if="assetTypeName === 'audio'" controls :src="src"></audio>
  <template v-else-if="assetTypeName === 'video'">
    <video controls :src="src"></video>
  </template>
  <img v-else :src="src" style="max-width: 100%; max-height: 100%" @load="handleLoad" />
</template>

<style lang="scss" scoped>
audio,
img {
  max-width: 100%;
  max-height: 100%;
}
</style>
