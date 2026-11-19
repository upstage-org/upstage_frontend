<script setup lang="ts">
import { computed } from "vue";
import Skeleton from "../Skeleton.vue";
import Icon from "components/Icon.vue";
import { useStageStore } from "@stores/pinia/stage";

const stageStore = useStageStore();
const props = stageStore.tools.props as any[];
const clearAll = () => stageStore.clearStageObjectsOfKind("prop");

// "Add prop to stream / avatar" (#1566): while a target is set, clicking a
// prop puts it on that object instead of needing a drag onto the stage.
const attachingTo = computed(() => stageStore.attachingPropTo);
const target = computed(() =>
  attachingTo.value == null
    ? null
    : (stageStore.board.objects.find((o) => o.id === attachingTo.value) ?? null),
);
const targetName = computed(() => target.value?.name || target.value?.displayName || "");
const pick = (prop: any) => {
  if (attachingTo.value == null) return;
  stageStore.attachPropTo(prop);
};
</script>

<template>
  <div
    v-if="attachingTo != null"
    class="attach-banner"
    data-testid="attach-prop-banner"
    @click="stageStore.cancelAttachingProp()"
  >
    <div class="icon is-large">
      <Icon size="36" src="clear.svg" />
    </div>
    <span class="tag is-warning is-block long-label">
      {{ $t("choose_prop_for", { name: targetName }) }} · {{ $t("cancel") }}
    </span>
  </div>
  <div v-else @click="clearAll">
    <div class="icon is-large">
      <Icon size="36" src="clear.svg" />
    </div>
    <span class="tag is-light is-block">{{ $t("clear") }}</span>
  </div>
  <div
    v-for="prop in props"
    :key="prop"
    :class="{ 'attach-pick': attachingTo != null }"
    :data-testid="attachingTo != null ? 'attach-prop-choice' : undefined"
    @click.capture="attachingTo != null && pick(prop)"
  >
    <Skeleton :data="prop" />
  </div>
</template>

<style scoped lang="scss">
.attach-banner {
  cursor: pointer;
}
.attach-pick {
  cursor: copy;
  outline: 2px dashed #ffdd57;
  outline-offset: -2px;
}
</style>
