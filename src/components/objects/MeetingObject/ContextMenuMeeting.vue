<script setup lang="ts">
/**
 * Right-click menu of an embedded meeting (#1566). A meeting had no menu at
 * all; this gives it the one entry players asked for: pick a prop from the
 * Props panel to wear over the meeting, e.g. to cover the Jitsi toolbar for
 * the audience. The prop then follows the meeting like a frame on a stream
 * tile, and any player can adjust it or take it off ("Remove from meeting").
 *
 * Audience tools (#1580, see ./audienceTools.ts): the players decide, per
 * meeting, whether the audience only watches (the default) or gets a
 * microphone button, or microphone and camera. The choice is stored on the
 * meeting's board object and sent like any other change to it, so every
 * viewer — and anyone arriving later — gets the same answer. Only players
 * ever see this menu (Object.vue renders it for them alone), and only
 * players can publish a change to a board object.
 */
import { computed, createVNode } from "vue";
import { Modal } from "ant-design-vue";
import { useI18n } from "vue-i18n";
import { useStageStore } from "@stores/pinia/stage";
import Icon from "components/Icon.vue";
import { normalizeAudienceTools, type AudienceToolsLevel } from "./audienceTools";
import type { BoardObject } from "@stores/pinia/stage.types";

const props = defineProps<{
  object: BoardObject;
  closeMenu: () => void;
}>();

const stageStore = useStageStore();
const { t } = useI18n();

const addProp = () => {
  stageStore.startAttachingProp(props.object.id);
  props.closeMenu();
};

const AUDIENCE_TOOLS_OPTIONS: Array<{ level: AudienceToolsLevel; label: string }> = [
  { level: "none", label: "meeting_audience_tools_none" },
  { level: "mic", label: "meeting_audience_tools_mic" },
  { level: "mic-camera", label: "meeting_audience_tools_mic_camera" },
];
const audienceTools = computed(() => normalizeAudienceTools(props.object.audienceTools));

const setAudienceTools = (level: AudienceToolsLevel) => {
  // Picking the level already in force sends nothing: a redundant message
  // must never be the reason an audience member's meeting reloads.
  if (level !== audienceTools.value) {
    // "none" is written out rather than removed: an update merges into the
    // object on every viewer's side, and a missing key would leave the old
    // level standing there.
    stageStore.shapeObject({ ...props.object, audienceTools: level });
  }
  props.closeMenu();
};

// Pinning a person for everyone is a Jitsi feature of the meeting itself
// ("Everyone follows me"); UpStage cannot switch it on from outside the
// frame, so the menu explains where it is.
const showFollowMeHelp = () => {
  props.closeMenu();
  Modal.info({
    title: t("meeting_show_to_everyone_title"),
    content: createVNode(
      "div",
      { style: "color: black; white-space: pre-line;" },
      t("meeting_show_to_everyone_help"),
    ),
  });
};
</script>

<template>
  <div class="card-content p-0">
    <a class="panel-block" data-testid="meeting-add-prop" @click="addProp">
      <span class="panel-icon">
        <Icon src="prop.svg" />
      </span>
      <span>{{ $t("add_prop_to_meeting") }}</span>
    </a>
    <div
      class="panel-block meeting-menu-heading"
      data-testid="meeting-audience-tools"
      :title="$t('meeting_audience_tools_tooltip')"
    >
      <span class="panel-icon">
        <i class="fas fa-users"></i>
      </span>
      <span>{{ $t("meeting_audience_tools") }}</span>
    </div>
    <a
      v-for="option in AUDIENCE_TOOLS_OPTIONS"
      :key="option.level"
      class="panel-block meeting-menu-option"
      :class="{ 'is-selected': audienceTools === option.level }"
      :data-testid="`meeting-audience-tools-${option.level}`"
      :aria-checked="audienceTools === option.level"
      role="menuitemradio"
      @click="setAudienceTools(option.level)"
    >
      <span class="panel-icon">
        <i v-if="audienceTools === option.level" class="fas fa-check has-text-primary"></i>
      </span>
      <span>{{ $t(option.label) }}</span>
    </a>
    <a class="panel-block" data-testid="meeting-follow-me-help" @click="showFollowMeHelp">
      <span class="panel-icon">
        <i class="fas fa-thumbtack"></i>
      </span>
      <span>{{ $t("meeting_show_to_everyone") }}</span>
    </a>
  </div>
</template>

<style scoped lang="scss">
.meeting-menu-heading {
  cursor: default;
  font-weight: 600;
}

.meeting-menu-option {
  padding-left: 1.5em;

  &.is-selected {
    font-weight: 600;
  }
}
</style>
