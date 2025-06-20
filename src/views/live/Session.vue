<template>
  <div :title="'Joined ' + joinedAt.fromNow()" @click="tagPlayer">
    <span class="icon">
      <i class="fas" :class="{
        'fa-user': session.isPlayer,
        'fa-desktop': !session.isPlayer,
        'has-text-success': isOnline,
      }"></i>
    </span>
    {{ session.nickname }}
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import moment from "moment";
import { useStageStore } from "store/modules/stage";

const props = defineProps<{
  session: {
    isPlayer: boolean;
    at: string;
    nickname: string;
  };
}>();

const stageStore = useStageStore();

const joinedAt = computed(() => {
  return moment(new Date(props.session.at));
});

const isOnline = computed(() => {
  return moment().diff(joinedAt.value, "minutes") < 60;
});

const tagPlayer = () => {
  stageStore.tagPlayer(props.session);
  stageStore.showPlayerChat(true);
};
</script>

<style scoped>
div {
  text-align: left;
}
</style>
