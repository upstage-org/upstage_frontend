// @ts-nocheck
import { ref, computed } from "vue";
import { useCacheStore } from "store/modules/cache";
import { message } from "ant-design-vue";
import { configGraph } from "services/graphql";
import { logout } from "utils/auth";

export function useRequest<T>(request: (variables?: any) => Promise<T>) {
  const loading = ref(false);
  const error = ref<Error | null>(null);
  const nodes = ref<T | null>(null);
  const cacheStore = useCacheStore();

  const refresh = async (variables?: any) => {
    loading.value = true;
    error.value = null;
    try {
      const result = await request(variables);
      nodes.value = result;
      return result;
    } catch (e) {
      error.value = e as Error;
      throw e;
    } finally {
      loading.value = false;
    }
  };

  return {
    loading,
    error,
    nodes,
    refresh,
  };
}

export function useAttribute<T extends { value: any }>(
  object: T,
  key: string,
  isJson = false
) {
  const value = computed(() => {
    if (!object.value) return null;
    const attr = object.value.attributes?.find((a: any) => a.name === key);
    if (!attr) return null;
    if (isJson) {
      try {
        return JSON.parse(attr.description);
      } catch {
        return null;
      }
    }
    return attr.description;
  });

  return {
    value,
  };
}

export function useGraphqlCache<T>(cacheKey: string) {
  const cached = cacheStore.graphql[cacheKey];
  if (cached) {
    return cached as T;
  }
  return null;
}

export function setGraphqlCache<T>(cacheKey: string, value: T) {
  cacheStore.setGraphqlCache(cacheKey, value);
}

export function clearGraphqlCaches(cacheKeys: string[]) {
  cacheStore.clearGraphqlCaches(cacheKeys);
}

export function clearAllGraphqlCaches() {
  cacheStore.clearAllGraphqlCaches();
}

export const useMutation = (...params) => {
  const { refresh, ...rest } = useRequest(...params);
  const mutation = refresh;
  const prm = params[0];
  const save = async (success, ...params) => {
    try {
      const response = await mutation(...params);
      if (typeof success === "function") {
        success(response);
      } else {
        if (prm === configGraph.sendEmail) {
          message.emailSuccess(success); //notification.emailSuccess(success);
        } else {
          message.success(success);
        }
      }
      return response;
    } catch (error) {
      if (prm === configGraph.sendEmail) {
        message.error(error);// notification.emailError(error);
      } else {
        message.error(error);
      }
    }
  };

  return { mutation, save, ...rest };
};

export const useQuery = (...params) => {
  const { fetch, ...rest } = useRequest(...params);
  fetch();
  return { fetch, ...rest };
};

export const useFirst = (nodes) => {
  return computed(
    () => (nodes.value && nodes.value.length && nodes.value[0]) ?? {},
  );
};

export function useOwners(nodes) {
  return computed(() => {
    let list = [];
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
