<script>
import Messages from "components/stage/Chat/Messages.vue";
import DataTable from "components/DataTable/index.vue";
import Modal from "components/Modal.vue";
import Icon from "components/Icon.vue";
import CustomConfirm from "components/CustomConfirm.vue";
import Field from "components/form/Field.vue";
import ClearChat from "./ClearChat.vue";
import SweepStage from "./SweepStage.vue";
import { computed, inject, ref } from "vue";
import dayjs from "@utils/dayjs";
import humanizeDuration from "humanize-duration";
import { useI18n } from "vue-i18n";
import { message } from "ant-design-vue";
import { useMutation } from "services/graphql/composable";
import { stageGraph } from "services/graphql";

export default {
  components: {
    Messages,
    DataTable,
    ClearChat,
    SweepStage,
    Modal,
    Icon,
    CustomConfirm,
    Field,
  },
  setup: () => {
    const stage = inject("stage");
    const refresh = inject("refresh");
    const { t } = useI18n();

    const trimPerformanceId = ref(null);
    const trimNewName = ref("");
    const trimMinPauseSeconds = ref(30);

    const initTrimForm = (item) => {
      trimPerformanceId.value = item.id;
      const suffix = t("trim_replay_name_suffix");
      trimNewName.value = item.name ? `${item.name} ${suffix}` : t("trim_replay_default_name");
      trimMinPauseSeconds.value = 30;
    };

    const trimSession = computed(() =>
      sessions.value.find((s) => String(s.id) === String(trimPerformanceId.value)),
    );

    const trimDurationHint = computed(() => {
      const s = trimSession.value;
      if (!s?.duration) return "";
      return t("trim_replay_duration_hint", {
        duration: humanizeDuration(s.duration, { round: true }),
        seconds: trimMinPauseSeconds.value,
      });
    });

    const date = (value) => {
      return value ? dayjs(value).format("YYYY-MM-DD") : "Now";
    };

    const headers = [
      {
        title: "Name",
        slot: "name",
      },
      {
        title: "Audience Chat",
        slot: "public-chat",
        align: "center",
      },
      {
        title: "Player Chat",
        slot: "private-chat",
        align: "center",
      },
      {
        title: "Replay",
        slot: "replay",
      },
      {
        title: "Messages",
        render: (item) => item.messages.length,
        align: "center",
      },
      {
        title: "Length",
        render: (item) => humanizeDuration(item.duration, { round: true }),
        align: "center",
      },
      {
        title: "Archived On",
        key: "createdOn",
        type: "date",
      },
      {
        title: "",
        slot: "actions",
      },
    ];
    const sessions = computed(() => {
      const res = [];
      if (stage.value) {
        const { performances, chats } = stage.value;
        (performances || []).forEach((p) => {
          p.messages = chats.filter((c) => c.performanceId === p.id).map((c) => c.payload);
          res.push(p);
        });
      }
      res.sort((a, b) => b.id - a.id);
      res.forEach((session) => {
        const messages = session.messages.filter((m) => !m.clear);
        if (messages.length) {
          session.begin = null;
          for (const m of messages) {
            if (m.at) {
              if (!session.begin) {
                session.begin = m.at;
              }
              session.end = m.at;
              session.duration = m.at - session.begin;
            }
          }
        } else {
          session.chatless = true;
          session.duration = 0;
        }
      });
      res.forEach((session) => {
        session.privateMessages = session.messages.filter((m) => m.isPrivate || m.clearPlayerChat);
        session.publicMessages = session.messages.filter((m) => !m.isPrivate && !m.clearPlayerChat);
      });
      return res;
    });

    let textFile;

    const makeTextFile = function (content) {
      const data = new Blob(content, { type: "text/plain" });

      // If we are replacing a previously generated file we need to
      // manually revoke the object URL to avoid memory leaks.
      if (textFile !== null) {
        window.URL.revokeObjectURL(textFile);
      }

      textFile = window.URL.createObjectURL(data);

      // returns a URL you can use as a href
      return textFile;
    };
    const downloadChatLog = (option, session) => {
      const link = document.createElement("a");
      let content = [];
      if (option == "public") {
        if (session) {
          link.setAttribute(
            "download",
            `${stage.value.name}-Audience-chat-${
              session.end ? timeStamp(session.end) : timeStamp(session.createdOn)
            }.txt`,
          );
          content = session.publicMessages.map((item) => {
            let line = "";
            if (item.clear) {
              line = "---------------- Clear Chat ----------------";
            } else {
              line = `${item.user}: ${item.message}`;
            }
            return `${line}\r\n`;
          });
        } else {
          link.setAttribute("download", `${stage.value.name}-Audience-chat.txt`);
          sessions.value.forEach((session) => {
            content = content.concat(
              session.publicMessages.map((item) => {
                if (item.clear) {
                  return `---------------- Clear Chat ----------------\r\n`;
                } else {
                  return `${item.user}: ${item.message}\r\n`;
                }
              }),
            );
          });
        }
      } else {
        if (session) {
          link.setAttribute(
            "download",
            `${stage.value.name}-Player-chat-${
              session.end ? timeStamp(session.end) : timeStamp(session.createdOn)
            }.txt`,
          );
          content = session.privateMessages.map((item) => {
            let line = "";
            if (item.clearPlayerChat) {
              line = "---------------- Clear Chat ----------------";
            } else {
              line = `${item.user}: ${item.message}`;
            }
            return `${line}\r\n`;
          });
        } else {
          link.setAttribute("download", `${stage.value.name}-Player-chat.txt`);
          sessions.value.forEach((session) => {
            content = content.concat(
              session.privateMessages.map((item) => {
                if (item.clearPlayerChat) {
                  return `---------------- Clear Chat ----------------\r\n`;
                } else {
                  return `${item.user}: ${item.message}\r\n`;
                }
              }),
            );
          });
        }
      }
      link.href = makeTextFile(content);
      document.body.appendChild(link);

      // wait for the link to be added to the document
      window.requestAnimationFrame(function () {
        const event = new MouseEvent("click");
        link.dispatchEvent(event);
        document.body.removeChild(link);
      });
    };

    const padTo2Digits = (num) => {
      return num.toString().padStart(2, "0");
    };

    const formatDate = (date) => {
      return (
        [padTo2Digits(date.getHours()), padTo2Digits(date.getMinutes())].join("") +
        "-" +
        [padTo2Digits(date.getDate()), padTo2Digits(date.getMonth() + 1), date.getFullYear()].join(
          "",
        )
      );
    };

    const timeStamp = (value) => {
      const date = new Date(value);
      return formatDate(date);
    };

    const { loading: updating, save: updateMutation } = useMutation(stageGraph.updatePerformance);
    const updatePerformance = async (item, complete) => {
      await updateMutation(
        "Performance updated successfully!",
        item.id,
        item.name,
        item.description,
      );
      complete();
    };

    const { loading: deleting, save: deleteMutation } = useMutation(stageGraph.deletePerformance);
    const deletePerformance = async (item, complete) => {
      const id = Number(item.id);
      if (!Number.isFinite(id)) {
        message.error(t("replay_delete_invalid_id"));
        return;
      }
      const response = await deleteMutation("Performance deleted successfully!", id);
      const ok = response?.deletePerformance?.success;
      if (ok === false) {
        message.error(t("replay_delete_failed"));
        return;
      }
      complete();
      if (refresh) {
        refresh(stage.value.id);
      }
    };

    const copyReplayLink = async (item) => {
      if (!stage.value?.fileLocation || item?.id == null) return;
      const { copyReplayLink: copy } = await import("@utils/replayLink");
      await copy(stage.value.fileLocation, item.id);
      message.success(t("replay_link_copied"));
    };

    const { loading: trimming, save: trimSave } = useMutation(
      stageGraph.duplicatePerformanceWithTrimmedPauses,
    );
    const duplicateWithTrimmedPauses = async (closeModal) => {
      const secs = Number(trimMinPauseSeconds.value);
      if (!trimNewName.value?.trim()) {
        message.error(t("trim_replay_name_required"));
        return;
      }
      if (!(secs > 0)) {
        message.error(t("trim_replay_pause_positive"));
        return;
      }
      await trimSave(
        () => {
          message.success(t("trim_replay_success"));
          if (refresh) {
            refresh(stage.value.id);
          }
          closeModal?.();
        },
        {
          input: {
            sourcePerformanceId: trimPerformanceId.value,
            name: trimNewName.value.trim(),
            description: null,
            minPauseSeconds: secs,
          },
        },
      );
    };

    return {
      stage,
      sessions,
      downloadChatLog,
      headers,
      date,
      updatePerformance,
      updating,
      deletePerformance,
      deleting,
      trimPerformanceId,
      trimNewName,
      trimMinPauseSeconds,
      initTrimForm,
      duplicateWithTrimmedPauses,
      trimming,
      copyReplayLink,
      trimDurationHint,
    };
  },
};
</script>

