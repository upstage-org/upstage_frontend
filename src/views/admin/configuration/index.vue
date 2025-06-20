<script lang="ts" setup>
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";
import Entry from "./entry.vue";
import { h, computed } from "vue";
import { useAsyncState } from "@vueuse/core";
import { Skeleton, Space } from "ant-design-vue";
import Header from "components/Header.vue";
import { useConfigStore } from "store/modules/config";
import { storeToRefs } from "pinia";

const configStore = useConfigStore();
const { foyer, system } = storeToRefs(configStore);
const route = useRoute();
const activeKey = ref(route.query.tab === "system" ? "system" : "foyer");
const { t } = useI18n();

const foyerConfigs = () =>
  foyer.value && system.value
    ? [
      h(Entry, {
        label: t("title"),
        name: "FOYER_TITLE",
        defaultValue: foyer.value.title?.value ?? "",
      }),
      h(Entry, {
        label: t("description"),
        multiline: true,
        name: "FOYER_DESCRIPTION",
        defaultValue: foyer.value.description?.value ?? "",
        richTextEditor: true
      }),
      h(Entry, {
        label: t("menu"),
        multiline: true,
        name: "FOYER_MENU",
        defaultValue: foyer.value.menu?.value ?? "",
        help: h("pre", { class: "text-sm" }, [
          `Syntax: "Title (URL)"
For example: Development (https://github.com/upstage-org/upstage/)
Put the navigation links line by line. Put > before the line to make it nested inside parent menu.
For example:
About
> FAQ (https://upstage.org.nz/?page_id=115)
> Contact (/contact)`,
        ]),
      }),
      h(Entry, {
        label: t("registration_button"),
        name: "SHOW_REGISTRATION",
        defaultValue: foyer.value.showRegistration?.value ?? false,
      }),
      h(Entry, {
        label: t("enable_upstage_donate"),
        name: "ENABLE_DONATE",
        defaultValue: system.value.enableDonate?.value ?? false,
      }),
    ]
    : [h(Skeleton)];

const systemConfigs = () =>
  system.value
    ? [
      h(Entry, {
        label: t("tos.terms_of_service"),
        name: "TERMS_OF_SERVICE",
        defaultValue: system.value.termsOfService?.value ?? "",
      }),
      h(Entry, {
        label: t("manual"),
        name: "MANUAL",
        defaultValue: system.value.manual?.value ?? "",
        async refresh() {
          await configStore.fetchConfig();
        },
      }),
      h(Entry, {
        label: t("email_subject_prefix"),
        name: "EMAIL_SUBJECT_PREFIX",
        defaultValue: system.value.esp?.value ?? "",
      }),
      h(Entry, {
        label: t("email_signature"),
        multiline: true,
        name: "EMAIL_SIGNATURE",
        defaultValue: system.value?.emailSignature?.value ?? "",
        richTextEditor: true,
      })
    ]
    : [h(Skeleton)];
</script>

<template>
  <Header>
    <Space><span /></Space>
  </Header>
  <a-layout class="w-full shadow rounded-xl bg-white px-4 overflow-y-auto">
    <a-tabs v-model:activeKey="activeKey" type="card">
      <template #leftExtra>
        <a-tag color="#007011">
          <SettingOutlined /> UpStage Configurations
        </a-tag>
      </template>
      <a-tab-pane key="foyer" :tab="t('foyer_customisation')">
        <foyerConfigs />
      </a-tab-pane>
      <a-tab-pane key="system" :tab="t('system_configuration')">
        <systemConfigs />
      </a-tab-pane>
    </a-tabs>
  </a-layout>
</template>
