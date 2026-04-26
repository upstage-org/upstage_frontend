import { defineStore } from "pinia";
import { computed, reactive } from "vue";

interface ConfigValue {
  value?: string;
}

interface ConfigState {
  nginx: { uploadLimit?: number };
  system: {
    termsOfService?: ConfigValue;
    manual?: ConfigValue;
    esp?: ConfigValue;
    enableDonate?: ConfigValue;
    emailSignature?: ConfigValue;
    addingEmailSignature?: ConfigValue;
  };
  foyer: {
    title?: ConfigValue;
    description?: ConfigValue;
    menu?: ConfigValue;
    showRegistration?: ConfigValue;
  } | null;
}

interface NavigationItem {
  title: string;
  url: string | null;
  seeByAdmin: boolean;
  children?: NavigationItem[];
}

export const useConfigStore = defineStore("config", () => {
  const state = reactive<ConfigState>({
    nginx: {},
    system: {},
    foyer: null,
  });

  const uploadLimit = computed<number>(
    () => state.nginx.uploadLimit ?? 1024 * 1024,
  );
  const termsOfService = computed(() => state.system.termsOfService?.value);
  const manual = computed(() => state.system.manual?.value);
  const esp = computed(() => state.system.esp?.value);
  const enableDonate = computed(() => state.system.enableDonate?.value);
  const foyer = computed(() => state.foyer ?? {});
  const system = computed(() => state.system ?? {});
  const navigations = computed<NavigationItem[]>(() => {
    if (!state.foyer) return [];
    try {
      const lines = (state.foyer.menu?.value ?? "")
        .split("\n")
        .filter((line) => line.trim().length > 0);
      const result: NavigationItem[] = [];
      for (const line of lines) {
        const urlMatch = line.match(/\(([^)]+)\)/);
        const roleMatch = line.match(/\(\d,\d\d\)/);
        let title = line.replace(">", "");
        title = title.includes("(") ? title.split("(")[0]!.trim() : title.trim();
        const menu: NavigationItem = {
          title,
          url: urlMatch ? urlMatch[1]! : null,
          seeByAdmin: !!roleMatch,
        };
        if (line.trim().startsWith(">")) {
          const parent = result[result.length - 1];
          if (parent) {
            parent.children ??= [];
            parent.children.push(menu);
          }
        } else {
          result.push(menu);
        }
      }
      return result;
    } catch (error) {
      console.error("config navigations parse failed", error);
      return [];
    }
  });

  const setConfig = (configs: Partial<ConfigState>) => {
    Object.assign(state, configs);
  };

  return {
    state,
    uploadLimit,
    termsOfService,
    manual,
    esp,
    enableDonate,
    foyer,
    system,
    navigations,
    setConfig,
  };
});
