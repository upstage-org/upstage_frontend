<script>
import { computed } from "vue";
// Aliased: "Image" is a reserved HTML element name (vue/no-reserved-component-names).
import AppImage from "components/Image.vue";
import Icon from "components/Icon.vue";
import { absolutePath } from "utils/common";
export default {
  components: { AppImage, Icon },
  props: {
    asset: Object,
  },
  setup: (props) => {
    const meta = computed(() => {
      if (props.asset.description) {
        return JSON.parse(props.asset.description);
      }
      return {};
    });

    return { meta, absolutePath };
  },
};
</script>

<template>
  <a-tooltip title="This is a multiframe media">
    <div v-if="meta.multi" class="has-tooltip-bottom">
      <Icon src="multi-frame.svg" />
      <AppImage
        v-for="frame in meta.frames"
        :key="frame"
        :src="absolutePath(frame)"
        :style="{ width: 'unset', height: '20px' }"
      />
    </div>
  </a-tooltip>
</template>

<style lang="scss" scoped></style>
