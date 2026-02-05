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

  <div class="card mb-4 archive-compress-card">
    <header class="card-header">
      <p class="card-header-title">{{ $t("replay_auto_compress") }}</p>
    </header>
    <div class="card-content">
      <p class="mb-3">{{ $t("replay_auto_compress_desc") }}</p>
      <div class="is-flex is-flex-wrap-wrap is-align-items-center is-gap-3 mb-3">
        <label class="label mb-0">{{ $t("archive_select_performance") }}</label>
        <select
          class="select"
          v-model="selectedArchiveId"
          @change="onSelectArchive"
        >
          <option :value="null">{{ $t("archive_select_placeholder") }}</option>
          <option
            v-for="s in sessions"
            :key="s.id"
            :value="s.id"
          >
            {{ s.name || `#${s.id}` }} ({{ date(s.begin) }} – {{ date(s.end) }})
          </option>
        </select>
        <template v-if="selectedArchiveId">
          <label class="label mb-0">{{ $t("replay_auto_compress_minutes") }}</label>
          <input
            type="number"
            class="input"
            style="width: 5rem"
            min="1"
            max="999"
            v-model.number="deadSpaceMinutes"
          />
          <button
            class="button is-info"
            :disabled="!archiveEvents.length || !deadSpaceMinutes || deadSpaceMinutes < 1"
            @click="applyCompressPreview"
          >
            {{ $t("replay_auto_compress_apply") }}
          </button>
        </template>
      </div>
      <template v-if="selectedArchive && (archiveEvents.length || loadingEvents)">
        <div v-if="loadingEvents" class="mb-3">{{ $t("loading") }}…</div>
        <template v-else>
          <div class="mb-2">
            <span class="tag is-light">{{ $t("archive_timeline_full") }}</span>
            <TimelineStrip
              v-if="archiveEvents.length"
              class="mt-1"
              :events="archiveEvents"
              :begin="archiveBegin"
              :end="archiveEnd"
            />
          </div>
          <div v-if="compressedResult" class="mb-3">
            <span class="tag is-info">{{ $t("archive_timeline_compressed") }}</span>
            <TimelineStrip
              class="mt-1"
              :events="compressedResult.events"
              :begin="compressedResult.timestamp.begin"
              :end="compressedResult.timestamp.end"
            />
          </div>
          <div class="is-flex is-flex-wrap-wrap is-align-items-center is-gap-2 mb-3">
            <a
              :href="replayUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="button is-small is-light"
            >
              {{ compressedResult ? $t("archive_open_replay_compressed") : $t("archive_open_replay") }}
            </a>
          </div>
          <div class="is-flex is-flex-wrap-wrap is-align-items-center is-gap-2">
            <label class="label mb-0">{{ $t("archive_save_name") }}</label>
            <input
              type="text"
              class="input"
              style="min-width: 200px"
              v-model="saveName"
              :placeholder="selectedArchive?.name"
            />
            <button
              class="button is-primary"
              :disabled="savingArchive"
              @click="saveArchiveName"
            >
              {{ $t("save") }}
            </button>
          </div>
        </template>
      </template>
    </div>
  </div>

  <DataTable :data="sessions" :headers="headers">
    <template #name="{ item }">
      <div v-if="item.name">
        <b>{{ item.name }}</b>
      </div>
      <small v-if="item.description" class="has-text-dark">{{
        item.description
        }}</small>
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
            <Icon src="chat.svg" style="width: 16px; height: 16px;" />
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
        <Icon src="download.svg" style="width: 16px; height: 16px;" />
      </button>
    </template>
    <template #private-chat="{ item }">
      <Modal>
        <template #trigger>
          <button class="button is-light">
            <Icon src="chat.svg" style="width: 16px; height: 16px;" />
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
        <Icon src="download.svg" style="width: 16px; height: 16px;" />
      </button>
    </template>
    <template #replay="{ item }">
      <router-link :to="`/replay/${stage.fileLocation}/${item.id}`"
        :class="`button ${item.recording ? 'is-primary' : 'is-dark'}`">
        <i class="fas fa-video"></i>
      </router-link>
    </template>
    <template #actions="{ item }">
      <CustomConfirm @confirm="(complete) => updatePerformance(item, complete)" :loading="updating" :only-yes="true">
        <Field v-model="item.name" label="Performance Name" required />
        <Field label="Description">
          <textarea class="textarea" v-model="item.description" rows="3"></textarea>
        </Field>
        <template #yes>
          <span>{{ $t("save") }}</span>
        </template>
        <template #trigger>
          <button class="button is-light">
            <Icon src="edit.svg" style="width: 16px; height: 16px;" />
          </button>
        </template>
      </CustomConfirm>
      <CustomConfirm @confirm="(complete) => deletePerformance(item, complete)" :loading="deleting">
        <template #trigger>
          <button class="button is-light is-danger">
            <Icon src="delete.svg" style="width: 16px; height: 16px;" />
          </button>
        </template>
        <div class="has-text-centered">
          Deleting this performance will also delete
          <span class="has-text-danger">{{
            $t("all_of_its_replay_and_chat")
            }}</span>. This cannot be undone!
          <strong>Are you sure you want to continue?</strong>
        </div>
      </CustomConfirm>
    </template>
  </DataTable>
