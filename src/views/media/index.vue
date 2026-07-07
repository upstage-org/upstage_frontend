<script setup lang="ts">
import { ref } from "vue";
const isReplace = ref<boolean>(false);
</script>

<template>
  <Dropzone v-model="isReplace">
    <MediaFilter />
    <MediaTable>
      <MediaForm v-model="isReplace" />
      <!-- RTMP stream feed modal; inert unless opened via streamFeedVar. -->
      <StreamFeedForm />
    </MediaTable>
  </Dropzone>
</template>
