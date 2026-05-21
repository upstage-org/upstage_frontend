<script lang="ts" setup>
import { useQuery } from "@vue/apollo-composable";
import { gql } from "@apollo/client/core";
import { computed, ref } from "vue";
import { AvatarVoice, StudioGraph, VoiceGraph } from "models/studio";
import { avatarSpeak } from "services/speech";
import { defaultTestMessage, variants, voices } from "services/speech/voice";
import { absolutePath } from "utils/common";

const emits = defineEmits(["change"]);

const visible = ref<boolean>(false);

const afterVisibleChange = (_bool: boolean) => {
  refetch();
};

const showDrawer = () => {
  visible.value = true;
};
const { result, loading, refetch } = useQuery<StudioGraph>(gql`
  {
    voices {
      voice {
        voice
        variant
        pitch
        speed
        amplitude
      }
      avatar {
        name
        src
        owner {
          displayName
          username
        }
      }
    }
  }
`);

const voiceDescription = ({ voice }: VoiceGraph) => {
  return `${voices[voice.voice!]} - ${variants[voice.variant]}`;
};
const keyword = ref("");
const dataSource = computed(() => {
  if (result.value) {
    const s = keyword.value.trim();
    return result.value.voices.filter(({ avatar }) => {
      if (avatar.name.toLowerCase().includes(s)) {
        return true;
      }
      if (avatar.owner.displayName.toLowerCase().includes(s)) {
        return true;
      }
      if (avatar.owner.username.toLowerCase().includes(s)) {
        return true;
      }
      return false;
    });
  }
  return [];
});

const test = ref(defaultTestMessage);
const tryVoice = (voice: AvatarVoice) => {
  avatarSpeak({ voice }, test.value || defaultTestMessage);
};
const select = ({ __typename, ...voice }: any) => {
  emits("change", voice);
  visible.value = false;
};
</script>

<template>
  <a-button class="ml-2" type="primary" @click="showDrawer">
    <copy-outlined />Replicate voice
  </a-button>
  <a-drawer
    v-model:visible="visible"
    class="custom-class"
    style="color: red"
    title="Available Voices"
    placement="right"
    width="500"
    @after-visible-change="afterVisibleChange"
  >
    <div class="flex">
      <a-input-search
        v-model:value="keyword"
        class="mr-2"
        placeholder="Search for avatar"
      ></a-input-search>
      <a-input v-model:value="test" placeholder="Test voice"></a-input>
    </div>
    <a-list
      class="demo-loadmore-list"
      :loading="loading"
      item-layout="horizontal"
      :data-source="dataSource"
    >
      <template #renderItem="{ item }">
        <a-list-item>
          <template #actions>
            <a-tooltip title="Try">
              <a-button @click="tryVoice(item.voice)">
                <sound-outlined />
              </a-button>
            </a-tooltip>
            <a-tooltip title="Replicate this voice" placement="topRight">
              <a-button type="primary" @click="select(item.voice)">
                <copy-outlined />
              </a-button>
            </a-tooltip>
          </template>
          <a-list-item-meta :description="voiceDescription(item)">
            <template #title>
              <a-button type="text" class="p-0">
                {{ item.avatar.name }}
                <span class="text-xs text-gray-400"
                  >&nbsp;- created by
                  {{ item.avatar.owner.displayName || item.avatar.owner.username }}</span
                >
              </a-button>
            </template>
            <template #avatar>
              <a-avatar :src="absolutePath(item.avatar.src)" size="large" />
            </template>
          </a-list-item-meta>
        </a-list-item>
      </template>
    </a-list>
  </a-drawer>
</template>
