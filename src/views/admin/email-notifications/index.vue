<script setup lang="ts">
import { CloseCircleFilled, MailOutlined } from "@ant-design/icons-vue";
import { useAsyncState } from "@vueuse/core";
import { Layout, message, Space } from "ant-design-vue";
import { TransferItem } from "ant-design-vue/lib/transfer";
import RichTextEditor from "components/editor/RichTextEditor.vue";
import configs from "config";
import { enableExperimentalFragmentVariables } from "graphql-tag";
import { useLoading } from "hooks/mutations";
import { displayName, titleCase } from "utils/common";
import { reactive } from "vue";
import { computed } from "vue";
import { watch } from "vue";
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import Header from "components/Header.vue";
import { userGraph, configGraph } from "services/graphql";
import { ROLES } from "utils/constants";
import { useQuery } from "@vue/apollo-composable";
import gql from "graphql-tag";
import store from "store";

const { t } = useI18n();

const subject = ref("");
const showSignature = ref(true);

const INITIAL_BODY_CONTENT = "";

const body = ref(INITIAL_BODY_CONTENT);

const receiverEmails = ref<string[]>([]);
const directToEmails = ref<string[]>([]);

const customRecipients = ref<string[]>([]);

const filterRole = ref<number | undefined>();
const system = computed(() => store.getters["config/system"]);

const addCustomRecipient = () => {
  const email = prompt("Enter email: ");
  if (email) {
    if (/^[\w.-]+@[\w.-]+\.[a-zA-Z]{2,}$/.test(email)) {
      if (!receiverEmails.value.includes(email)) {
        receiverEmails.value = receiverEmails.value.concat(email);
      }
      if (
        !receivers?.value?.adminPlayers?.edges.some(
          (e: any) => e?.email === email
        )
      ) {
        customRecipients.value = customRecipients.value.concat(email);
      }
    } else {
      message.error("Invalid email address!");
    }
  }
};

const { result: receivers, loading: isReady } = useQuery(
  gql`
    {
      adminPlayers {
        totalCount
        edges {
          id
          username
          email
          role
          firstName
          lastName
          displayName
        }
      }
    }
  `,
  {},
  { notifyOnNetworkStatusChange: true }
);

const dataSource = computed<TransferItem[]>(() => {
  return customRecipients.value
    .map<TransferItem>((email) => ({
      key: email,
      title: email,
    }))
    .concat(
      receivers.value?.adminPlayers?.edges
        .filter((user: any) =>
          filterRole.value
            ? String(user.role) == String(filterRole.value)
            : true
        )
        .map((user: any, i: any) => ({
          key: user?.email ?? `${i}`,
          title: user ? `${displayName(user)} <${user.email}>` : "",
        })) ?? []
    );
});

const reset = () => {
  receiverEmails.value = [];
  subject.value = "";
  body.value = INITIAL_BODY_CONTENT;
  successMessage.value = "";
};

const successMessage = ref("");

const { proceed, loading } = useLoading(
  async () => {
    if (!subject.value) {
      throw "Please provide a subject for your email";
    }
    if (!body.value) {
      throw "Please provide a body for your email";
    }
    const visibleReceivers = receiverEmails.value.filter((email) =>
      receivers.value.adminPlayers?.edges.some(
        (edge: any) => edge?.email === email
      )
    );
    if (!visibleReceivers.length) {
      throw "Please select at least one recipient";
    }
    receiverEmails.value = visibleReceivers;
    await configGraph.sendEmail({
      subject: subject.value,
      body: showSignature.value
        ? body.value + (system.value?.emailSignature?.value ?? "")
        : body.value,
      recipients: receiverEmails.value
        .filter((email) => directToEmails.value.includes(email))
        .join(","),
      bcc: receiverEmails.value
        .filter((email) => !directToEmails.value.includes(email))
        .join(","),
    });
    successMessage.value = `Email has been successfully sent to ${receiverEmails.value
      .map((email) =>
        directToEmails.value.includes(email) ? email : `${email} (BCC)`
      )
      .join(", ")}!`;
  },
  {
    loading: "Email sending...",
    success: () => `Email sent! ✈️`,
  }
);
</script>

