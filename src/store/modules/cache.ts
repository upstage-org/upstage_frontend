import { defineStore } from 'pinia';
import { stageGraph } from "services/graphql";
import { useRequest } from "services/graphql/composable";

interface Stage {
  id: string;
  visibility: boolean;
  attributes: Array<{
    name: string;
    description: string;
  }>;
  [key: string]: any;
}

interface CacheState {
  graphql: Record<string, any>;
  stageList: Stage[] | null;
}

export const useCacheStore = defineStore('cache', {
  state: (): CacheState => ({
    graphql: {},
    stageList: null,
  }),

  getters: {
    loadingStages: (state) => state.stageList === null,
    visibleStages: (state) => state.stageList ? state.stageList.filter((s) => s.visibility) : [],
  },

  actions: {
    setGraphqlCache(key: string, value: any) {
      this.graphql[key] = value;
    },

    clearGraphqlCaches(keys: string[]) {
      keys.forEach((key) => {
        delete this.graphql[key];
      });
    },

    clearAllGraphqlCaches() {
      Object.keys(this.graphql).forEach((key) => {
        delete this.graphql[key];
      });
    },

    setStageList(list: Stage[] | null) {
      this.stageList = list;
    },

    updateStageVisibility(stageId: string, visibility: boolean) {
      const stage = (this.stageList || []).find((s) => s.id === stageId);
      if (stage) {
        stage.visibility = visibility;
      }
    },

    async fetchStages() {
      try {
        const { nodes, refresh } = useRequest(stageGraph.stageList);
        await refresh();
        if (nodes.value) {
          nodes.value.forEach((node: Stage) => {
            node.attributes.forEach(
              (attr: { name: string; description: string }) => (node[attr.name] = attr.description),
            );
          });
        }
        this.setStageList(nodes.value as Stage[]);
      } catch {
        this.setStageList([]);
      }
    },
  },
});
