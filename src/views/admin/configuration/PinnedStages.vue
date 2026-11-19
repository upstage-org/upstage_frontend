<script setup lang="ts">
/**
 * Foyer Customisation > Pinned stages (#1568). The foyer lists stages most
 * recently active first; the stages chosen here come before all of them, in
 * this order — the Demo stage always first, or tonight's performance ahead of
 * everything. Saved as FOYER_PINNED_STAGES, a JSON list of stage ids.
 */
import { computed, ref, watch } from "vue";
import { useQuery } from "@vue/apollo-composable";
import { gql } from "@apollo/client/core";
import { useLoading } from "hooks/mutations";
import { configGraph } from "services/graphql";
import { movePinned, parsePinnedIds } from "./pinnedStages";

const props = defineProps<{
  /** The stored JSON list, as it came back from the server. */
  defaultValue: string;
  refresh?: () => Promise<void>;
}>();

interface FoyerStage {
  id: string;
  name: string;
}

const { result, loading } = useQuery<{ foyerStageList: FoyerStage[] }>(
  gql`
    query FoyerStagesForPinning {
      foyerStageList {
        id
        name
      }
    }
  `,
  null,
  { fetchPolicy: "cache-and-network" },
);
const visibleStages = computed(() => result.value?.foyerStageList ?? []);

const pinned = ref<string[]>(parsePinnedIds(props.defaultValue));
watch(
  () => props.defaultValue,
  (next) => {
    pinned.value = parsePinnedIds(next);
  },
);
const dirty = computed(
  () => JSON.stringify(pinned.value) !== JSON.stringify(parsePinnedIds(props.defaultValue)),
);

const nameOf = (id: string) => visibleStages.value.find((s) => String(s.id) === id)?.name;
const available = computed(() =>
  visibleStages.value.filter((s) => !pinned.value.includes(String(s.id))),
);
const toAdd = ref<string>();
const add = () => {
  if (toAdd.value && !pinned.value.includes(toAdd.value)) pinned.value.push(toAdd.value);
  toAdd.value = undefined;
};
const remove = (id: string) => {
  pinned.value = pinned.value.filter((v) => v !== id);
};
const move = (id: string, delta: -1 | 1) => {
  pinned.value = movePinned(pinned.value, id, delta);
};
const filterOption = (input: string, option: { label?: string }) =>
  (option.label ?? "").toLowerCase().includes(input.toLowerCase());

const { loading: saving, proceed } = useLoading(
  async () => configGraph.saveConfig("FOYER_PINNED_STAGES", JSON.stringify(pinned.value)),
  {
    loading: "Saving configuration…",
    success: () => "Configuration saved",
    error: () => "Failed to save configuration",
  },
);
const save = async () => {
  const saved = await proceed();
  if (saved !== undefined && props.refresh) await props.refresh();
};
</script>

<template>
  <a-form-item
    :label="$t('pinned_stages')"
    name="FOYER_PINNED_STAGES"
    :label-col="{ span: 12, xl: { span: 4 }, xxl: { span: 3 } }"
  >
    <p class="text-sm text-gray-500 mb-2">{{ $t("pinned_stages_help") }}</p>
    <ol v-if="pinned.length" class="pinned-list" data-testid="pinned-list">
      <li v-for="(id, index) in pinned" :key="id" :data-stage-id="id">
        <span class="order">{{ index + 1 }}.</span>
        <span class="name">{{ nameOf(id) ?? `#${id}` }}</span>
        <small v-if="!loading && !nameOf(id)" class="text-gray-500">
          ({{ $t("not_on_foyer") }})
        </small>
        <a-button size="small" :disabled="index === 0" :title="$t('move_up')" @click="move(id, -1)">
          <ArrowUpOutlined />
        </a-button>
        <a-button
          size="small"
          :disabled="index === pinned.length - 1"
          :title="$t('move_down')"
          @click="move(id, 1)"
        >
          <ArrowDownOutlined />
        </a-button>
        <a-button size="small" danger :title="$t('remove')" @click="remove(id)">
          <CloseOutlined />
        </a-button>
      </li>
    </ol>
    <p v-else class="text-sm mb-2" data-testid="pinned-empty">{{ $t("no_pinned_stages") }}</p>
    <div class="flex items-center gap-2">
      <a-select
        v-model:value="toAdd"
        show-search
        :loading="loading"
        :placeholder="$t('pin_a_stage')"
        style="min-width: 260px"
        :options="available.map((s) => ({ value: String(s.id), label: s.name }))"
        :filter-option="filterOption"
      />
      <a-button :disabled="!toAdd" @click="add"><PlusOutlined />{{ $t("pin") }}</a-button>
      <a-button type="primary" :disabled="!dirty" :loading="saving" @click="save">
        {{ $t("save") }}
      </a-button>
    </div>
  </a-form-item>
</template>

<style scoped>
.pinned-list {
  list-style: none;
  margin: 0 0 8px;
  padding: 0;
}
.pinned-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}
.pinned-list .order {
  width: 1.5em;
  text-align: right;
  color: #888;
}
.pinned-list .name {
  font-weight: 600;
}
</style>
