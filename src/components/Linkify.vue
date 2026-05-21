<script>
import { linkify } from "utils/common";

export default {
  setup: (props, { slots }) => {
    const content = slots
      .default()
      .map((slot) => slot.children)
      .join();
    const html = linkify(content);
    return { html };
  },
};
</script>

<template>
  <span v-html="html"></span>
</template>

<style></style>
