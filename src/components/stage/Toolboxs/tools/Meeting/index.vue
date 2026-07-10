<script setup>
defineOptions({ name: "Meeting" });

import { useStageStore } from "@stores/pinia/stage";
import Icon from "components/Icon.vue";
import Skeleton from "../../Skeleton.vue";
import StreamToolboxThumb from "../Streams/StreamToolboxThumb.vue";
import { computed } from "vue";
import Yourself from "components/objects/MeetingObject/Yourself.vue";

const stageStore = useStageStore();
// The stage's streaming mode (Customisation page) picks which halves of this
// tab exist: Jitsi rooms/self-preview, RTMP feeds, or both.
const jitsiEnabled = computed(() => stageStore.jitsiStreamingEnabled);
const rooms = computed(() => (jitsiEnabled.value ? stageStore.tools.meetings : []));
// RTMP feeds assigned to this stage live in the same `tools.videos` bucket as
// uploaded clips (assetType "stream" folds into it), but they belong here in
// the Streams tab next to Jitsi rooms. Pass the raw store item to Skeleton —
// it carries type/isRTMP/fileLocation/description, so placement is identical
// to the Video-tab path.
const liveFeeds = computed(() =>
  stageStore.rtmpStreamingEnabled ? (stageStore.tools.videos ?? []).filter((v) => v.isRTMP) : [],
);

const createRoom = () => {
  stageStore.openSettingPopup({
    type: "CreateRoom",
  });
};

// Removes every placed live tile from the stage — jitsi streams, meeting
// rooms and RTMP feeds (everything placeable from this tab).
const clearAll = () => stageStore.clearStageObjectsOfKind("stream");
</script>

<template>
  <div class="room-skeleton" @click="clearAll">
    <div class="icon is-large">
      <Icon size="36" src="clear.svg" />
    </div>
    <span class="tag is-light is-block">{{ $t("clear") }}</span>
  </div>
  <div v-if="jitsiEnabled" class="is-pulled-left room-skeleton" @click="createRoom">
    <div class="icon is-large">
      <Icon src="new.svg" size="36" />
    </div>
    <span class="tag is-light is-block">{{ $t("new_room") }}</span>
  </div>
  <Yourself v-if="jitsiEnabled" />
  <Skeleton v-for="(room, i) in rooms" :key="i" :data="room">
    <div class="room-skeleton">
      <!--
        Dedicated meeting icon (multi-stalk antenna) — meetings previously
        borrowed backdrop.svg here, which made them hard to tell apart from
        individual streams at a glance.
      -->
      <Icon src="meeting-room.svg" height="48" width="36" />
      <span class="tag is-light is-block">{{ room.name }}</span>
    </div>
  </Skeleton>
  <Skeleton v-for="feed in liveFeeds" :key="feed.id ?? feed.url" :data="feed">
    <div class="room-skeleton">
      <div class="live-feed-box">
        <StreamToolboxThumb :video="feed" />
      </div>
      <span class="tag is-light is-block">{{ feed.name }}</span>
    </div>
  </Skeleton>
</template>

<style lang="scss" scoped>
.room-skeleton {
  flex: none;
}

.live-feed-box {
  width: 76px;
  height: 48px;
  margin: 0 auto;
}
</style>
