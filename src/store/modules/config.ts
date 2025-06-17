// @ts-nocheck
import { defineStore } from 'pinia';
import { configGraph } from "services/graphql";

interface ConfigState {
  nginx: any;
  system: any;
  foyer: any;
}

export const useConfigStore = defineStore('config', {
  state: (): ConfigState => ({
    nginx: {},
    system: {},
    foyer: {},
  }),

  getters: {
    uploadLimit: (state) => state.nginx.uploadLimit ?? 1024 * 1024,
    termsOfService: (state) => state.system.termsOfService?.value,
    manual: (state) => state.system.manual?.value,
    esp: (state) => state.system.esp?.value,
    enableDonate: (state) => state.system.enableDonate?.value,
    navigations: (state) => {
      if (!state.foyer) {
        return [];
      }
      try {
        const lines = (state.foyer.menu?.value || "")
          .split("\n")
          .filter((line) => line.trim().length > 0);
        const navigations = [];
        for (const line of lines) {
          // Syntax: <title> (<url>)
          const url = line.match(/\(([^)]+)\)/); // get the url part
          const role = line.match(/\(\d,\d\d\)/); // Role can access
          let title = line.replace(">", "");
          title = title.includes("(")
            ? title.split("(")[0].trim()
            : title.trim(); // get the title part
          const menu = {
            title,
            url: url ? url[1] : null,
            seeByAdmin: role ? true : false,
          };
          if (line.trim().startsWith(">")) {
            const parent = navigations[navigations.length - 1];
            if (!parent.children) {
              parent.children = [];
            }
            parent.children.push(menu);
          } else {
            navigations.push(menu);
          }
        }
        return navigations;
      } catch (error) {
        console.log(error);
        return [];
      }
    },
  },

  actions: {
    async fetchConfig() {
      const configs = await configGraph.configs();
      this.nginx = configs?.nginx;
      this.system = configs?.system;
      this.foyer = configs?.foyer;
    },
  },
});
