<script setup lang="ts">
import { Modal } from "ant-design-vue";
import { ExclamationCircleOutlined } from "@ant-design/icons-vue";
import gql from "graphql-tag";
import {
  ref,
  computed,
  inject,
  Ref,
  createVNode,
  defineModel,
  watch,
  reactive,
  ComputedRef,
  nextTick,
} from "vue";
import { SlickList, SlickItem } from "vue-slicksort";
import {
  AvatarVoice as Voice,
  CopyrightLevel,
  Link,
  Media,
  MediaAttributes,
  StudioGraph,
  UploadFile,
  User,
} from "models/studio";
import { absolutePath, capitalize } from "utils/common";
import StageAssignment from "./StageAssignment.vue";
import { useSaveMedia } from "./composable";
import { editingMediaVar, inquiryVar } from "apollo";
import MediaPermissions from "./MediaPermissions.vue";
import AvatarVoice from "./AvatarVoice.vue";
import PropLink from "./PropLink.vue";
import {
  getDefaultAvatarVoice,
  getDefaultVariant,
} from "services/speech/voice";
import { useMutation, useQuery } from "@vue3-apollo/core";
import { message } from "ant-design-vue";

const model = defineModel()
const files = inject<Ref<UploadFile[]>>("files");

const { result: editingMediaResult, refetch } = useQuery<{
  editingMedia: Media;
}>(gql`
  {
    editingMedia @client
  }
`);
const { result: usersResult } = useQuery<{ users: User[] }>(gql`
  query {
    users {
      id
      username
      firstName
      lastName
      email
    }
  }
`);

const users = computed(() => usersResult.value?.users || []);

// Add these reactive variables for filtering
const searchValue = ref('');
const filteredUsers = computed(() => {
  if (!searchValue.value) {
    return users.value;
  }
  
  const search = searchValue.value.toLowerCase();
  return users.value.filter(user => {
    const displayName = getUserDisplayName(user).toLowerCase();
    const username = user.username?.toLowerCase() || '';
    const email = user.email?.toLowerCase() || '';
    
    return displayName.includes(search) || 
           username.includes(search) || 
           email.includes(search);
  });
});

// Handle search input
const handleSearch = (value: string) => {
  searchValue.value = value;
};

// Clear search when dropdown closes
const handleDropdownVisibleChange = (open: boolean) => {
  if (!open) {
    searchValue.value = '';
  }
};

watch(editingMediaResult, () => {
  if (editingMediaResult.value) {
    const { editingMedia } = editingMediaResult.value;
    name.value = editingMedia.name;
    type.value = editingMedia.assetType.name;
    tags.value = Array.isArray(editingMedia.tags) ? editingMedia.tags : [];
    owner.value = editingMedia.owner.username;
    copyrightLevel.value = editingMedia.copyrightLevel;
    const attributes = JSON.parse(editingMedia.description || "{}") as MediaAttributes;
    const aw = Number(attributes?.w);
    const ah = Number(attributes?.h);
    frameSize.value = {
      width: Number.isFinite(aw) ? aw : 100,
      height: Number.isFinite(ah) ? ah : 100,
    };
    if (files?.value) {
      const frames =
        attributes?.frames && attributes.frames.length
          ? attributes.frames
          : [editingMedia.fileLocation];
      files.value = frames.map((frame, id) => ({
        id,
        preview: absolutePath(frame),
        url: frame,
        status: "uploaded",
        file: {
          name: editingMedia.name,
        } as File,
      }));
    }
    Object.assign(voice, getDefaultAvatarVoice());
    if (attributes?.voice && attributes.voice.voice) {
      voice.voice = attributes.voice.voice ?? "";
      voice.variant = attributes.voice.variant ?? voice.variant;
      voice.pitch = Number(attributes.voice.pitch) || 50;
      voice.speed = Number(attributes.voice.speed) || 1;
      voice.amplitude = Number(attributes.voice.amplitude) || 50;
    }
    link.url = "";
    link.blank = true;
    link.effect = false;
    if (attributes?.link) {
      link.url = attributes.link.url ?? "";
      link.blank = attributes.link.blank !== false;
      link.effect = !!attributes.link.effect;
    }
    note.value = attributes?.note ?? "";
    if (editingMedia.stages) {
      stageIds.value = editingMedia.stages.map((stage) => stage.id);
    }
    userIds.value = editingMedia.permissions
      .filter((permission) => permission.approved)
      .map((permission) => String(permission.userId));
  }
});