<template>
  <Header>
    <Space><span /></Space>
  </Header>
  <Layout v-if="successMessage" class="bg-white rounded-lg overflow-y-auto justify-center">
    <AResult status="success" title="Email notification sent" class="text-center" :sub-title="successMessage">
      <AButton class="m-auto" @click="reset()">Send another email</AButton>
    </AResult>
  </Layout>
  <Layout v-else class="bg-white rounded-lg overflow-y-auto">
    <div
      class="bg-white shadow rounded-tl rounded-tr p-2 px-4 sticky top-0 z-50 mb-6 flex justify-between items-center">
      <a-tag color="#007011">
        <MailOutlined /> Email Notification
      </a-tag>
      <a-button type="primary" @click="proceed" :loading="loading">
        <send-outlined />
        Send
      </a-button>
    </div>
    <div class="px-4">
      From the list on the left, select the player or players that you want to
      email and click the arrow to move them to the recipient list.<br />
      If you want to email a specific group, e.g. all Admins, use the dropdown
      menu on the left to filter the player list by role. To send to multiple
      role groups, use the dropdown again to select the next role, and transfer
      the desired players to the recipient list. Then clear the filter by
      hovering over the arrow in the dropdown, which will change to an
      <CloseCircleFilled />. Once the filter is cleared, all the players you
      have selected will show in the recipient list.
      <ADivider />
      <a-form-item :label-col="{ xl: { span: 4 }, xxl: { span: 3 } }" :colon="false">
        <template #label>
          <a-space direction="vertical">
            {{ t("to") }}
            <a-select allow-clear placeholder="Filter by role" :options="Object.entries(configs.ROLES).map(([key, id]) => ({
              value: id,
              label: titleCase(key),
            }))
              " v-model:value="filterRole" />
            <a-button type="dashed" @click="addCustomRecipient">
              <plus-circle-outlined />
              Custom recipient
            </a-button>
          </a-space>
        </template>
        <a-spin :spinning="isReady">
          <a-transfer :locale="{
            itemUnit: 'recipient',
            itemsUnit: 'recipients',
            notFoundContent: '',
            searchPlaceholder: 'Search by email or name',
          }" :list-style="{
              flex: '1',
              height: '300px',
            }" :titles="[' available', ' selected']" v-model:target-keys="receiverEmails" :data-source="dataSource"
            show-search :filter-option="(keyword, option) =>
                option.title?.toLowerCase().includes(keyword.toLowerCase()) ??
                false
              ">
            <template #render="item">
              <a-space class="flex justify-between">
                <span>
                  {{ item?.title }}
                  <a-tag v-if="!item?.title?.includes('<')">Custom recipient</a-tag>
                </span>
                <a-switch size="small" :checked="!directToEmails.includes(item?.key as string)" @change="(checked, e) => {
                  directToEmails = directToEmails
                    .filter((email) => email !== item?.key)
                    .concat(checked ? [] : (item?.key as string));
                  e.stopPropagation();
                }
                ">
                  <template #checkedChildren>
                    <span class="text-[8px] leading-none">BCC</span>
                  </template>
                  <template #unCheckedChildren>
                    <span class="text-[8px] leading-none">BCC</span>
                  </template>
                </a-switch>
              </a-space>
            </template>
          </a-transfer>
        </a-spin>
      </a-form-item>
      <a-form-item label="Subject" :label-col="{ xl: { span: 4 }, xxl: { span: 3 } }" :colon="false">
        <a-input v-model:value="subject" />
      </a-form-item>
      <a-form-item label="Body" :label-col="{ xl: { span: 4 }, xxl: { span: 3 } }" :colon="false">
        <RichTextEditor v-model="body" @click="console.log(body)" />
      </a-form-item>
      <a-form-item label="Attach signature" :label-col="{ xl: { span: 4 }, xxl: { span: 3 } }" :colon="false">
        <div>
          <a-switch v-model:checked="showSignature">
            <template #checkedChildren>On</template>
            <template #unCheckedChildren>Off</template>
          </a-switch>
          <p class="text-sm mt-2 text-gray-500">
            Go to
            <a href="/admin/configuration?tab=system" class="text-blue-600 hover:underline">
              System Configuration
            </a>
            to view and edit the email signature.
          </p>
        </div>

      </a-form-item>
    </div>
  </Layout>
</template>
