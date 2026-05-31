<script>
import { computed } from "vue";
import { useStageStore } from "@stores/pinia/stage";
import { useUserStore } from "@stores/pinia/user";
import Skeleton from "../Skeleton.vue";
import Icon from "components/Icon.vue";
import { isHoldableBoardObject } from "@utils/common";

export default {
  components: { Skeleton, Icon },
  setup() {
    const stageStore = useStageStore();
    const userStore = useUserStore();
    const objects = computed(() => stageStore.objects);
    // `store.state.user.avatarId` worked only by accident: Vuex's root
    // store has no `user` module any more (it was migrated to Pinia in
    // Phase 5), so the read silently threw inside Vue's effect and
    // returned undefined. Reading from the real Pinia user store is
    // both correct and reactive.
    const currentAvatar = computed(() => userStore.avatarId);

    return { objects, currentAvatar, isHoldableBoardObject };
  },
};
</script>

<template>
  <div v-for="object in objects" :key="object.id">
    <Icon
      v-if="object.holder && isHoldableBoardObject(object)"
      class="current-avatar"
      :class="{
        'current-avatar--mine': object.id === currentAvatar,
        'current-avatar--taken': object.id !== currentAvatar,
      }"
      src="my-avatar.svg"
    />
    <Skeleton :real="true" :data="object" :ghost="object.holder && object.id !== currentAvatar" />
  </div>
</template>

<style lang="scss" scoped>
.current-avatar {
  position: absolute;
  z-index: 1;
  transform: translate(-50%, -65%);
  width: 16px;
  height: 16px;
}

.current-avatar--mine {
  filter: hue-rotate(88deg) saturate(1.15) brightness(0.92);
}

.current-avatar--taken {
  filter: none;
}
</style>
