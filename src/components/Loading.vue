<template>
  <img :src="src" :style="{ width, height }"/>
</template>

<script>
export default {
  props: {
    width: {
      type: String,
      default: "100%",
    },
    height: {
      type: String,
      default: "150px",
    },
    src: {
      type: String,
      default: "assets/loading.svg",
    }
  },
};
</script>
