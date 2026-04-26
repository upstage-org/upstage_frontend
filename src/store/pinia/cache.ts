import { defineStore } from "pinia";
import { computed, reactive, ref } from "vue";

interface StageNode {
  id: string | number;
  visibility?: boolean;
  [key: string]: unknown;
}

/**
 * GraphQL response cache + stage list. Uses a plain reactive object as the
 * cache map so callers get key-level reactivity without triggering full
 * recomputes when unrelated keys change.
 */
export const useCacheStore = defineStore("cache", () => {
  const graphql = reactive<Record<string, unknown>>({});
  const stageList = ref<StageNode[] | null>(null);

  const loadingStages = computed<boolean>(() => stageList.value === null);
  const visibleStages = computed<StageNode[]>(() =>
    stageList.value ? stageList.value.filter((s) => s.visibility) : [],
  );

  const setGraphqlCache = (key: string, value: unknown): void => {
    graphql[key] = value;
  };
  const clearGraphqlCaches = (keys: string[]): void => {
    keys.forEach((key) => {
      delete graphql[key];
    });
  };
  const clearAllGraphqlCaches = (): void => {
    Object.keys(graphql).forEach((key) => {
      delete graphql[key];
    });
  };
  const setStageList = (list: StageNode[] | null): void => {
    stageList.value = list;
  };
  const updateStageVisibility = (stageId: string | number, visibility: boolean): void => {
    const stage = (stageList.value ?? []).find((s) => s.id === stageId);
    if (stage) stage.visibility = visibility;
  };

  return {
    graphql,
    stageList,
    loadingStages,
    visibleStages,
    setGraphqlCache,
    clearGraphqlCaches,
    clearAllGraphqlCaches,
    setStageList,
    updateStageVisibility,
  };
});
