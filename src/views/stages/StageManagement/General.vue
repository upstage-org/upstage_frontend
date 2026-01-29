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
    <div class="field is-horizontal" v-if="stage">
      <div class="field-label">
        <label class="label">{{ $t("assign_owner") }}</label>
      </div>
      <div class="field-body">
        <div class="field is-narrow">
          <div class="control">
            <a-select v-model:value="form.owner" placeholder="Select stage owner" :loading="loadingUsers" show-search
              :filter-option="false" @search="handleOwnerSearch" @dropdown-visible-change="handleOwnerDropdownChange"
              style="width: 300px" :options="filteredOwnerUsers.map(user => ({
                value: user.id,
                label: getOwnerDisplayName(user),
                key: user.id
              }))" />
          </div>
        </div>
        <p class="help">
          Select the user who will own and manage this stage.
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
          'Player and edit access'
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

<script>
import {
  useAttribute,
  useMutation,
  useQuery,
  useRequest,
} from "services/graphql/composable";
import { stageGraph, userGraph } from "services/graphql";
import { inject, reactive, ref, watch, computed, provide } from "vue";
import Field from "components/form/Field.vue";
import ImagePicker from "components/form/ImagePicker.vue";
import MultiTransferAccessColumn from "components/MultiTransferAccessColumn.vue";
import { useRouter } from "vue-router";
import { displayName, debounce } from "utils/common";
import ClearChatInStage from "./ClearChat.vue";
import SweepStage from "./SweepStage.vue";
import DuplicateStage from "components/stage/DuplicateStage.vue";
import DeleteStage from "components/stage/DeleteStage.vue";
import { useStore } from "vuex";
import Switch from "components/form/Switch.vue";
import { message } from "ant-design-vue";
import { handleError } from 'utils/common';

