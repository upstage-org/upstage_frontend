<script setup lang="ts">
import { useQuery } from "@vue/apollo-composable";
import { gql } from "@apollo/client/core";
import { computed, PropType, ref } from "vue";
import { includesIgnoreCase } from "utils/common";
import { useUserStore } from "@stores/pinia/user";
import { storeToRefs } from "pinia";
import ExitSettings from "components/media/ExitSettings.vue";
import { DEFAULT_EXIT_ANIMATION, DEFAULT_EXIT_SPEED } from "components/stage/removalAnimations";
import { StageAssignmentValue } from "models/studio";

const props = defineProps({
  modelValue: {
    type: Array as PropType<StageAssignmentValue[]>,
    required: true,
  },
});

const emits = defineEmits(["update:modelValue"]);
const { isAdmin } = storeToRefs(useUserStore());

const { result } = useQuery(
  gql`
    {
      getAllStages {
        id
        name
        permission
      }
    }
  `,
  null,
  { fetchPolicy: "cache-and-network" },
);

type StageRow = { key: string; name: string };

const stages = computed((): StageRow[] => {
  if (result.value?.getAllStages) {
    return result.value.getAllStages
      .filter((el: { permission: string }) =>
        isAdmin.value ? true : el.permission == "editor" || el.permission == "owner",
      )
      .map(({ id, name }: { id: string; name: string }) => ({ key: id, name }))
      .sort((a: StageRow, b: StageRow) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      );
  }
  return [];
});

const assignedIdSet = computed(() => new Set(props.modelValue.map((a) => String(a.stageId))));

const searchAvailable = ref("");
const searchAssigned = ref("");

const availableStages = computed(() =>
  stages.value.filter(
    (s) =>
      !assignedIdSet.value.has(String(s.key)) &&
      (!searchAvailable.value.trim() || includesIgnoreCase(s.name, searchAvailable.value.trim())),
  ),
);

type AssignedRow = StageRow & { assignment: StageAssignmentValue };

const assignedStages = computed((): AssignedRow[] => {
  const byId = new Map(stages.value.map((s) => [String(s.key), s]));
  const ordered: AssignedRow[] = [];
  for (const assignment of props.modelValue) {
    const row = byId.get(String(assignment.stageId));
    if (row) ordered.push({ ...row, assignment });
  }
  const q = searchAssigned.value.trim();
  if (!q) return ordered;
  return ordered.filter((s) => includesIgnoreCase(s.name, q));
});

function assignStage(id: string) {
  const sid = String(id);
  if (props.modelValue.some((a) => String(a.stageId) === sid)) return;
  emits("update:modelValue", [
    ...props.modelValue,
    { stageId: sid, exitAnimation: DEFAULT_EXIT_ANIMATION, exitSpeed: DEFAULT_EXIT_SPEED },
  ]);
}

function unassignStage(id: string) {
  const sid = String(id);
  emits(
    "update:modelValue",
    props.modelValue.filter((a) => String(a.stageId) !== sid),
  );
}

function updateAssignment(id: string, patch: Partial<StageAssignmentValue>) {
  const sid = String(id);
  emits(
    "update:modelValue",
    props.modelValue.map((a) => (String(a.stageId) === sid ? { ...a, ...patch } : a)),
  );
}

function availableEmptyMessage(): string {
  if (stages.value.length === 0) return "No stages available.";
  if (searchAvailable.value.trim()) return "No stages match your search.";
  const allAssigned =
    stages.value.length > 0 && stages.value.every((s) => assignedIdSet.value.has(String(s.key)));
  if (allAssigned) return "All stages are assigned.";
  return "No stages match your search.";
}

function assignedEmptyMessage(): string {
  if (props.modelValue.length === 0) return "No stages assigned yet — click names on the left.";
  return "No assigned stages match your search.";
}
</script>

<template>
  <div>
    <p class="stage-assignment-help help mb-3">
      Click a stage name to move it between the lists — the same interaction as assigning player
      access on Stage Management. Each assigned stage has its own exit animation for this item. Use
      Save on the media form when you are finished.
    </p>
    <div class="columns stage-assignment-columns">
      <div class="column">
        <article class="panel is-light">
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
            <p v-if="!availableStages.length" class="panel-block has-text-grey">
              {{ availableEmptyMessage() }}
            </p>
            <button
              v-for="stage in availableStages"
              :key="stage.key"
              type="button"
              class="panel-block stage-assignment-row"
              @click="assignStage(stage.key)"
            >
              {{ stage.name }}
            </button>
          </div>
        </article>
      </div>
      <div class="column">
        <article class="panel is-light">
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
              {{ assignedEmptyMessage() }}
            </p>
            <div
              v-for="stage in assignedStages"
              :key="stage.key"
              class="panel-block stage-assignment-assigned"
            >
              <button
                type="button"
                class="stage-assignment-row stage-assignment-row--assigned"
                title="Click to unassign"
                @click="unassignStage(stage.key)"
              >
                {{ stage.name }}
              </button>
              <ExitSettings
                compact
                :animation="stage.assignment.exitAnimation"
                :speed="stage.assignment.exitSpeed"
                @update:animation="updateAssignment(stage.key, { exitAnimation: $event })"
                @update:speed="updateAssignment(stage.key, { exitSpeed: $event })"
              />
            </div>
          </div>
        </article>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stage-assignment-help {
  max-width: 52rem;
}

.stage-assignment-columns article.panel {
  width: 100%;
}

.stage-assignment-columns .panel-heading {
  font-size: unset;
}

.stage-assignment-columns .panel-body {
  /* ~7 rows; the list scrolls and is searchable, so the dialog must not
     grow with the number of stages (50vh pushed Save off-screen). */
  max-height: min(17.5em, 35vh);
  overflow-y: auto !important;
}

button.stage-assignment-row {
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

button.stage-assignment-row:hover {
  background-color: rgba(0, 112, 17, 0.08);
}

.stage-assignment-assigned {
  display: block;
  padding: 0.25em 0.75em 0.5em;
}

button.stage-assignment-row--assigned {
  background-color: rgba(0, 112, 17, 0.12);
  border-left: 3px solid #007011;
  margin-bottom: 0.35em;
}

button.stage-assignment-row--assigned:hover {
  background-color: rgba(0, 112, 17, 0.18);
}
</style>
