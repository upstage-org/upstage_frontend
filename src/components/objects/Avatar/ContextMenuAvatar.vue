<template>
  <div class="avatar-context-menu card-content p-0">
    <template v-if="holdable">
      <a v-if="isHolding" class="panel-block" @click.stop="releaseAvatar">
        <span class="panel-icon">
          <Icon src="clear.svg" />
        </span>
        <span>{{ $t("release") }}</span>
      </a>
      <a v-else class="panel-block" @click="holdAvatar">
        <span class="panel-icon">
          <Icon src="set-as-avatar.svg" />
        </span>
        <span>{{ $t("hold_this_avatar") }}</span>
      </a>
    </template>
    <template v-else>
      <a v-if="isWearing" class="panel-block" @click="takeOffCostume">
        <span class="panel-icon">
          <Icon src="clear.svg" />
        </span>
        <span>{{ $t("remove_from_avatar") }}</span>
      </a>
      <a v-else-if="currentAvatar && object.type !== 'video'" class="panel-block" @click="wearCostume">
        <span class="panel-icon">
          <Icon src="prop.svg" />
        </span>
        <span>{{ $t("add_to_avatar") }}</span>
      </a>
    </template>
    <div v-if="object.type == 'video'">
      <a v-if="object.isPlaying" class="panel-block" @click="pauseVideo">
        <span class="panel-icon">
          <i class="fas fa-pause"></i>
        </span>
        <span>{{ $t("pause") }}</span>
      </a>
      <a v-else class="panel-block" @click="playVideo">
        <span class="panel-icon">
          <i class="fas fa-play"></i>
        </span>
        <span>{{ $t("play") }}</span>
      </a>
      <a class="panel-block" @click="restartVideo">
        <span class="panel-icon">
          <i class="fas fa-sync"></i>
        </span>
        <span>{{ $t("restart") }}</span>
      </a>
      <a class="panel-block" @click="openVolumePopup">
        <span class="panel-icon">
          <Icon src="voice-setting.svg" />
        </span>
        <span>{{ $t("volumn_setting") }}</span>
      </a>
      <a class="panel-block" @click="toggleVideoLoop">
        <span class="panel-icon">
          <i v-if="object.loop" class="fas fa-infinity"></i>
          <b v-else>1</b>
        </span>
        <span v-if="object.loop">{{ $t("loop.on") }}</span>
        <span v-else>{{ $t("loop.off") }}</span>
      </a>
    </div>
    <a class="panel-block" @click="bringToFront">
      <span class="panel-icon">
        <Icon src="bring-to-front.svg" />
      </span>
      <span>{{ $t("bring_forward") }}</span>
    </a>
    <a class="panel-block" @click="sendToBack">
      <span class="panel-icon">
        <Icon src="send-to-back.svg" />
      </span>
      <span>{{ $t("send_back") }}</span>
    </a>
    <a v-if="holdable" class="panel-block" @click="changeNickname">
      <span class="panel-icon">
        <Icon src="change-nickname.svg" />
      </span>
      <span>{{ $t("avatar_name") }}</span>
    </a>
    <a v-if="holdable" class="panel-block" @click="openVoiceSetting">
      <span class="panel-icon">
        <Icon src="voice-setting.svg" />
      </span>
      <span>{{ $t("voice_setting") }}</span>
    </a>
    <div v-if="object.multi" class="field has-addons menu-group">
      <span class="panel-block">
        <span class="panel-icon">
          <Icon src="animation-slider.svg" />
        </span>
        <span>{{ "Animation speed" }}</span>
      </span>
      <input class="input anmation-input" type="number" step="0.5" min="0" :value="animationSpeed"
        @input="handleChangeAnimationSpeed" placeholder="seconds" />
    </div>

    <div class="field has-addons menu-group">
      <p class="control menu-group-title">
        <span class="panel-icon pt-1">
          <Icon src="rotation-slider.svg" />
        </span>
        <span>{{ $t("slider") }}</span>
      </p>
      <p class="control menu-group-item">
        <a-tooltip title="Opacity slider" placement="bottom">
          <button class="button is-light" :class="{
            'has-background-primary-light': sliderMode === 'opacity',
          }" @click="changeSliderMode('opacity')">
            <span class="mt-1">
              <Icon src="opacity-slider.svg" style="width: 16px; height: 16px;" />
            </span>
          </button>
        </a-tooltip>
      </p>
      <p v-if="object.type == 'jitsi'" class="control menu-group-item">
        <a-tooltip title="Volume" placement="bottom">
          <button class="button is-light" :class="{
            'has-background-warning-light': sliderMode === 'volume',
          }" @click="changeSliderMode('volume')">
            <span class="mt-1">
              <Icon src="animation-slider.svg" style="width: 16px; height: 16px;" />
            </span>
          </button>
        </a-tooltip>
      </p>
      <p class="control menu-group-item">
        <a-tooltip title="Move speed" placement="bottom">
          <button class="button is-light" :class="{
            'has-background-danger-light': sliderMode === 'speed',
          }" @click="changeSliderMode('speed')">
            <span class="mt-1">
              <Icon src="movement-slider.svg" style="width: 16px; height: 16px;" />
            </span>
          </button>
        </a-tooltip>
      </p>
    </div>

    <div class="field has-addons menu-group">
      <p class="control menu-group-title">
        <span class="panel-icon pt-1">
          <Icon src="rotation-slider.svg" />
        </span>
        <span>{{ $t("flip") }}</span>
      </p>
      <p class="control menu-group-item">
        <a-tooltip title="Flip Horizontal" placement="bottom">
          <button class="button is-light" :class="{
            'has-background-primary-light': object.scaleX === -1,
          }" @click="flipHorizontal">
            <span class="mt-1">{{ $t("horizontal") }}</span>
          </button>
        </a-tooltip>
      </p>
      <p class="control menu-group-item">
        <a-tooltip title="Flip Vertical" placement="bottom">
          <button class="button is-light" :class="{
            'has-background-primary-light': object.scaleY === -1,
          }" @click="flipVertical">
            <span class="mt-1">{{ $t("vertical") }}</span>
          </button>
        </a-tooltip>
      </p>
    </div>
    <template v-if="hasLink">
      <a-tooltip :title="object.link.url" placement="bottom">
        <a class="panel-block" @click="openLink">
          <span class="panel-icon">
            <i class="fas fa-link"></i>
          </span>
          <span>{{ $t("open_link") }}</span>
        </a>
      </a-tooltip>
    </template>

    <a class="panel-block has-text-danger" @click="deleteObject">
      <span class="panel-icon">
        <Icon src="remove.svg" />
      </span>
      <span>{{ $t("remove") }}</span>
    </a>
    <a v-if="object.drawingId || object.textId" class="panel-block has-text-danger" @click="deletePermanently">
      <span class="panel-icon">
        <Icon src="remove.svg" />
      </span>
      <span>{{ $t("delete_permanently") }}</span>
    </a>
    <div v-if="object.multi" class="field has-addons menu-group">
      <p class="control menu-group-item" @click="toggleAutoplayFrames()">
        <button class="button is-light">
          <Icon :src="object.autoplayFrames > 0 ? 'pause.svg' : 'play.svg'" size="24" />
        </button>
      </p>
      <p v-for="frame in object.frames" :key="frame" @click="switchFrame(frame)" class="control menu-group-item">
        <button class="button is-light">
          <img :src="frame" style="height: 100%" />
        </button>
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref, type Ref } from "vue";
import Icon from "components/Icon.vue";
import { useStageStore } from "store/modules/stage";
import { useUserStore } from "store/modules/user";