const name = ref("");
const type = ref("avatar");
const tags = ref<string[]>([]);
const stageIds = ref<string[]>([]);
const userIds = ref<string[]>([]);
const note = ref<string>("");
const mediaName = computed(() => {
  if (name.value) {
    return name.value;
  }
  if (files && files.value.length) {
    return files.value[0].file.name;
  }
  return "";
});
const copyrightLevel = ref<CopyrightLevel>(0);
const owner = ref<string>("");
const voice = reactive<Voice>(getDefaultAvatarVoice());
const link = reactive<Link>({ url: "", blank: true, effect: false });

const whoami = inject<ComputedRef<User>>("whoami");
if (whoami) {
  watch(whoami, () => {
    if (whoami.value) {
      owner.value = whoami?.value.username;
    }
  });
}

const handleFrameClick = ({ event, index }: { event: any; index: number }) => {
  event.preventDefault();
  if (!clearMode.value) {
    return;
  }
  if (files && files.value.length > 1) {
    const filesCopy = files.value.slice();
    Modal.confirm({
      title: "Are you sure you want to remove this frame?",
      icon: createVNode(ExclamationCircleOutlined),
      content: createVNode(
        "div",
        { style: "color: orange;" },
        "There is no undo!"
      ),
      onOk() {
        files.value = filesCopy.filter((_, i) => i !== index);
        if (files.value.length === 1) {
          clearMode.value = false;
        }
      },
      okButtonProps: {
        danger: true,
      },
    });
  }
};

const handleClose = () => {
  if (files) {
    if (editingMediaResult.value) {
      // When editing existing media, close immediately without confirmation
      editingMediaVar(undefined);
      files.value = [];
      // Refetch after clearing to update the query cache
      nextTick(() => {
        refetch();
      });
    } else {
      // When creating new media, show confirmation dialog
      Modal.confirm({
        title: "Are you sure you want to quit?",
        icon: createVNode(ExclamationCircleOutlined),
        content: createVNode(
          "div",
          { style: "color: orange;" },
          "All selected frames will be lost, there is no undo!"
        ),
        onOk() {
          files.value = [];
        },
        okButtonProps: {
          danger: true,
        },
      });
    }
  }
};

const clearMode = ref(false);

const { result, loading } = useQuery<StudioGraph>(
  gql`
    {
      mediaTypes {
        id
        name
      }
      tags {
        id
        name
      }
    }
  `,
  {},
  { fetchPolicy: "cache-first" } as any
);
const mediaTypes = computed(() => {
  if (result.value?.mediaTypes) {
    return result.value.mediaTypes
      .filter(
        (node) =>
          !(
            editingMediaResult.value
              ? ["media", "video", "shape"]
              : ["media", "shape"]
          ).includes(node.name.toLowerCase())
      )
      .map((node) => ({ label: capitalize(node.name), value: node.name }));
  }
  return [];
});

const refresh = inject("refresh") as () => any;
const { progress, saveMedia, saving } = useSaveMedia(
  () => {
    return {
      files: files ? files.value : [],
      media: {
        id: editingMediaResult.value?.editingMedia?.id,
        name: mediaName.value,
        mediaType: type.value,
        copyrightLevel: copyrightLevel.value,
        owner: owner.value,
        stageIds: stageIds.value.map((id) => Number(id)),
        userIds: userIds.value.map((id) => Number(id)),
        tags: Array.isArray(tags.value) ? tags.value : [],
        w: Number.isFinite(Number(frameSize.value?.width)) ? Number(frameSize.value.width) : 100,
        h: Number.isFinite(Number(frameSize.value?.height)) ? Number(frameSize.value.height) : 100,
        note: note.value ?? "",
        urls: [],
        voice: {
          voice: voice.voice ?? "",
          variant: voice.variant ?? "",
          pitch: Number(voice.pitch) ?? 50,
          speed: Number(voice.speed) ?? 1,
          amplitude: Number(voice.amplitude) ?? 50,
        },
        link: {
          url: link.url ?? "",
          blank: !!link.blank,
          effect: !!link.effect,
        },
      },
    };
  },
  (id) => {
    if (files && refresh) {
      editingMediaVar(undefined);
      editingMediaResult.value = undefined
      files.value = [];
      refresh();
    }
  }
);
const { loading: deleting, mutate: deleteMedia } = useMutation(gql`
  mutation deleteMedia($id: ID!) {
    deleteMedia(id: $id) {
      success
      message
    }
  }
`);
watch(files as Ref, ([firstFile]) => {
  if (
    firstFile &&
    firstFile.status === "local" &&
    firstFile.file.type.includes("audio")
  ) {
    type.value = "audio";
  } else if (
    firstFile &&
    ((firstFile.status === "local" && firstFile.file.type.includes("video")) ||
      firstFile.status === "virtual")
  ) {
    type.value = "video";
  } else if (
    firstFile &&
    firstFile.status === "local" &&
    (!type.value || type.value === "video" || type.value === "audio")
  ) {
    type.value = "avatar";
  }
});

