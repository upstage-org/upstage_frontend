<!--
  Parent (MediaForm) passes `link` as a shared reactive object; this child
  binds v-model directly into link.url / link.blank / link.effect. The
  parent expects in-place mutation, so the vue/no-mutating-props warnings
  are silenced at the file level rather than reshaping the API.
-->
<!-- eslint-disable vue/no-mutating-props -->
<script lang="ts" setup>
import { PropType } from "vue";
import { Link } from "models/studio";

const props = defineProps({
  link: {
    type: Object as PropType<Link>,
    required: true,
  },
});
</script>

<template>
  <!-- eslint-disable vue/no-mutating-props -->
  <a-space direction="vertical" class="w-full mb-4">
    <a-form-item label="URL" :label-col="{ span: 6 }" class="mb-2">
      <a-input
        v-model:value="props.link.url"
        placeholder="The destination when audience click on the link"
      />
    </a-form-item>
    <a-form-item label="Open in new tab" :label-col="{ span: 6 }" class="mb-2">
      <a-switch v-model:checked="props.link.blank" />
    </a-form-item>
    <a-form-item label="Hover effect" :label-col="{ span: 6 }" class="mb-2">
      <a-switch v-model:checked="props.link.effect" />
    </a-form-item>
  </a-space>
</template>
