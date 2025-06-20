<template>
  <header class="card-header">
    <div class="tabs card-header-title p-0">
      <ul>
        <li :class="{ 'is-active': currentTab === 'nickname' }" @click="currentTab = 'nickname'">
          <a>{{ $t("change_your_nickname") }}</a>
        </li>
        <li :class="{ 'is-active': currentTab === 'params' }" @click="currentTab = 'params'">
          <a>{{ $t("parameters") }}</a>
        </li>
        <li v-if="showDownloadChatSetting" :class="{ 'is-active': currentTab === 'download' }"
          @click="currentTab = 'download'">
          <a>{{ $t("download_chat") }}</a>
        </li>
      </ul>
    </div>
  </header>
  <div class="card-content">
    <div class="content" v-if="currentTab === 'nickname'">
      <HorizontalField title="Nickname">
        <input class="input" type="text" :placeholder="chatname" v-model="form.nickname" @keyup.enter="saveNickname" />
      </HorizontalField>
      <SaveButton @click="saveNickname" :loading="loading" />
    </div>
    <div class="content" v-else-if="currentTab === 'params'">
      <HorizontalField title="Chat transparency">
        <input v-model="parameters.opacity" type="range" class="slider is-fullwidth is-primary" step="0.01" min="0.2"
          max="1" />
      </HorizontalField>
      <HorizontalField title="Size (px)">
        <Field :modelValue="parameters.fontSize?.slice(0, -2)" @update:modelValue="changeFontSize" type="number" />
      </HorizontalField>

      <save-button @click="saveParameters" />
    </div>
    <div class="content" v-else>
      <h4>Select the sections you want to download</h4>
      <div class="field is-horizontal">
        <div class="field-label">
          <label class="label fix">{{ $t("audience_chat") }}</label>
        </div>
        <div class="field-body">
          <div class="field is-narrow">
            <a-tooltip :title="downloadOptions.audienceChat ? 'On' : 'Off'">
              <Switch v-model="downloadOptions.audienceChat" />
            </a-tooltip>
          </div>
        </div>
      </div>
      <div class="field is-horizontal">
        <div class="field-label">
          <label class="label fix">{{ $t("player_chat") }}</label>
        </div>
        <div class="field-body">
          <div class="field is-narrow">
            <a-tooltip :title="downloadOptions.playerChat ? 'On' : 'Off'">
              <Switch v-model="downloadOptions.playerChat" />
            </a-tooltip>
          </div>
        </div>
      </div>

      <DownloadButton @click="downloadChatLog" v-if="downloadOptions.audienceChat || downloadOptions.playerChat" />
      <DownloadButton disabled v-else />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useUserStore } from '../../../../stores/user'
import { useStageStore } from '../../../../stores/stage'
import { message } from 'ant-design-vue'
import HorizontalField from '@/components/form/HorizontalField.vue'
import Field from '@/components/form/Field.vue'
import SaveButton from '@/components/form/SaveButton.vue'
import DownloadButton from '@/components/form/DownloadButton.vue'
import Switch from '@/components/form/Switch.vue'

interface ChatMessage {
  user: string
  message: string
  clear?: boolean
}

interface PrivateMessage {
  user: string
  message: string
  clearPlayerChat?: boolean
}

const emit = defineEmits(['close'])

const userStore = useUserStore()
const stageStore = useStageStore()

const form = reactive({ nickname: '' })
const loading = ref(false)
const currentTab = ref('nickname')
const downloadOptions = ref({
  audienceChat: false,
  playerChat: false,
})

const chatname = userStore.chatname
const showDownloadChatSetting = stageStore.showDownloadChatSetting
const stageUrl = stageStore.url
const chats = stageStore.chat

const parameters = reactive({
  opacity: stageStore.chat.opacity,
  fontSize: stageStore.chat.fontSize,
})

const saveNickname = async () => {
  loading.value = true
  try {
    const nickname = await userStore.saveNickname(form)
    emit('close')
    message.success("Your new nickname is: " + nickname)
  } finally {
    loading.value = false
  }
}

const makeTextFile = (content: string[]) => {
  const data = new Blob(content, { type: "text/plain" })
  return window.URL.createObjectURL(data)
}

const padTo2Digits = (num: number) => {
  return num.toString().padStart(2, "0")
}

const formatDate = (date: Date) => {
  return (
    [padTo2Digits(date.getHours()), padTo2Digits(date.getMinutes())].join("") +
    "-" +
    [
      padTo2Digits(date.getDate()),
      padTo2Digits(date.getMonth() + 1),
      date.getFullYear(),
    ].join("")
  )
}

const timeStamp = () => {
  const date = new Date()
  return formatDate(date)
}

const downloadChatLog = () => {
  if (downloadOptions.value.audienceChat) {
    const link = document.createElement("a")
    const content = chats.messages.map((item: ChatMessage) => {
      const line = item.clear ? "---------------- Clear Chat ----------------" : `${item.user}: ${item.message}`
      return `${line}\r\n`
    })
    link.setAttribute("download", `${stageUrl}-Audience-chat-${timeStamp()}.txt`)
    link.href = makeTextFile(content)
    document.body.appendChild(link)
    window.requestAnimationFrame(() => {
      const event = new MouseEvent("click")
      link.dispatchEvent(event)
      document.body.removeChild(link)
    })
  }

  if (downloadOptions.value.playerChat) {
    const link = document.createElement("a")
    const content = chats.privateMessages.map((item: PrivateMessage) => {
      const line = item.clearPlayerChat ? "---------------- Clear Chat ----------------" : `${item.user}: ${item.message}`
      return `${line}\r\n`
    })
    link.setAttribute("download", `${stageUrl}-Player-chat-${timeStamp()}.txt`)
    link.href = makeTextFile(content)
    document.body.appendChild(link)
    window.requestAnimationFrame(() => {
      const event = new MouseEvent("click")
      link.dispatchEvent(event)
      document.body.removeChild(link)
    })
  }
  emit("close")
  message.success("Download success")
}

const changeFontSize = (value: string) => {
  parameters.fontSize = value.replace(/^\D+/g, "") + "px"
}

const saveParameters = () => {
  stageStore.setChatParameters(parameters)
  emit("close")
  message.success("Chat parameters saved successfully!")
}
</script>

<style>
.fix {
  width: 115px;
}
</style>