const visibleDropzone = inject<Ref<boolean>>("visibleDropzone");
const composingMode = inject<Ref<boolean>>("composingMode");

const modalVisible = computed(() => !!(files?.value?.length && !composingMode?.value));

watch(modalVisible, (newVisible, oldVisible) => {
  if (oldVisible && !newVisible) {
    nextTick(() => {
      editingMediaVar(undefined);
      refetch();
    });
  }
});

watch(visibleDropzone as Ref, (val) => {
  if (files?.value && files.value.length === 0 && val) {
    name.value = "";
    note.value = "";
  }
});

const addExistingFrame = () => {
  if (composingMode) {
    composingMode.value = true;
    inquiryVar({
      ...inquiryVar(),
      mediaTypes: [type.value],
    });
  }
};

const frameSize = ref({ width: 100, height: 100 });
const handleImageLoad = (e: Event, index: number) => {
  if (index === 0 && e.target) {
    const { width, height } = e.target as HTMLImageElement;
    if (width > height) {
      frameSize.value = {
        width: 100,
        height: (100 * height) / width,
      };
    } else {
      frameSize.value = {
        width: (100 * width) / height,
        height: 100,
      };
    }
  }
};
const handleVideoLoad = (e: any) => {
  if (e.target) {
    const { videoWidth: width, videoHeight: height } =
      e.target as HTMLVideoElement;
    if (width > height) {
      frameSize.value = {
        width: 100,
        height: (100 * height) / width,
      };
    } else {
      frameSize.value = {
        width: (100 * width) / height,
        height: 100,
      };
    }
  }
};
const clearSign = () => {
  editingMediaVar({
    ...editingMediaVar()!,
    sign: "",
  });
};
const onDelete = async () => {
  const res = await deleteMedia({
    id: editingMediaResult.value?.editingMedia?.id,
  });
  if ((res as any)?.data?.deleteMedia) {
    message.success((res as any)?.data?.deleteMedia?.message);
    refresh();
    handleClose();
  } else {
    message.error("Error!");
  }
};

const handleReplace = (): void => {
  if (visibleDropzone) {
    visibleDropzone.value = true;
  }
  model.value = true;
}

const { loading: dormanting, mutate: updateStatus } = useMutation(gql`
  mutation updateMediaStatus($id: ID!, $status: MediaStatusEnum!) {
    updateMediaStatus(input: { id: $id, status: $status }) {
      success
      message
    }
  }
`);
const onUpdateStatus = async () => {
  const res = await updateStatus({
    id: editingMediaResult.value?.editingMedia?.id,
    status: editingMediaResult.value?.editingMedia.dormant
      ? "Active"
      : "Dormant",
  });
  if ((res as any)?.data?.updateMediaStatus) {
    message.success((res as any)?.data?.updateMediaStatus?.message);
    editingMediaVar({
      ...editingMediaVar()!,
      dormant: !editingMediaResult.value?.editingMedia.dormant,
    });
    refresh();
  } else {
    message.error("Error!");
  }
};

const getUserDisplayName = (user: User) => {
  if (user.displayName) {
    return user.displayName;
  }
  return user.username;
};
</script>