</template>

<script>
import Messages from "components/stage/Chat/Messages.vue";
import DataTable from "components/DataTable/index.vue";
import Modal from "components/Modal.vue";
import Icon from "components/Icon.vue";
import CustomConfirm from "components/CustomConfirm.vue";
import Field from "components/form/Field.vue";
import ClearChat from "./ClearChat.vue";
import SweepStage from "./SweepStage.vue";
import TimelineStrip from "components/replay/TimelineStrip.vue";
import { computeCompressedEvents } from "utils/replayCompress";
import { computed, inject, ref, watch } from "vue";
import moment from "moment";
import humanizeDuration from "humanize-duration";
import { useMutation } from "services/graphql/composable";
import { stageGraph } from "services/graphql";
import configs from "config";

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
    TimelineStrip,
  },
  setup: () => {
    const stage = inject("stage");
    const refresh = inject("refresh");
    const selectedArchiveId = ref(null);
    const deadSpaceMinutes = ref(5);
    const archiveEvents = ref([]);
    const archiveBegin = ref(0);
    const archiveEnd = ref(0);
    const loadingEvents = ref(false);
    const compressedResult = ref(null);
    const saveName = ref("");
    const savingArchive = ref(false);

    const selectedArchive = computed(() =>
      stage.value && selectedArchiveId.value
        ? sessions.value.find((s) => s.id === selectedArchiveId.value)
        : null
    );
    const sessions = computed(() => {
      if (!stage.value) return [];
      const { performances, chats } = stage.value;
      const list = (performances || []).map((p) => {
        const messages = chats
          .filter((c) => c.performanceId === p.id)
          .map((c) => c.payload);
        const filtered = messages.filter((m) => !m.clear);
        let begin = null;
        let end = null;
        let duration = 0;
        let chatless = true;
        if (filtered.length) {
          chatless = false;
          for (const m of filtered) {
            if (m.at) {
              if (begin == null) begin = m.at;
              end = m.at;
              duration = end - begin;
            }
          }
        }
        const privateMessages = messages.filter(
          (m) => m.isPrivate || m.clearPlayerChat
        );
        const publicMessages = messages.filter(
          (m) => !m.isPrivate && !m.clearPlayerChat
        );
        return {
          ...p,
          messages,
          begin,
          end,
          duration,
          chatless,
          privateMessages,
          publicMessages,
        };
      });
      list.sort((a, b) => b.id - a.id);
      return list;
    });
    const replayUrl = computed(() => {
      if (!stage.value || !selectedArchiveId.value) return "#";
      const base = `${configs.UPSTAGE_URL || ""}/replay/${stage.value.fileLocation}/${selectedArchiveId.value}`;
      const params = compressedResult.value && deadSpaceMinutes.value
        ? `?compress=${deadSpaceMinutes.value}`
        : "";
      return base + params;
    });

    async function onSelectArchive() {
      compressedResult.value = null;
      if (!selectedArchiveId.value || !stage.value) {
        archiveEvents.value = [];
        return;
      }
      loadingEvents.value = true;
      try {
        const { stage: loaded } = await stageGraph.loadStage(
          stage.value.fileLocation,
          selectedArchiveId.value
        );
        const events = loaded?.events ?? [];
        archiveEvents.value = events;
        if (events.length) {
          archiveBegin.value = events[0].mqttTimestamp;
          archiveEnd.value = events[events.length - 1].mqttTimestamp;
        } else {
          archiveBegin.value = 0;
          archiveEnd.value = 0;
        }
        const sel = sessions.value.find((s) => s.id === selectedArchiveId.value);
        saveName.value = sel?.name ?? "";
      } finally {
        loadingEvents.value = false;
      }
    }
    function applyCompressPreview() {
      if (!archiveEvents.value.length || !deadSpaceMinutes.value) return;
      const result = computeCompressedEvents(
        archiveEvents.value,
        archiveBegin.value,
        archiveEnd.value,
        deadSpaceMinutes.value
      );
      compressedResult.value = result;
    }
    async function saveArchiveName() {
      const item = selectedArchive.value;
      if (!item || savingArchive.value) return;
      const name = (saveName.value || item.name || "").trim();
      if (!name) return;
      savingArchive.value = true;
      try {
        await updateMutation("Performance updated successfully!", item.id, name, item.description);
        if (refresh) refresh(stage.value.id);
      } finally {
        savingArchive.value = false;
      }
    }

    watch(selectedArchiveId, () => onSelectArchive());

    const date = (value) => {
      return value ? moment(value).format("YYYY-MM-DD") : "Now";
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
            `${stage.value.name}-Audience-chat-${session.end
              ? timeStamp(session.end)
              : timeStamp(session.createdOn)
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
          link.setAttribute(
            "download",
            `${stage.value.name}-Audience-chat.txt`,
          );
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
            `${stage.value.name}-Player-chat-${session.end
              ? timeStamp(session.end)
              : timeStamp(session.createdOn)
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
        [padTo2Digits(date.getHours()), padTo2Digits(date.getMinutes())].join(
          "",
        ) +
        "-" +
        [
          padTo2Digits(date.getDate()),
          padTo2Digits(date.getMonth() + 1),
          date.getFullYear(),
        ].join("")
      );
    };

    const timeStamp = (value) => {
      const date = new Date(value);
      return formatDate(date);
    };

    const { loading: updating, save: updateMutation } = useMutation(
      stageGraph.updatePerformance,
    );
    const updatePerformance = async (item, complete) => {
      await updateMutation(
        "Performance updated successfully!",
        item.id,
        item.name,
        item.description,
      );
      complete();
    };

    const { loading: deleting, save: deleteMutation } = useMutation(
      stageGraph.deletePerformance,
    );
    const deletePerformance = async (item, complete) => {
      await deleteMutation("Performance deleted successfully!", item.id);
      complete();
      if (refresh) {
        refresh(stage.value.id);
      }
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
      selectedArchiveId,
      deadSpaceMinutes,
      archiveEvents,
      archiveBegin,
      archiveEnd,
      loadingEvents,
      compressedResult,
      saveName,
      savingArchive,
      selectedArchive,
      replayUrl,
      onSelectArchive,
      applyCompressPreview,
      saveArchiveName,
    };
  },
};
</script>

<style scoped>
.button.is-light>img {
  max-width: unset;
}
</style>
