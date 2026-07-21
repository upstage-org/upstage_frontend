<script lang="ts" setup>
/**
 * Create / inspect an RTMP stream feed (see /root/streaming2).
 *
 * A stream feed is a "stream"-type media asset whose file_location is a bare
 * MediaMTX stream key (no slash → the backend flags it isRTMP and signs a
 * publish token, AssetService.resolve_sign). This modal creates the asset via
 * the regular saveMedia mutation and then shows the ingest panel (OBS server
 * URL + key?token=…). Opened through `streamFeedVar` — "create" from the
 * media toolbar, "info" from a stream row's action button.
 */
import { gql } from "@apollo/client/core";
import { useMutation, useQuery } from "@vue/apollo-composable";
import { message } from "ant-design-vue";
import { streamFeedVar } from "apollo";
import configs from "config";
import { Media, StageAssignmentValue, StudioGraph } from "models/studio";
import { computed, inject, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { MEDIA_FORM_META_QUERY, MEDIA_PAGE_TOOLBAR_QUERY } from "services/graphql/mediaList";
import StageAssignment from "../MediaForm/StageAssignment.vue";
import { apolloErrorText } from "../MediaForm/composable";

const { t } = useI18n();

const STREAM_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

function generateStreamKey(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

const { result: streamFeedResult } = useQuery<{
  streamFeed: { mode: "create" } | { mode: "info"; media: Media } | null | undefined;
}>(gql`
  {
    streamFeed @client
  }
`);

const visible = computed(() => !!streamFeedResult.value?.streamFeed);
const mode = computed(() => streamFeedResult.value?.streamFeed?.mode);

const name = ref("");
const streamKey = ref("");
const stageAssignments = ref<StageAssignmentValue[]>([]);
const saving = ref(false);
const savedKey = ref("");
const sign = ref("");
const signLoading = ref(false);

const keyValid = computed(() => STREAM_KEY_PATTERN.test(streamKey.value));

watch(visible, (open) => {
  if (!open) return;
  const state = streamFeedResult.value?.streamFeed;
  savedKey.value = "";
  sign.value = "";
  if (state?.mode === "create") {
    name.value = "";
    streamKey.value = generateStreamKey();
    stageAssignments.value = [];
  } else if (state?.mode === "info") {
    savedKey.value = state.media.fileLocation;
    fetchSign(state.media.fileLocation);
  }
});

const { mutate: saveMedia } = useMutation<
  { saveMedia: { asset: { id: string } } },
  { input: Record<string, unknown> }
>(
  gql`
    mutation SaveMedia($input: SaveMediaInput!) {
      saveMedia(input: $input) {
        asset {
          id
        }
      }
    }
  `,
  {
    refetchQueries: [MEDIA_PAGE_TOOLBAR_QUERY, MEDIA_FORM_META_QUERY],
    awaitRefetchQueries: true,
  },
);

/**
 * `sign` is only exposed through mediaList/resolve_fields (owner-scoped);
 * the media-table query doesn't include it, so fetch it on demand.
 */
async function fetchSign(key: string) {
  signLoading.value = true;
  try {
    const { apolloClient } = await import("apollo");
    const response = await apolloClient.query<StudioGraph>({
      query: gql`
        query StreamFeedSigns {
          mediaList(mediaType: "stream") {
            fileLocation
            sign
          }
        }
      `,
      fetchPolicy: "network-only",
    });
    const match = (response.data.mediaList ?? []).find(
      (media: { fileLocation: string }) => media.fileLocation === key,
    );
    sign.value = match?.sign ?? "";
  } catch {
    sign.value = "";
  } finally {
    signLoading.value = false;
  }
}

const refresh = inject<() => void>("refresh", () => {});

async function create() {
  if (!name.value || !keyValid.value || saving.value) return;
  saving.value = true;
  try {
    await saveMedia({
      input: {
        name: name.value,
        mediaType: "stream",
        urls: [streamKey.value],
        copyrightLevel: 3,
        owner: "",
        stageAssignments: stageAssignments.value,
        userIds: [],
        tags: [],
        w: 16,
        h: 9,
      },
    });
    message.success(t("stream_feed_created"));
    savedKey.value = streamKey.value;
    refresh();
    await fetchSign(streamKey.value);
  } catch (error: any) {
    const text = apolloErrorText(error);
    // A save whose response was lost mid-flight (network change) still
    // creates the asset server-side, so the retry trips the duplicate-key
    // guard. If the "duplicate" is actually our own feed (its sign is
    // owner-scoped, so a non-empty sign means we own it), recover by
    // showing its ingest panel instead of a dead-end error.
    if (/already existed/i.test(text)) {
      await fetchSign(streamKey.value);
      if (sign.value) {
        message.success(t("stream_feed_created"));
        savedKey.value = streamKey.value;
        refresh();
        return;
      }
    }
    message.error(text);
  } finally {
    saving.value = false;
  }
}

const ingestKey = computed(() =>
  sign.value ? `${savedKey.value}?token=${sign.value}` : savedKey.value,
);

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    message.success(t("copied_to_clipboard"));
  } catch {
    message.error("Clipboard unavailable");
  }
}