<template>
  <a-modal
    :open="!!files?.length && !composingMode"
    :body-style="{ padding: 0 }"
    :width="1100"
    :closable="true"
    :mask-closable="false"
    @cancel="handleClose"
    @close="handleClose"
  >
    <template #title>
      <a-space>
        <a-input-group compact>
          <a-select
            :options="mediaTypes"
            v-model:value="type"
            style="min-width: 110px"
          ></a-select>
          <a-input v-model:value="name" :placeholder="mediaName"></a-input>
        </a-input-group>
        <template v-if="!['video', 'audio'].includes(type)">
          <a-button type="primary" @click="visibleDropzone = true">
            <UploadOutlined />
            Upload frame
          </a-button>
          <a-button type="primary" @click="addExistingFrame">
            <PlusCircleOutlined />
            Add existing frame
          </a-button>
          <a-button
            v-if="files!.length > 1"
            :type="clearMode ? 'primary' : 'dashed'"
            danger
            @click="clearMode = !clearMode"
          >
            <ClearOutlined />
            Clear frames
          </a-button>
        </template>
        <a-input
          v-else-if="type === 'video' && files && files.length"
          v-model:value="files![0].url"
          placeholder="Unique key"
          @focus="clearSign"
        ></a-input>
        <template v-if="editingMediaResult?.editingMedia?.id">
          <a-button
            v-if="files?.length == 1"
            type="primary"
            style="background-color: #1677ff; border-color: #1677ff"
            @click="handleReplace"
          >
            <Icon
              src="replace.webp"
              style="
                width: 14px;
                height: 14px;
                margin-right: 8px;
                margin-bottom: 3px;
              "
            />
            Replace
          </a-button>
          <template v-if="editingMediaResult?.editingMedia.dormant">
            <a-popconfirm
              placement="bottom"
              ok-text="Yes"
              cancel-text="No"
              :ok-button-props="{ danger: true }"
              @confirm="onUpdateStatus()"
            >
              <template #title>
                <div>Are you sure you want to make this media as active?</div>
              </template>

              <a-button
                type="primary"
                style="background-color: #faad14; border-color: #faad14"
                :loading="dormanting"
              >
                <Icon
                  src="icons8-sun.svg"
                  style="
                    width: 14px;
                    height: 14px;
                    margin-right: 8px;
                    margin-bottom: 3px;
                  "
                />
                Active
              </a-button>
            </a-popconfirm>
          </template>

          <template v-else>
            <a-popconfirm
              placement="bottom"
              ok-text="Yes"
              cancel-text="No"
              :ok-button-props="{ danger: true }"
              @confirm="onUpdateStatus()"
            >
              <template #title>
                <div>
                  <p>Are you sure you want to make this media as dormant?</p>
                  <p>
                    It will be available for any replay recordings that require it,
                  </p>
                  <p>but you will not see it in your Media list.</p>
                  <p>Only an Admin can see it and reactivate it.</p>
                  <p>
                    If it isn't needed, please delete it rather than making it dormant.
                  </p>
                </div>
              </template>

              <a-button
                type="primary"
                style="background-color: #faad14; border-color: #faad14"
                :loading="dormanting"
              >
                <Icon
                  src="icons8-sun.svg"
                  style="
                    width: 14px;
                    height: 14px;
                    margin-right: 8px;
                    margin-bottom: 3px;
                  "
                />
                Dormant
              </a-button>
            </a-popconfirm>
          </template>

          <a-popconfirm
            title="Are you sure you want to delete this media?"
            ok-text="Yes"
            cancel-text="No"
            @confirm="onDelete()"
            placement="bottom"
            :ok-button-props="{ danger: true }"
            loading="deleting"
          >
            <a-button
              type="primary"
              style="background-color: #ff4d4f; border-color: #ff4d4f"
              :loading="deleting"
            >
              <DeleteOutlined />
              Delete
            </a-button>
          </a-popconfirm>
        </template>
      </a-space>
    </template>
    <a-row :gutter="12">
      <a-col :span="6">
        <div
          class="bg-gray-200 flex items-center justify-center h-full"
          style="max-height: 600px"
        >
          <audio
            v-if="type === 'audio'"
            controls
            class="w-48"
            :key="files?.[0]?.preview"
          >
            <source v-if="files && files.length" :src="files[0].preview" />
            Your browser does not support the audio element.
          </audio>
          <template v-else-if="type === 'video'">
            <div
              v-if="files && files.length && files[0].status === 'virtual'"
              controls
              class="w-48"
            ></div>
            <video
              v-else
              controls
              class="w-48"
              :key="files?.[0]?.preview"
              @loadedmetadata="handleVideoLoad"
            >
              <source v-if="files && files.length" :src="files[0].preview" />
              Your browser does not support the video tag.
            </video>
          </template>
          <SlickList
            v-else
            axis="y"
            v-model:list="files"
            class="cursor-move w-full max-h-96 overflow-auto"
            :class="{ 'cursor-not-allowed': clearMode }"
            @sort-start="handleFrameClick"
          >
            <SlickItem
              v-for="(file, i) in files"
              :key="file.id"
              :index="i"
              style="z-index: 99999"
            >
              <div class="my-2 px-8 text-center">
                <img
                  show-handle
                  :src="file.preview"
                  class="max-w-full rounded-md max-h-24"
                  @load="handleImageLoad($event, i)"
                />
              </div>
            </SlickItem>
          </SlickList>
        </div>
        <a-alert
          v-if="files!.length > 1"
          :message="
            clearMode
              ? 'Click a frame to remove it'
              : 'Drag a frame to reorder its position'
          "
          :type="clearMode ? 'error' : 'success'"
          show-icon
          closable
          class="text-sm"
        />
      </a-col>
      <a-col :span="18">
        <div class="card-container pr-4">
          <a-tabs>
            <a-tab-pane key="stages" tab="Stages" class="pb-4">
              <StageAssignment v-model="stageIds as any" />
            </a-tab-pane>
            <a-tab-pane key="tags" tab="Tags" class="pb-4">
              <div class="p-4">
                <a-form-item :label="$t('tags')">
                  <a-select
                    v-model:value="tags"
                    mode="tags"
                    :placeholder="$t('tags')"
                    style="width: 100%"
                    :options="
                      result?.tags
                        ? result.tags.map((node) => ({
                            value: node.name,
                            label: node.name,
                          }))
                        : []
                    "
                  />
                </a-form-item>
                <p class="text-gray-500 text-sm">
                  Add tags to make this item easier to find when filtering (e.g. for a person or project).
                </p>
              </div>
            </a-tab-pane>
            <a-tab-pane key="permissions" tab="Permissions">
              <MediaPermissions
                :key="editingMediaResult?.editingMedia?.id"
                v-model="copyrightLevel"
                v-model:owner="owner"
                v-model:users="userIds"
                v-model:note="note"
                :media="editingMediaResult?.editingMedia"
              />
            </a-tab-pane>
            <a-tab-pane v-if="type === 'avatar'" key="voice" tab="Voice">
              <AvatarVoice :voice="voice" />
            </a-tab-pane>
            <a-tab-pane
              v-if="type === 'avatar' || type === 'prop'"
              key="link"
              tab="Link"
            >
              <PropLink :link="link" />
            </a-tab-pane>
            <a-tab-pane key="changeowner" tab="Change Owner">
              <div class="p-4">
                <a-form-item label="New Owner">
                  <a-select
                    v-model:value="owner"
                    placeholder="Select new owner"
                    :loading="!users.length"
                    show-search
                    :filter-option="false"
                    @search="handleSearch"
                    @dropdown-visible-change="handleDropdownVisibleChange"
                    :options="filteredUsers.map(user => ({
                      value: user.username,
                      label: getUserDisplayName(user),
                      key: user.id
                    }))"
                  />
                </a-form-item>
              </div>
            </a-tab-pane>
          </a-tabs>
        </div>
      </a-col>
    </a-row>
    <a-progress
      v-if="saving"
      :stroke-color="{
        from: '#108ee9',
        to: '#87d068',
      }"
      :percent="progress"
      status="active"
      class="absolute left-0 bottom-10"
      :show-info="false"
    >
      <template #format></template>
    </a-progress>
    <template #footer>
      <a-space>
        <a-select
          class="text-left"
          style="min-width: 200px"
          v-model:value="tags"
          mode="tags"
          placeholder="Tags"
          :options="
            result
              ? result.tags.map((node) => ({
                  value: node.name,
                  label: node.name,
                }))
              : []
          "
        >
        </a-select>
        <a-button
          key="submit"
          type="primary"
          :loading="saving"
          @click="saveMedia"
        >
          <span v-if="saving">Saving {{ progress }}%</span>
          <span v-else>{{ $t("save") }}</span>
        </a-button>
      </a-space>
    </template>
  </a-modal>
</template>

<style>
:deep(.ant-progress-outer) {
  padding-right: 0;
}
</style>