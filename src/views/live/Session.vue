<script setup lang="ts">
import { computed } from "vue";
import dayjs from "@utils/dayjs";
import { useStageStore } from "@stores/pinia/stage";

interface SessionInfo {
  isPlayer?: boolean;
  nickname?: string;
  at: string | number | Date;
}

const props = defineProps<{ session: SessionInfo }>();

const stageStore = useStageStore();
const joinedAt = computed(() => dayjs(new Date(props.session.at)));
const isOnline = computed(() => dayjs().diff(joinedAt.value, "minutes") < 60);

const tagPlayer = () => {
  if (props.session.isPlayer && props.session.nickname) {
    stageStore.TAG_PLAYER({ nickname: props.session.nickname });
    // Pinia rename: Vuex `dispatch("stage/showPlayerChat", v)` →
    // Pinia `setShowPlayerChat(v)` (the original action name collided
    // with the same-named state ref in Pinia setup-store syntax).
    stageStore.setShowPlayerChat(true);
  }
};
</script>

<template>
  <div :title="'Joined ' + joinedAt.fromNow()" @click="tagPlayer">
    <span class="icon">
      <i
        class="fas"
        :class="{
          'fa-user': session.isPlayer,
          'fa-desktop': !session.isPlayer,
          'has-text-success': isOnline,
        }"
      ></i>
    </span>
    {{ session.nickname }}
  </div>
</template>

<style scoped>
div {
  text-align: left;
}
</style>