const props = defineProps<{
  object: any;
  closeMenu?: () => void;
  active?: boolean;
  sliderMode?: string;
  setSliderMode?: (mode: string) => void;
  keepActive?: (val: boolean) => void;
}>();
const emit = defineEmits(["update:active", "hold"]);

const stageStore = useStageStore();
const userStore = useUserStore();

const holdable = inject("holdable") ?? ref(false);
const isWearing = inject("isWearing") as Ref<boolean> | undefined;
const currentAvatar = computed(() => stageStore.currentAvatar);
const isHolding = computed(() => props.object.holder && props.object.holder.id === stageStore.session?.id);

const holdAvatar = () => {
  userStore.setAvatarId(props.object.id ?? "");
  props.closeMenu && props.closeMenu();
};

const releaseAvatar = () => {
  userStore.setAvatarId("");
  props.closeMenu && props.closeMenu();
};

const deleteObject = () => {
  stageStore.deleteObject(props.object);
  props.closeMenu && props.closeMenu();
};

const switchFrame = (frame: string) => {
  stageStore.switchFrame({
    ...props.object,
    src: frame,
  });
};

const flipHorizontal = () => {
  const scaleX = -1 * (props.object.scaleX ?? 1);
  stageStore.shapeObject({
    ...props.object,
    scaleX,
  });
};

