<script setup lang="ts">
  import { ref } from 'vue';
  const isReplace = ref<boolean>(false);
</script>

<template>
  <Dropzone v-model="isReplace">
    <MediaFilter />
    <MediaTable>
      <MediaForm v-model="isReplace" />
    </MediaTable>
  </Dropzone>
</template>