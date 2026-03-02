<template>
  <div v-for="object in objects" :key="object.id">
    <Icon
      class="current-avatar"
      v-if="object.holder"
      :style="{
        filter: `grayscale(${object.id === currentAvatar ? 0 : 1})`,
      }"
      src="my-avatar.svg"
    />
    <Skeleton
      :real="true"
      :data="object"
      :ghost="object.holder && object.id !== currentAvatar"
    />
  </div>
</template>

<script>
import { computed } from "vue";
import { useStore } from "vuex";
import Skeleton from "../Skeleton.vue";
import Icon from "components/Icon.vue";

export default {
  components: { Skeleton, Icon },
  setup() {
    const store = useStore();
    const objects = computed(() => store.getters["stage/objects"]);
    // Use session’s avatarId (synced) so depth tool red/grey matches stage teardrops
    const currentAvatar = computed(() => {
      const session = store.state.stage.session;
      const mySession = store.state.stage.sessions?.find((s) => s.id === session);
      return mySession?.avatarId ?? store.state.user.avatarId;
    });

    return { objects, currentAvatar };
  },
};
</script>

<style lang="scss" scoped>
.current-avatar {
  position: absolute;
  z-index: 1;
  transform: translate(-50%, -65%);
  width: 16px;
  height: 16px;
}
</style>
