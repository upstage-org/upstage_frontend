<script setup>
import { useStore } from "vuex";
import Icon from "components/Icon.vue";
import Skeleton from "../../Skeleton.vue";
import { computed } from "vue";
import Yourself from "components/objects/MeetingObject/Yourself.vue";

const store = useStore();
const rooms = computed(() => store.state.stage.tools.meetings);

const createRoom = () => {
  store.dispatch("stage/openSettingPopup", {
    type: "CreateRoom",
  });
};
</script>

<template>
  <div class="is-pulled-left room-skeleton" @click="createRoom">
    <div class="icon is-large">
      <Icon src="new.svg" size="36" />
    </div>
    <span class="tag is-light is-block">{{ $t("new_room") }}</span>
  </div>
  <Yourself />
  <Skeleton v-for="(room, i) in rooms" :key="i" :data="room">
    <div class="room-skeleton">
      <Icon src="backdrop.svg" height="48" width="36" />
      <span class="tag is-light is-block">{{ room.name }}</span>
    </div>
  </Skeleton>
</template>

<style lang="scss" scoped>
.room-skeleton {
  flex: none;
}
</style>
