<script setup>
import Shell from "components/objects/MeetingObject/Shell.vue";
import LocalStreamPublisher from "components/objects/MeetingObject/LocalStreamPublisher.vue";
import Yourself from "components/objects/MeetingObject/Yourself.vue";
import TrackYard from "components/objects/MeetingObject/TrackYard.vue";
</script>

<template>
  <Shell>
    <LocalStreamPublisher />
    <Yourself style="border-radius: 8px" />
    <TrackYard />
  </Shell>
</template>
