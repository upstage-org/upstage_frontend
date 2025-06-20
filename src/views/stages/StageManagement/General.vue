<template>
  <div class="columns">
    <div class="column" align="right">
      <template v-if="stage.id">
        <button class="button ml-2 is-primary" :class="{ 'is-loading': loading }" @click="updateStage"
          :disabled="!urlValid">
          {{ $t("save_stage") }}
        </button>
        <ClearChatInStage />
        <SweepStage />
        <DuplicateStage :stage="stage">
          <button class="button ml-2 is-primary">{{ $t("duplicate") }}</button>
        </DuplicateStage>
        <DeleteStage :stage="stage" :refresh="afterDelete">
          <button class="button ml-2 is-danger">
            {{ $t("delete_stage") }}
          </button>
        </DeleteStage>
      </template>
      <template v-else>
        <button class="button ml-2 is-primary" :class="{ 'is-loading': loading }" @click="createStage"
          :disabled="!urlValid">
          {{ $t("create_stage") }}
        </button>
      </template>
    </div>
  </div>
  <div>
    <div class="field is-horizontal">
      <div class="field-label is-normal">
        <label class="label">{{ $t("stage_name") }}</label>
      </div>
      <div class="field-body">
        <Field placeholder="Full Name" v-model="form.name" required requiredMessage="Stage name is required" expanded
          class="half-flex" />
        <Field required placeholder="URL" v-model="form.fileLocation" requiredMessage="URL is required" expanded
          @keyup="urlValid = null" @input="checkURL" :right="validatingURL
            ? 'fas fa-circle-notch fa-spin'
            : urlValid === true
              ? 'fas fa-check'
              : urlValid === false
                ? 'fas fa-times'
                : 'fas'
            " :help="!form.fileLocation &&
              `URL must be unique and can't be changed! Please avoid typos, unnecessarily long urls, spaces and punctuation inside URL.`
              " :error="urlError" :disabled="!!stage.id" class="half-flex" maxlength="20" />
      </div>
    </div>

    <div class="field is-horizontal">
      <div class="field-label is-normal">
        <label class="label">{{ $t("description") }}</label>
      </div>
      <div class="field-body">
        <div class="field">
          <div class="control">
            <textarea class="textarea"
              placeholder="enter a description that will appear on the screen while your Stage is loading."
              v-model="form.description"></textarea>
          </div>
        </div>
      </div>
    </div>

    <div class="field is-horizontal" v-if="stage">
      <div class="field-label">
        <label class="label">{{ $t("status") }}</label>
      </div>
      <div class="field-body">
        <div class="field is-narrow">
          <a-tooltip placement="bottom">
            <template #title>{{ form.status === 'live' ? 'Live' : 'Rehearsal' }}</template>
            <Switch :model-value="form.status === 'live'"
              @update:model-value="form.status = $event ? 'live' : 'rehearsal'" />
          </a-tooltip>
        </div>
        <p class="help">
          The public can only enter your stage when its status is Live. With
          Rehearsal status, only players who have access to the stage can enter.
        </p>
      </div>
    </div>

    <div class="field is-horizontal" v-if="stage">
      <div class="field-label">
        <label class="label">{{ $t("visibility") }}</label>
      </div>
      <div class="field-body">
        <div class="field is-narrow">
          <a-tooltip placement="bottom">
            <template #title>{{ form.visibility ? 'On' : 'Off' }}</template>
            <Switch v-model="form.visibility" />
          </a-tooltip>
        </div>
        <p class="help">
          Select whether this Stage is visible in the Foyer or not.
        </p>
      </div>
    </div>

    <div class="field is-horizontal">
      <div class="field-label is-normal">
        <label class="label">{{ $t("player_access") }}</label>
        <p class="help">
          Click on a player's name to move them to the column to the right. Use
          a right-click to move them back to the left.
        </p>
      </div>
      <div class="field-body" style="flex-wrap: wrap">
        <MultiTransferAccessColumn :columns="[
          'Audience access only',
          'Player access',
          'Player and edit access',
        ]" :data="users" :owner="owner" :renderLabel="displayName" :renderValue="(item) => item.id" :renderKeywords="(item) =>
          `${item.firstName} ${item.lastName} ${item.username} ${item.email} ${item.displayName}`
          " v-model="playerAccess" />
      </div>
    </div>

    <div class="field is-horizontal">
      <div class="field-label">
        <label class="label">{{ $t("cover_image") }}</label>
      </div>
      <div class="field-body">
        <Dropzone>
          <ImagePicker v-model="form.cover" />
        </Dropzone>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useAttribute, useQuery } from "services/graphql/composable";
import { userGraph } from "services/graphql";
import { inject, watch, computed, provide } from "vue";
import Field from "components/form/Field.vue";
import ImagePicker from "components/form/ImagePicker.vue";
import MultiTransferAccessColumn from "components/MultiTransferAccessColumn.vue";
import { displayName } from "utils/common";
import ClearChatInStage from "./ClearChat.vue";
import SweepStage from "./SweepStage.vue";
import DuplicateStage from "components/stage/DuplicateStage.vue";
import DeleteStage from "components/stage/DeleteStage.vue";
import Switch from "components/form/Switch.vue";
import { useUserStore } from "store/modules/user";
import { useStageManagementStore } from "store/modules/stageManagement";
import { debounce } from "utils/common";

const stage = inject("stage");
const clearCache = inject("clearCache");
const userStore = useUserStore();
const stageManagementStore = useStageManagementStore();

// Initialize form with stage data
stageManagementStore.setForm({
  fileLocation: "",
  ...stage.value,
  ownerId: stage.value.owner?.id,
  status: useAttribute(stage, "status").value ?? "rehearsal",
  cover: useAttribute(stage, "cover").value,
});

// Initialize player access
const playerAccess = computed({
  get: () => stageManagementStore.playerAccess,
  set: (val) => stageManagementStore.setPlayerAccess(val)
});

// Fetch users list
const { nodes } = useQuery(userGraph.userList);
const users = computed(() =>
  nodes.value
    ? nodes.value.filter((u) => {
      if (stage.value && stage.value.owner) {
        return u.username !== stage.value.owner.username;
      }
      return u.username !== userStore.whoami?.username;
    })
    : [],
);

const owner = computed(() =>
  nodes.value
    ? nodes.value.find((u) => {
      if (stage.value && stage.value.owner) {
        return u.username === stage.value.owner.username;
      }
      return u.username === userStore.whoami?.username;
    })
    : [],
);

// Computed properties
const form = computed(() => stageManagementStore.form);
const loading = computed(() => stageManagementStore.loading);
const validatingURL = computed(() => stageManagementStore.validatingURL);
const urlValid = computed(() => stageManagementStore.urlValid);

// Methods
const createStage = () => stageManagementStore.createStage();
const updateStage = async () => {
  const success = await stageManagementStore.updateStage();
  if (success && clearCache) {
    clearCache();
  }
};

const checkURL = debounce(async () => {
  await stageManagementStore.checkURL(form.value.fileLocation, stage.value?.fileLocation);
}, 500);

const urlError = computed(() =>
  stageManagementStore.getUrlError(form.value.fileLocation)
);

const afterDelete = () => stageManagementStore.afterDelete();
const afterDuplicate = () => stageManagementStore.afterDuplicate();

provide("afterDuplicate", afterDuplicate);
</script>

<style scoped>
.half-flex {
  flex: none;
  flex-basis: 50%;
}
</style>
