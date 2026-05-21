<script>
import { provide, watch } from "vue";
import { useFirst, useRequest } from "services/graphql/composable";
import { stageGraph } from "services/graphql";
import Loading from "components/Loading.vue";
// Aliased: "Header" is a reserved HTML element name (vue/no-reserved-component-names).
import AppHeader from "components/Header.vue";
import { LoginOutlined } from "@ant-design/icons-vue";

export default {
  components: { Loading, AppHeader, LoginOutlined },
  props: { id: [String, Number] },
  setup: (props) => {
    const { nodes, loading, refetch, data, refresh, clearCache } = useRequest(stageGraph.getStage);
    const stage = useFirst(nodes);
    provide("stage", stage);
    provide("refresh", refresh);
    provide("clearCache", clearCache);
    watch(
      () => props.id,
      () => {
        if (props.id) {
          refetch(props.id);
        } else {
          data.value = null;
        }
      },
      { immediate: true },
    );
    return { stage, loading };
  },
};
</script>

<template>
  <AppHeader>
    <template v-if="id">
      <a-space class="flex-wrap">
        <div class="mr-4">
          <h3 v-if="stage.name" class="stage_title mb-0">
            {{ stage.name }}
          </h3>
          <p class="mb-0">{{ $t("stage_management") }}</p>
        </div>
        <router-link v-slot="{ href }" :to="`/${stage.fileLocation}`" custom>
          <a-button type="primary" :href="href" target="_blank" rel="noopener noreferrer">
            <template #icon><LoginOutlined /></template>
            {{ $t("enter") }}
          </a-button>
        </router-link>
      </a-space>
    </template>
    <h3 v-else class="stage_title mb-0">{{ $t("create_new_stage") }}</h3>
  </AppHeader>
  <a-layout class="w-full shadow rounded-xl bg-white stage_container">
    <div class="container-fluid">
      <div class="columns">
        <div class="column is-3 is-2-fullhd">
          <aside class="menu box has-background-light mx-4">
            <ul class="menu-list">
              <li>
                <router-link
                  :to="id ? `/stages/stage-management/${id}/` : '/stages/new-stage'"
                  exact-active-class="is-active"
                  >{{ $t("general_information") }}</router-link
                >
              </li>
              <template v-if="id">
                <li>
                  <router-link to="customisation" exact-active-class="is-active">{{
                    $t("customisation")
                  }}</router-link>
                </li>
                <li id="media-menu">
                  <router-link to="media" exact-active-class="is-active">{{
                    $t("media")
                  }}</router-link>
                </li>
                <li>
                  <router-link to="archive" exact-active-class="is-active">{{
                    $t("archive")
                  }}</router-link>
                </li>
              </template>
            </ul>
          </aside>
        </div>
        <div class="column is-9 is-10-fullhd">
          <div class="pt-4 pr-4 pb-4">
            <Loading v-if="!!id && loading" />
            <router-view v-else />
          </div>
        </div>
      </div>
    </div>
  </a-layout>
</template>

<style scoped>
.stage_container {
  overflow-y: auto;
  overflow-x: hidden;
}

.stage_title {
  font-size: 22px;
  font-weight: bold;
}
</style>
