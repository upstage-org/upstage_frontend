<script setup>
defineOptions({ name: "Meeting" });

import { useStageStore } from "@stores/pinia/stage";
import Icon from "components/Icon.vue";
import Skeleton from "../../Skeleton.vue";
import StreamToolboxThumb from "../Streams/StreamToolboxThumb.vue";
import { computed, createVNode, inject, ref } from "vue";
import { Modal, message } from "ant-design-vue";
import { useI18n } from "vue-i18n";
import configs from "config";
import { endpointHostLabel, isJitsiBoardType } from "@utils/common";
import Yourself from "components/objects/MeetingObject/Yourself.vue";

const stageStore = useStageStore();
const { t } = useI18n();

// Multi-server streaming: which Jitsi server this performer publishes to.
// Rendered only when the build lists more than one server; `jitsi` is the
// composable object provided by MeetingObject/Shell.vue.
const jitsi = inject("jitsi", null);
const jitsiServers = computed(() => configs.JITSI_ENDPOINTS ?? []);
const showServerPicker = computed(
  () => (configs.JITSI_SERVER_COUNT ?? 1) > 1 && !!jitsi?.server && !!jitsi?.switchServer,
);
const currentServer = computed(() => jitsi?.server?.value ?? configs.JITSI_ENDPOINT);
const currentServerLabel = computed(() => endpointHostLabel(currentServer.value));
const switching = computed(() => jitsi?.switching?.value ?? false);
// Native <select> rather than the Bulma Dropdown: the toolbox is a narrow
// horizontal strip and a positioned menu gets clipped there.
const selectEl = ref(null);

const ownJitsiTilesOnBoard = () => {
  const myId = jitsi?.room?.myUserId?.();
  const mySession = stageStore.session;
  return stageStore.board.objects.filter(
    (o) =>
      isJitsiBoardType(o.type) &&
      ((myId != null && o.participantId === myId) || (mySession != null && o.hostId === mySession)),
  ).length;
};

const doSwitch = async (next) => {
  const label = endpointHostLabel(next);
  const ok = await jitsi.switchServer(next);
  if (ok) {
    message.success(t("stream_server_switched", { server: label }));
  } else {
    message.error(
      t("stream_server_switch_failed", { server: label, current: currentServerLabel.value }),
    );
  }
};

const onServerPicked = (event) => {
  const next = event?.target?.value;
  // Reset the control to the live value; it follows `jitsi.server` on success.
  if (selectEl.value) selectEl.value.value = currentServer.value;
  if (!next || next === currentServer.value || switching.value) return;
  if (ownJitsiTilesOnBoard() === 0) {
    void doSwitch(next);
    return;
  }
  Modal.confirm({
    title: t("streaming_server"),
    content: createVNode(
      "div",
      { style: "color: black; white-space: pre-line;" },
      t("switch_stream_server_confirm", { server: endpointHostLabel(next) }),
    ),
    okText: t("yes"),
    cancelText: t("no"),
    onOk() {
      void doSwitch(next);
    },
  });
};
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
  <Yourself v-if="jitsiEnabled" :title="currentServerLabel" />
  <!--
    The server picker is its own 100x100 tile, NOT nested under the
    self-preview: every direct child of .card-content is a fixed 100px
    tile with overflow hidden, so stacking the <select> under the preview
    inside one tile pushed the preview up out of the box and hid the
    select below it (2026-09-10).
  -->
  <div
    v-if="jitsiEnabled && showServerPicker"
    class="room-skeleton server-tile"
    :title="t('streaming_server')"
  >
    <div class="select is-small server-select">
      <select
        ref="selectEl"
        :value="currentServer"
        :disabled="switching"
        data-testid="jitsi-server-picker"
        @change="onServerPicked"
      >
        <option v-for="origin in jitsiServers" :key="origin" :value="origin">
          {{ endpointHostLabel(origin) }}
        </option>
      </select>
    </div>
    <span class="tag is-light is-block">{{ $t("streaming_server") }}</span>
  </div>
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

/* The panel's generic `#topbar .card-content > div > div { padding: 12px }`
   (ID selector, so it outranks this scoped rule without !important) would
   leave the select only 64px wide; host names need the room. The 48px band
   matches `.icon.is-large` on the neighbouring tiles so the labels line up. */
.server-tile > .server-select {
  padding: 0 !important;
  width: 88px;
  height: 48px;
  display: flex;
  align-items: center;

  select {
    width: 100%;
    max-width: 100%;
    text-overflow: ellipsis;
  }
}
</style>