function close() {
  streamFeedVar(undefined);
}
</script>

<template>
  <a-modal
    :open="visible"
    :title="savedKey ? t('stream_feed') : t('new_stream_feed')"
    :footer="null"
    @cancel="close"
  >
    <!-- Phase 1: create form -->
    <a-form v-if="!savedKey && mode === 'create'" layout="vertical">
      <p class="mb-3">{{ t("stream_feed_intro") }}</p>
      <a-form-item :label="t('stream_feed_name')" required>
        <a-input v-model:value="name" :maxlength="100" data-testid="stream-feed-name" />
      </a-form-item>
      <a-form-item
        :label="t('stream_key')"
        :help="t('stream_key_hint')"
        :validate-status="keyValid ? 'success' : 'error'"
        required
      >
        <a-input v-model:value="streamKey" :maxlength="64" data-testid="stream-feed-key" />
      </a-form-item>
      <a-form-item :label="t('stages')">
        <StageAssignment v-model="stageAssignments" />
      </a-form-item>
      <a-space class="w-full justify-end">
        <a-button @click="close">{{ t("cancel") }}</a-button>
        <a-button
          type="primary"
          :loading="saving"
          :disabled="!name || !keyValid"
          data-testid="stream-feed-save"
          @click="create"
        >
          {{ t("save") }}
        </a-button>
      </a-space>
    </a-form>

    <!-- Phase 2: ingest panel -->
    <div v-else-if="savedKey" data-testid="stream-feed-ingest-panel">
      <p>{{ t("ingest_panel_intro") }}</p>
      <a-form layout="vertical">
        <a-form-item :label="t('ingest_server')">
          <a-input-group compact class="flex">
            <a-input :value="configs.RTMP_INGEST_ENDPOINT" readonly class="flex-1" />
            <a-button @click="copyText(configs.RTMP_INGEST_ENDPOINT)">
              <CopyOutlined />
            </a-button>
          </a-input-group>
        </a-form-item>
        <a-form-item :label="t('ingest_stream_key')">
          <a-input-group compact class="flex">
            <a-input
              :value="signLoading ? '…' : ingestKey"
              readonly
              class="flex-1"
              data-testid="stream-feed-ingest-key"
            />
            <a-button :disabled="signLoading" @click="copyText(ingestKey)">
              <CopyOutlined />
            </a-button>
          </a-input-group>
        </a-form-item>
      </a-form>
      <div class="mb-3 text-xs opacity-75">
        <p class="mb-1">
          <b>{{ t("ingest_hint_title") }}</b>
        </p>
        <ul class="encoder-checklist">
          <li>{{ t("ingest_hint_format") }}</li>
          <li>{{ t("ingest_hint_keyframe") }}</li>
          <li>{{ t("ingest_hint_bframes") }}</li>
          <li>{{ t("ingest_hint_aspect") }}</li>
          <li>{{ t("ingest_hint_wizard") }}</li>
        </ul>
      </div>
      <a-space class="w-full justify-end">
        <a-button type="primary" @click="close">{{ t("finish") }}</a-button>
      </a-space>
    </div>
  </a-modal>
</template>

<style scoped>
.encoder-checklist {
  list-style: disc;
  margin-left: 1.25em;
}
.encoder-checklist li {
  margin-bottom: 0.35em;
}
</style>
