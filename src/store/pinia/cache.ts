import { defineStore } from "pinia";
import { computed, reactive, ref } from "vue";
import { stageGraph } from "@services/graphql";
import { useRequest } from "@services/graphql/composable";

interface StageNode {
  id: string | number;
  visibility?: boolean;
  attributes?: Array<{ name: string; description: unknown }>;
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

  /**
   * Fetch the stage list from GraphQL and cache it. Mirrors the Vuex
   * `cache/fetchStages` action: attaches each node's attribute values
   * back onto the node as flat properties (legacy admin views read
   * `node.someAttribute` directly rather than walking `attributes[]`).
   *
   * On any failure the list is set to `[]` (not left at `null`) so
   * `loadingStages` flips to false and consumers don't spin forever.
   */
  const fetchStages = async (): Promise<void> => {
    try {
      const { nodes, refresh } = useRequest(stageGraph.stageList);
      await refresh();
      const list = (nodes.value ?? []) as StageNode[];
      list.forEach((node) => {
        node.attributes?.forEach((attr) => {
          (node as Record<string, unknown>)[attr.name] = attr.description;
        });
      });
      stageList.value = list;
    } catch {
      stageList.value = [];
    }
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
    fetchStages,
  };
});