<template>
  <div class="has-text-right is-fullwidth pb-3">
    <button class="button ml-2 is-light" @click="downloadChatLog('public')">
      <span>{{ $t("download_all_audience_chat") }}</span>
    </button>
    <button class="button ml-2 is-light" @click="downloadChatLog('player')">
      <span>{{ $t("download_all_player_chat") }}</span>
    </button>
    <ClearChat />
    <SweepStage :archive="true">{{ $t("archive_performance") }}</SweepStage>
  </div>

  <DataTable :data="sessions" :headers="headers">
    <template #name="{ item }">
      <div v-if="item.name">
        <b>{{ item.name }}</b>
      </div>
      <small v-if="item.description" class="has-text-dark">{{ item.description }}</small>
      <small v-else class="has-text-dark">
        <span v-if="item.recording">{{ $t("recorded") }}</span>
        <span v-else>{{ $t("auto_recorded") }}</span>
        <span v-if="item.chatless"> on {{ date(item.createdOn) }}</span>
        <span v-else> from {{ date(item.begin) }} to {{ date(item.end) }}</span>
      </small>
    </template>
    <template #public-chat="{ item }">
      <Modal>
        <template #trigger>
          <button class="button is-light">
            <Icon src="chat.svg" style="width: 16px; height: 16px" />
          </button>
        </template>
        <template #header>
          Audience chats from {{ date(item.begin) }}
          <span v-if="item.begin !== item.end">to {{ date(item.end) }}</span>
        </template>
        <template #content>
          <Messages :messages="item.publicMessages" from="archive" />
        </template>
      </Modal>
      <button class="button is-light" @click="downloadChatLog('public', item)">
        <Icon src="download.svg" style="width: 16px; height: 16px" />
      </button>
    </template>
    <template #private-chat="{ item }">
      <Modal>
        <template #trigger>
          <button class="button is-light">
            <Icon src="chat.svg" style="width: 16px; height: 16px" />
          </button>
        </template>
        <template #header>
          Player chats from {{ date(item.begin) }}
          <span v-if="item.begin !== item.end">to {{ date(item.end) }}</span>
        </template>
        <template #content>
          <Messages :messages="item.privateMessages" from="archive" />
        </template>
      </Modal>
      <button class="button is-light" @click="downloadChatLog('private', item)">
        <Icon src="download.svg" style="width: 16px; height: 16px" />
      </button>
    </template>
    <template #replay="{ item }">
      <span class="buttons are-small">
        <router-link
          :to="`/replay/${stage.fileLocation}/${item.id}`"
          :class="`button ${item.recording ? 'is-primary' : 'is-dark'}`"
          :title="$t('replay_open')"
        >
          <i class="fas fa-video"></i>
        </router-link>
        <button
          type="button"
          class="button is-light"
          :title="$t('replay_copy_link')"
          @click="copyReplayLink(item)"
        >
          <i class="fas fa-link"></i>
        </button>
      </span>
    </template>
    <template #actions="{ item }">
      <Modal>
        <template #trigger>
          <button type="button" class="button is-light" @click="initTrimForm(item)">
            <Icon src="pause.svg" style="width: 16px; height: 16px" />
          </button>
        </template>
        <template #header>{{ $t("trim_replay_title") }}</template>
        <template #content="{ closeModal }">
          <p class="mb-3">{{ $t("trim_replay_help") }}</p>
          <p v-if="trimDurationHint" class="mb-3 has-text-grey">{{ trimDurationHint }}</p>
          <Field v-model="trimNewName" :label="$t('trim_replay_new_name')" required />
          <Field
            v-model.number="trimMinPauseSeconds"
            type="number"
            :label="$t('trim_replay_min_pause_label')"
            required
          />
          <div class="mt-4">
            <button
              type="button"
              class="button is-primary"
              :disabled="trimming"
              @click="duplicateWithTrimmedPauses(closeModal)"
            >
              {{ $t("trim_replay_create") }}
            </button>
          </div>
        </template>
      </Modal>
      <CustomConfirm
        :loading="updating"
        :only-yes="true"
        @confirm="(complete) => updatePerformance(item, complete)"
      >
        <Field v-model="item.name" label="Performance Name" required />
        <Field label="Description">
          <textarea v-model="item.description" class="textarea" rows="3"></textarea>
        </Field>
        <template #yes>
          <span>{{ $t("save") }}</span>
        </template>
        <template #trigger>
          <button class="button is-light">
            <Icon src="edit.svg" style="width: 16px; height: 16px" />
          </button>
        </template>
      </CustomConfirm>
      <CustomConfirm :loading="deleting" @confirm="(complete) => deletePerformance(item, complete)">
        <template #trigger>
          <button class="button is-light is-danger">
            <Icon src="delete.svg" style="width: 16px; height: 16px" />
          </button>
        </template>
        <div class="has-text-centered">
          Deleting this performance will also delete
          <span class="has-text-danger">{{ $t("all_of_its_replay_and_chat") }}</span
          >. This cannot be undone!
          <strong>Are you sure you want to continue?</strong>
        </div>
      </CustomConfirm>
    </template>
  </DataTable>
</template>

<style scoped>
.button.is-light > img {
  max-width: unset;
}
</style>