export default {
  components: {
    Field,
    ClearChatInStage,
    SweepStage,
    MultiTransferAccessColumn,
    ImagePicker,
    DuplicateStage,
    DeleteStage,
    Switch,
  },
  setup: () => {
    const store = useStore();
    const whoami = computed(() => store.getters["user/whoami"]);
    const router = useRouter();
    const stage = inject("stage");
    const clearCache = inject("clearCache");

    const playerAccess = ref(
      useAttribute(stage, "playerAccess", true).value ?? [],
    );

    // Get initial status from attribute, normalize to lowercase, default to "rehearsal"
    const initialStatus = useAttribute(stage, "status").value;
    const normalizedStatus = initialStatus 
      ? String(initialStatus).toLowerCase() 
      : "rehearsal";
    const validStatus = (normalizedStatus === "live" || normalizedStatus === "rehearsal") 
      ? normalizedStatus 
      : "rehearsal";

    const form = reactive({
      fileLocation: "",
      ...stage.value,
      owner: stage.value.owner?.id,
      status: validStatus, // Ensure status is always "live" or "rehearsal"
      cover: useAttribute(stage, "cover").value || null,
      playerAccess: JSON.stringify(playerAccess.value),
      visibility: stage.value?.visibility !== undefined ? stage.value.visibility : true,
    });

    watch(playerAccess, (val) => {
      form.playerAccess = JSON.stringify(val);
    });

    const { nodes, loading: loadingUsers } = useQuery(userGraph.userList);
    const users = computed(() =>
      nodes.value
        ? nodes.value.filter((u) => {
          if (stage.value && stage.value.owner) {
            return u.username !== stage.value.owner.username;
          }
          return u.username !== whoami?.value.username;
        })
        : [],
    );

    const owner = computed(() =>
      nodes.value
        ? nodes.value.find((u) => {
          if (stage.value && stage.value.owner) {
            return u.username === stage.value.owner.username;
          }
          return u.username === whoami?.value.username;
        })
        : [],
    );

    const ownerSearchValue = ref('');
    const allUsers = computed(() => nodes.value || []);

    const filteredOwnerUsers = computed(() => {
      if (!ownerSearchValue.value) {
        return allUsers.value;
      }

      const search = ownerSearchValue.value.toLowerCase();
      return allUsers.value.filter(user => {
        const displayName = getOwnerDisplayName(user).toLowerCase();
        const username = user.username?.toLowerCase() || '';
        const email = user.email?.toLowerCase() || '';
        const firstName = user.firstName?.toLowerCase() || '';
        const lastName = user.lastName?.toLowerCase() || '';

        return displayName.includes(search) ||
          username.includes(search) ||
          email.includes(search) ||
          firstName.includes(search) ||
          lastName.includes(search);
      });
    });

    const handleOwnerSearch = (value) => {
      ownerSearchValue.value = value;
    };

    const handleOwnerDropdownChange = (open) => {
      if (!open) {
        ownerSearchValue.value = '';
      }
    };

    const getOwnerDisplayName = (user) => {
      if (user.displayName) {
        return user.displayName;
      }
      return user.username;
    };

    watch(whoami, () => {
      if (whoami.value && !stage.value.id) {
        form.owner = whoami.value.id;
      }
    }, { immediate: true });

    watch(() => form.owner, (newOwnerId, oldOwnerId) => {
      if (oldOwnerId && newOwnerId !== oldOwnerId && whoami.value) {
        if (newOwnerId !== whoami.value.id) {
          const currentPlayerAccess = [...playerAccess.value];

          while (currentPlayerAccess.length < 2) {
            currentPlayerAccess.push([]);
          }

          const currentUserIdStr = String(whoami.value.id);

          const userAlreadyInAccess = currentPlayerAccess.some(accessLevel =>
            accessLevel.some(userId => userId === currentUserIdStr)
          );

          if (!userAlreadyInAccess) {
            currentPlayerAccess[1].push(currentUserIdStr);
            playerAccess.value = currentPlayerAccess;
          }
        }
      }
    });

    const { loading, mutation } = useMutation(
      stage.value.id ? stageGraph.updateStage : stageGraph.createStage,
      form,
    );
    const createStage = async () => {
      try {
        // Ensure playerAccess is set from the reactive playerAccess ref
        form.playerAccess = JSON.stringify(playerAccess.value);
        // Pass the current form state explicitly to ensure all changes are included
        const stage = await mutation(form);
        message.success("Stage created successfully!");
        store.dispatch("cache/fetchStages");
        router.push(`/stages/stage-management/${stage.id}/`);
      } catch (error) {
        message.error(error);
      }
    };
    const updateStage = async () => {
      try {
        // ALWAYS send ALL current values to backend - no conditional logic
        // Backend will handle defaults if values are missing

        // PlayerAccess - always send current value as JSON string
        const playerAccessJson = JSON.stringify(playerAccess.value || []);

        // Status - always send current value, must be "live" or "rehearsal"
        const statusValue = (form.status === "live" || form.status === "rehearsal")
          ? form.status
          : "rehearsal";

        // Visibility - always send current boolean value
        const visibilityValue = form.visibility !== undefined
          ? Boolean(form.visibility)
          : (stage.value?.visibility !== undefined ? Boolean(stage.value.visibility) : true);

        // Cover - always send current value (can be empty string or URL)
        const coverValue = form.cover || "";

        // Owner - always send current value
        const ownerValue = form.owner || stage.value?.owner?.id || null;

        // Config - preserve existing config from Customisation page
        const existingConfigAttr = stage.value?.attributes?.find(a => a.name === 'config');
        const configValue = existingConfigAttr?.description || null;

        // Description - send current value (can be empty string)
        const descriptionValue = form.description !== undefined ? form.description : "";

        // Build the payload with ALL current values - ALWAYS send everything
        const payload = {
          id: form.id,
          name: form.name || "",
          description: descriptionValue,
          fileLocation: form.fileLocation || "",
          status: statusValue,
          visibility: visibilityValue,
          cover: coverValue,
          playerAccess: playerAccessJson,
          owner: ownerValue,
          config: configValue,
        };

        console.log('Saving General Information with ALL values:', {
          stageId: payload.id,
          name: payload.name,
          description: payload.description,
          fileLocation: payload.fileLocation,
          status: payload.status,
          visibility: payload.visibility,
          cover: payload.cover,
          playerAccess: payload.playerAccess,
          owner: payload.owner,
          config: payload.config ? 'preserved' : 'none',
        });

        // Send the complete payload to backend
        await mutation(payload);
        message.success("Stage updated successfully!");

        // Update Vuex cache
        store.commit("cache/UPDATE_STAGE_VISIBILITY", {
          stageId: form.id,
          visibility: visibilityValue,
        });

        // Clear cache to force refresh
        clearCache();
      } catch (error) {
        handleError(error);
      }
    };

    const preservedPaths = [
      "backstage",
      "login",
      "register",
      "static",
      "studio",
      "replay",
      "api",
    ];
    const urlValid = ref(!!stage.value.id);
    const { loading: validatingURL, fetch } = useRequest(stageGraph.stageList);

    const validRegex = /^[a-zA-Z0-9-_]*$/;
    const checkURL = debounce(async () => {
      const url = form.fileLocation.trim();
      if (!url || !validRegex.test(url) || preservedPaths.includes(url)) {
        urlValid.value = false;
        return;
      }
      const response = await fetch({
        fileLocation: url,
      });
      urlValid.value = true;
      if (response.stages.length) {
        const existingStage = response.stages[0];
        if (existingStage.fileLocation !== stage.value.fileLocation) {
          urlValid.value = false;
        }
      }
    }, 500);

    const urlError = computed(() => {
      if (!validRegex.test(form.fileLocation)) {
        return "URL cannot contain special characters or spaces!";
      }
      if (preservedPaths.includes(form.fileLocation.trim())) {
        return `These URL are not allowed: ${preservedPaths.join(", ")}`;
      }
      if (!urlValid.value && form.fileLocation) {
        return "This URL already existed!";
      }
      return null;
    });

    const afterDelete = () => {
      store.dispatch("cache/fetchStages");
      router.push("/stages");
    };

    const afterDuplicate = () => {
      store.dispatch("cache/fetchStages");
    };

    provide("afterDuplicate", afterDuplicate);

    return {
      form,
      stage,
      createStage,
      updateStage,
      loading,
      loadingUsers,
      users,
      owner,
      displayName,
      checkURL,
      validatingURL,
      urlValid,
      playerAccess,
      afterDelete,
      urlError,
      allUsers,
      filteredOwnerUsers,
      handleOwnerSearch,
      handleOwnerDropdownChange,
      getOwnerDisplayName,
      ownerSearchValue,
    };
  },
};
</script>

<style scoped>
.half-flex {
  flex: none;
  flex-basis: 50%;
}

:deep(.ant-select) {
  max-width: 300px;
}

:deep(.ant-select .ant-select-selector) {
  border: 1px solid #dbdbdb;
  border-radius: 4px;
  padding: 8px 12px;
  min-height: 40px;
}

:deep(.ant-select-focused .ant-select-selector) {
  border-color: #3273dc;
  box-shadow: 0 0 0 2px rgba(50, 115, 220, 0.25);
}
</style>