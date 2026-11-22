<script setup lang="ts">
import { useMutation, useQuery } from "@vue/apollo-composable";
import { message } from "ant-design-vue";
import { gql } from "@apollo/client/core";
import { computed, inject, PropType, ref, watch } from "vue";
import { Media, AssignedStage } from "models/studio";
import { useUserStore } from "@stores/pinia/user";
import { storeToRefs } from "pinia";
import MediaPreview from "./MediaPreview.vue";
import { uniq } from "lodash";

const props = defineProps({
  media: {
    type: Object as PropType<Media>,
    required: true,
  },
});
// Ids of the stages (among those this user manages) the item is assigned to,
// as edited in the pop-up. Loaded from the item every time the pop-up opens.
const assigned = ref<string[]>([]);
const searchAvailable = ref("");
const searchAssigned = ref("");
const visible = ref(false);
const { isAdmin } = storeToRefs(useUserStore());
const note = computed(() => {
  try {
    const description = JSON.parse(props.media.description);
    return description?.note || "";
  } catch {
    return "";
  }
});
const { result, loading } = useQuery(
  gql`
    {
      whoami {
        username
      }
      stages(input: {}) {
        edges {
          id
          name
          createdOn
          permission
          owner {
            username
            displayName
          }
        }
      }
    }
  `,
  null,
  {},
);

const dataSource = computed(() => {
  if (!result.value) return [];
  return result.value.stages.edges.filter((el: any) => {
    return isAdmin.value ? true : el.permission == "editor" || el.permission == "owner";
  });
});

type StageRow = { id: string; name: string };

