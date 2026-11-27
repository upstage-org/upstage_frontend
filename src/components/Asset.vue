<script setup lang="ts">
import { computed } from "vue";
import { absolutePath } from "utils/common";

// Media rows reach this component in several shapes (list row, upload draft).
type AssetLike = Record<string, any>;

const props = defineProps<{ asset: AssetLike }>();
const emit = defineEmits<{
  (e: "detectSize", size: { width: number; height: number }): void;
}>();

// Normalize the polymorphic assetType (object {name} or string) into a
// single string for the template. Previously this was done by
// Object.assign(props.asset, ...) in setup, which mutated the parent's
// prop (vue/no-mutating-props) and silently flipped asset.assetType from
// an object to a string for everyone holding a reference to it.
const assetTypeName = computed(() =>
  typeof props.asset.assetType === "object" ? props.asset.assetType?.name : props.asset.assetType,
);
const src = computed(
  () => props.asset.base64 ?? absolutePath(props.asset.src || props.asset.fileLocation),
);
const handleLoad = (e: Event) => {
  const image = e.target as HTMLImageElement;
  emit("detectSize", {
    width: image.width,
    height: image.height,
  });
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
