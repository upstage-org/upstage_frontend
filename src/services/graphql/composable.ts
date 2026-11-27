import { computed, reactive, ref } from "vue";
import hash from "object-hash";
import { message } from "ant-design-vue";
import { logout } from "utils/auth";
import { useCacheStore } from "@stores/pinia/cache";

type Service = (...args: any[]) => any;
type RequestParams = [service: Service, ...params: any[]];
type LegacyGraphqlError =
  { response?: { errors?: Array<{ message?: string }> } } | null | undefined;

export const useRequest = (service: Service, ...params: any[]) => {
  const loading = ref(false);
  const data = ref<any>();
  const nodes = computed(() => {
    if (!data.value) return null;
    const value = Object.values(data.value)[0];
    return Array.isArray(value) ? value : [value];
  });
  const pushNode = (node: any, reverse?: boolean) => {
    if (data.value) {
      const key = Object.keys(data.value)[0];
      let edges = data.value[key].edges;
      if (reverse) {
        edges.unshift({ node });
      } else {
        edges.push({ node });
      }
      data.value = { [key]: { edges } };
    }
  };
  const popNode = (selector: (node: any) => boolean) => {
    if (data.value) {
      const key = Object.keys(data.value)[0];
      let edges = data.value[key].edges;
      const position = edges.findIndex((edge: any) => selector(edge.node));
      edges.splice(position, 1);
      data.value = { [key]: { edges } };
    }
  };
  const totalCount = computed(() => {
    if (!data.value) return 0;
    const key = Object.keys(data.value)[0];
    return data.value[key].totalCount;
  });
  const cacheKeys = reactive<string[]>([]);

  const fetch = async (...newParams: any[]) => {
    try {
      const payload = newParams.length ? newParams : params;
      const cacheKey = hash({ service, payload });
      const cacheStore = useCacheStore();
      const cached = cacheStore.graphql[cacheKey];
      if (cached) {
        data.value = cached;
      } else {
        loading.value = true;
        data.value = await service(...payload);
        if (data.value) {
          cacheStore.setGraphqlCache(cacheKey, data.value);
          cacheKeys.push(cacheKey);
        }
      }
      return data.value;
    } catch (error) {
      // A pure network failure has no `response`; don't crash extracting it.
      const gqlMessage = (error as LegacyGraphqlError)?.response?.errors?.[0]?.message;
      if (gqlMessage == "Invalid refresh token") {
        logout();
      }
      throw gqlMessage ?? "Network connection problem — please try again.";
    } finally {
      loading.value = false;
    }
  };
  const refetch = async (...newParams: any[]) => {
    try {
      const payload = newParams.length ? newParams : params;
      const cacheKey = hash({ service, payload });
      loading.value = true;
      data.value = await service(...payload);
      if (data.value) {
        useCacheStore().setGraphqlCache(cacheKey, data.value);
        cacheKeys.push(cacheKey);
      }
      return data.value;
    } catch (error) {
      const gqlMessage = (error as LegacyGraphqlError)?.response?.errors?.[0]?.message;
      if (gqlMessage == "Invalid refresh token") {
        logout();
      }
      throw gqlMessage ?? "Network connection problem — please try again.";
    } finally {
      loading.value = false;
    }
  };

  const clearCache = () => {
    cacheKeys.push(hash({ service, payload: params }));
    useCacheStore().clearGraphqlCaches(cacheKeys);
    cacheKeys.length = 0;
  };

  const refresh = (...params: any[]) => {
    clearCache();
    return fetch(...params);
  };

  return {
    loading,
    data,
    nodes,
    totalCount,
    fetch,
    clearCache,
    refresh,
    pushNode,
    popNode,
    refetch,
  };
};

export const useMutation = (...params: RequestParams) => {
  const { refresh, ...rest } = useRequest(...params);
  const mutation = refresh;
  const save = async (success: any, ...params: any[]) => {
    try {
      const response = await mutation(...params);
      if (typeof success === "function") {
        success(response);
      } else {
        message.success(success);
      }
      return response;
    } catch (error) {
      message.error(error as string);
    }
  };

  return { mutation, save, ...rest };
};

export const useQuery = (...params: RequestParams) => {
  const { fetch, ...rest } = useRequest(...params);
  fetch();
  return { fetch, ...rest };
};

export const useFirst = (nodes: { value?: any[] | null }) => {
  return computed(() => (nodes.value && nodes.value.length && nodes.value[0]) ?? {});
};

export function useAttribute(node: { value?: any }, attributeName: string, isJson?: boolean) {
  return computed(() => {
    let value = node.value?.attributes?.find((a: any) => a.name === attributeName)?.description;
    if (isJson && value) {
      value = JSON.parse(value);
    }
    return value;
  });
}

export function useOwners(nodes: { value?: any[] | null }) {
  return computed(() => {
    let list: any[] = [];
    if (nodes.value) {
      nodes.value.forEach(({ owner }) => {
        if (!list.some((user) => user.username === owner.username)) {
          list.push(owner);
        }
      });
    }
    return list;
  });
}