const flipVertical = () => {
  const scaleY = -1 * (props.object.scaleY ?? 1);
  stageStore.shapeObject({
    ...props.object,
    scaleY,
  });
};

const toggleAutoplayFrames = () => {
  stageStore.toggleAutoplayFrames({
    ...props.object,
    ...(props.object.autoplayFrames
      ? {
        autoplayFrames: null,
        lastAutoplayFrames: props.object.autoplayFrames,
      }
      : {
        autoplayFrames: props.object.lastAutoplayFrames || 1,
      }),
  });
  emit("update:active", true);
};

const changeNickname = () => {
  stageStore.openSettingPopup({ type: "ChatParameters" });
  props.closeMenu && props.closeMenu();
};

const bringToFront = () => {
  stageStore.bringToFront(props.object);
  props.closeMenu && props.closeMenu();
};

const sendToBack = () => {
  stageStore.sendToBack(props.object);
  props.closeMenu && props.closeMenu();
};

const changeSliderMode = (mode: string) => {
  props.setSliderMode && props.setSliderMode(mode);
  emit("update:active", true);
  props.keepActive && props.keepActive(true);
};

const openVoiceSetting = () => {
  stageStore.openSettingPopup({ type: "VoiceParameters" });
  props.closeMenu && props.closeMenu();
};

const wearCostume = () => {
  if (currentAvatar.value) {
    stageStore.shapeObject({
      ...props.object,
      rotate: 0,
      wornBy: currentAvatar.value.id,
    });
    props.closeMenu && props.closeMenu();
  }
};

const takeOffCostume = () => {
  if (isWearing?.value) {
    stageStore.shapeObject({
      ...props.object,
      wornBy: null,
    });
    props.closeMenu && props.closeMenu();
  }
};

const deletePermanently = () => {
  if (props.object.drawingId) {
    stageStore.deleteObject(props.object);
    // If you have a Pinia action for POP_DRAWING, call it here
  }
  if (props.object.textId) {
    stageStore.deleteObject(props.object);
    // If you have a Pinia action for POP_TEXT, call it here
  }
  props.closeMenu && props.closeMenu();
};

const hasLink = computed(() => props.object.link && props.object.link.url);
const openLink = () => {
  const { url, blank } = props.object.link;
  window.open(url, blank ? "_blank" : "_self")?.focus();
};

const animationSpeed = computed(() => {
  return props.object.autoplayFrames || "";
});
const handleChangeAnimationSpeed = (e: Event) => {
  const target = e.target as HTMLInputElement;
  stageStore.shapeObject({
    ...props.object,
    autoplayFrames: target.value,
  });
};

const pauseVideo = () => {
  stageStore.shapeObject({
    ...props.object,
    isPlaying: false,
  });
  props.closeMenu && props.closeMenu();
};
const playVideo = () => {
  stageStore.shapeObject({
    ...props.object,
    isPlaying: true,
  });
  props.closeMenu && props.closeMenu();
};
const openVolumePopup = () => {
  stageStore.openSettingPopup({ type: "VolumeParameters" });
  props.closeMenu && props.closeMenu();
};
const toggleVideoLoop = () => {
  stageStore.shapeObject({
    ...props.object,
    loop: !props.object.loop,
  });
  props.closeMenu && props.closeMenu();
};
const restartVideo = () => {
  stageStore.shapeObject({
    ...props.object,
    replayed: (props.object.replayed || 0) + 1,
  });
  props.closeMenu && props.closeMenu();
};
</script>

<style scoped lang="scss">
.avatar-context-menu {
  * {
    font-size: 14px;
  }

  .panel-block {
    &:hover {
      z-index: 100;
      position: relative;
      font-size: 14px;
    }
  }

  .menu-group {
    width: 100%;
    display: flex;
    margin-bottom: 0;

    .menu-group-title {
      flex: none;
      padding: 6px 12px;
      width: 100px;
      white-space: nowrap;

      >button {
        justify-content: start;
        padding-left: 12px;
      }
    }

    .menu-group-item {
      flex: auto;
    }

    button {
      width: 100%;
    }

    .anmation-input {
      max-width: 85px;
      background-color: white;
      margin: 4px 4px 4px auto;
      padding-top: 2px;
      padding-bottom: 2px;
      height: 28px;
    }
  }
}
</style>