// The stages this user manages, by name. Mere player access is not enough to
// assign media to a stage, so those are not offered.
const manageableStages = computed((): StageRow[] =>
  (dataSource.value as { id: string | number; name: string }[])
    .map((el) => ({ id: String(el.id), name: el.name }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
);

// (Re)load the current assignments whenever the pop-up opens, and once more
// if the stage list only arrives while it is open and nothing was changed yet.
// It used to be filled once at mount and emptied after each save, so the
// second time the pop-up opened it showed no assigned stage at all — saving
// then silently unassigned the item from the stages it was on (#1569).
let touched = false;
const loadAssigned = () => {
  const manageable = new Set(manageableStages.value.map((s) => s.id));
  assigned.value = props.media.stages
    .map((el: AssignedStage) => String(el.id))
    .filter((id: string) => manageable.has(id));
  touched = false;
};
watch([visible, manageableStages], ([open], previous) => {
  const wasOpen = previous?.[0] ?? false;
  if (!open) return;
  if (!wasOpen || !touched) loadAssigned();
  if (!wasOpen) {
    searchAvailable.value = "";
    searchAssigned.value = "";
  }
});

const matches = (name: string, query: string) =>
  !query.trim() || name.toLowerCase().includes(query.trim().toLowerCase());
const availableStages = computed(() =>
  manageableStages.value.filter(
    (s) => !assigned.value.includes(s.id) && matches(s.name, searchAvailable.value),
  ),
);
const assignedStages = computed(() =>
  manageableStages.value.filter(
    (s) => assigned.value.includes(s.id) && matches(s.name, searchAssigned.value),
  ),
);
const assignStage = (id: string) => {
  touched = true;
  if (!assigned.value.includes(id)) assigned.value = [...assigned.value, id];
};
const unassignStage = (id: string) => {
  touched = true;
  assigned.value = assigned.value.filter((s) => s !== id);
};
const { mutate } = useMutation<
  { quickAssignMutation: { asset: Media } },
  { assetId: string; stageIds: [string] }
>(gql`
  mutation QuickAssignMutation($assetId: ID!, $stageIds: [ID]!) {
    quickAssignMutation(assetId: $assetId, stageIds: $stageIds) {
      success
      message
    }
  }
`);

const refresh = inject("refresh", () => {});

const handleOk = async () => {
  // Keep the item's CURRENT assignments on stages this user cannot manage.
  // This used to send every stage the user merely had player access to,
  // whether or not the item was there, so a quick-assign quietly attached
  // the item to other people's stages (#1569). The backend keeps those
  // assignments for a non-owner anyway; this list is for the owner's save.
  const manageable = new Set(
    (result.value?.stages.edges ?? [])
      .filter((el: any) =>
        isAdmin.value ? true : el.permission == "editor" || el.permission == "owner",
      )
      .map((el: AssignedStage) => String(el.id)),
  );
  const remainIds = props.media.stages
    .filter((el: AssignedStage) => !manageable.has(String(el.id)))
    .map((el: AssignedStage) => el.id);
  const stageIds: any = assigned.value;
  try {
    await mutate({
      assetId: props.media.id,
      stageIds: uniq([...remainIds, ...stageIds]) as [string],
    });
  } catch (error) {
    // A refused assignment used to reject here unreported: the window just
    // stayed open with nothing assigned (#1569). Say why, keep the choices.
    message.error((error as Error)?.message || "The media could not be assigned");
    return;
  }
  message.success(`Stage assignments saved for ${props.media.name}`);
  refresh();
  visible.value = false;
};
</script>

<template>
  <a-button class="ml-2" type="primary" @click="visible = true">
    <plus-circle-outlined />Assign to stage
  </a-button>
  <a-modal
    v-model:visible="visible"
    class="custom-class"
    style="color: red"
    title="Assign this media to your stages"
    :width="760"
    :footer="null"
  >
    <div class="flex" style="align-items: center; justify-content: flex-start">
      <div style="max-width: 350px">
        <MediaPreview v-if="media.assetType" :media="media as Media" />
      </div>
      &nbsp;&nbsp;&nbsp;
      <h4 style="color: black">{{ media.name }}</h4>
    </div>
    <h3 style="color: black; margin-top: 20px">{{ media.copyrightLevel == 1 ? note : "" }}</h3>
    <p class="quick-assign-help help mb-3">
      Click a stage name to move it between the lists, then Save. Only stages you own or can edit
      are listed.
    </p>
    <div class="columns quick-assign-columns">
      <div class="column">
        <article class="panel is-light" data-testid="available-stages">
          <p class="panel-heading">
            Available stages
            <span class="tag is-primary">{{ availableStages.length }}</span>
          </p>
          <div class="panel-heading pt-0">
            <p class="control has-icons-left">
              <input
                v-model="searchAvailable"
                class="input is-primary"
                type="search"
                placeholder="Search stage name"
                autocomplete="off"
              />
              <span class="icon is-left">
                <i class="fas fa-search" aria-hidden="true"></i>
              </span>
            </p>
          </div>
          <div class="panel-body">
            <p v-if="loading" class="panel-block has-text-grey">Loading stages…</p>
            <p v-else-if="!availableStages.length" class="panel-block has-text-grey">
              {{
                !manageableStages.length
                  ? "You have no stages you own or can edit."
                  : searchAvailable.trim()
                    ? "No stages match your search."
                    : "All your stages are assigned."
              }}
            </p>
            <button
              v-for="stage in availableStages"
              :key="stage.id"
              type="button"
              class="panel-block quick-assign-row"
              title="Click to assign"
              @click="assignStage(stage.id)"
            >
              {{ stage.name }}
            </button>
          </div>
        </article>
      </div>
      <div class="column">
        <article class="panel is-light" data-testid="assigned-stages">
          <p class="panel-heading">
            Assigned stages
            <span class="tag is-primary">{{ assignedStages.length }}</span>
          </p>
          <div class="panel-heading pt-0">
            <p class="control has-icons-left">
              <input
                v-model="searchAssigned"
                class="input is-primary"
                type="search"
                placeholder="Search stage name"
                autocomplete="off"
              />
              <span class="icon is-left">
                <i class="fas fa-search" aria-hidden="true"></i>
              </span>
            </p>
          </div>
          <div class="panel-body">
            <p v-if="!assignedStages.length" class="panel-block has-text-grey">
              {{
                assigned.length
                  ? "No assigned stages match your search."
                  : "Not assigned to any of your stages — click names on the left."
              }}
            </p>
            <div
              v-for="stage in assignedStages"
              :key="stage.id"
              class="panel-block quick-assign-assigned"
            >
              <button
                type="button"
                class="quick-assign-row quick-assign-row--assigned"
                title="Click to unassign"
                @click="unassignStage(stage.id)"
              >
                {{ stage.name }}
              </button>
            </div>
          </div>
        </article>
      </div>
    </div>
    <div class="quick-assign-actions">
      <a-button type="primary" data-testid="save" @click="handleOk"> Save </a-button>
    </div>
  </a-modal>
</template>

<style scoped>
.quick-assign-help {
  margin-top: 12px;
  color: #000;
}
.quick-assign-columns article.panel {
  width: 100%;
}
.quick-assign-columns .panel-heading {
  font-size: unset;
}
.quick-assign-columns .panel-body {
  /* ~7 rows; the lists scroll and are searchable, so the pop-up does not
     grow with the number of stages. */
  max-height: min(17.5em, 35vh);
  overflow-y: auto !important;
}
button.quick-assign-row {
  display: block;
  width: 100%;
  margin: 0;
  padding: 0.5em 0.75em;
  border: none;
  border-radius: 0;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
button.quick-assign-row:hover {
  background-color: rgba(0, 112, 17, 0.08);
}
.quick-assign-assigned {
  display: block;
  padding: 0.25em 0.75em 0.5em;
}
button.quick-assign-row--assigned {
  background-color: rgba(0, 112, 17, 0.12);
  border-left: 3px solid #007011;
  margin-bottom: 0.35em;
}
button.quick-assign-row--assigned:hover {
  background-color: rgba(0, 112, 17, 0.18);
}
.quick-assign-actions {
  display: flex;
  justify-content: flex-end;
}
</style>
