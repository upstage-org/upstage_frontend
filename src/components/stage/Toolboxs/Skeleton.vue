<template>
  <div class="is-flex is-align-items-center is-justify-content-center skeleton" :class="{ dropzone }" draggable="true"
    @dragstart="dragstart" @dragend="dragend" @dragenter.prevent @dragover.prevent="dropzone = true"
    @dragleave.prevent="dropzone = false" @drop.prevent="drop" @touchmove="touchmove" @touchend="touchend"
    @dblclick="hold" @mouseenter="showMovable" :style="{
      position: position.isDragging ? 'fixed' : 'static',
      width: position.isDragging ? '100px' : '100%',
      height: position.isDragging ? '100px' : '100%',
      top: position.y - (topbarPosition.top || 0) + 'px',
      left: position.x - (topbarPosition.left || 0) + 'px',
    }" :title="data.name">
    <slot v-if="$slots.default" />
    <SavedDrawing v-else-if="data.drawingId" :drawing="data" />
    <p v-else-if="data.type === 'text'" :style="{
      ...data,
      transform: `scale(${76 / (data.w || 1)})`,
      'transform-origin': 0,
      'max-width': '100%'
    }" v-html="data.content"></p>
    <div :title="`Stream key: ${data.name}`" class="is-fullwidth" v-else-if="data.type === 'video'">
      <Icon src="stream.svg" size="36" />
      <span class="tag is-light is-block stream-key" style="color: rgba(0, 0, 0, 0.7);">{{ data.name }}</span>
    </div>
    <div v-else-if="data.type === 'meeting'" class="is-flex-grow-1 pt-2">
      <Icon src="meeting.svg" size="48" />
      <span class="tag is-light is-block stream-key">{{ data.name }}</span>
    </div>
    <a-tooltip v-else-if="!data.src" :title=data.displayName>
      <Icon src='meeting.svg' size="36" />
    </a-tooltip>
    <Image v-else :src="data.src" />
    <Icon v-if="data.multi" class="is-multi" title="This is a multiframe avatar" src="multi-frame.svg" />
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import Image from "components/Image.vue"
import Icon from "components/Icon.vue"
import SavedDrawing from "./tools/Draw/SavedDrawing.vue"
import { useStageStore } from 'store'
import { useUserStore } from 'store/modules/user'

interface TopbarPosition {
  top: number
  left: number
}

const props = defineProps<{
  data: {
    id: string
    name: string
    type: string
    drawingId?: string
    content?: string
    w?: number
    src?: string
    displayName?: string
    multi?: boolean
    holder?: { id: string }
  }
  real?: boolean
  ghost?: boolean
  nodrop?: boolean
}>()

const emit = defineEmits<{
  (e: 'dragstart', event: DragEvent): void
}>()

const stageStore = useStageStore()
const userStore = useUserStore()

const position = reactive({
  isDragging: false,
  x: 0,
  y: 0
})

const topbarPosition = ref<TopbarPosition>({ top: 0, left: 0 })
const dropzone = ref(false)

const dragstart = (e: DragEvent) => {
  e.dataTransfer?.setData(
    "text",
    JSON.stringify({
      object: props.data,
      isReal: props.real,
      nodrop: props.nodrop,
    })
  )
  document.getElementById("meeting-room")?.classList.add("disable-pointer")
  emit("dragstart", e)
}

const dragend = () => {
  document.getElementById("meeting-room")?.classList.remove("disable-pointer")
  if (props.real) {
    stageStore.setActiveMovable(null)
  }
}

const touchmove = (e: TouchEvent) => {
  position.isDragging = true
  position.x = e.changedTouches[0]?.clientX - 50
  position.y = e.changedTouches[0]?.clientY - 50
  const topbar = document.getElementById("topbar")
  if (topbar) {
    topbarPosition.value = topbar.getBoundingClientRect()
  }
}

const touchend = () => {
  position.isDragging = false
  if (props.real) {
    stageStore.shapeObject({
      ...props.data,
      x: position.x,
      y: position.y,
    })
  } else {
    stageStore.placeObjectOnStage({
      ...props.data,
      x: position.x,
      y: position.y,
    })
  }
}

const holdable = computed(() => ["avatar"].includes(props.data.type))

const hold = () => {
  if (props.real && holdable.value && !props.data.holder) {
    userStore.setAvatarId(props.data.id)
  }
}

const showMovable = () => {
  if (
    props.real &&
    (!props.data.holder ||
      !holdable.value ||
      props.data.holder.id === stageStore.session)
  ) {
    stageStore.setActiveMovable(props.data.id)
  }
}

const drop = (e: DragEvent) => {
  dropzone.value = false
  const { object } = JSON.parse(e.dataTransfer?.getData("text") || '{}')
  if (props.real) {
    stageStore.bringToFrontOf({
      front: object.id,
      back: props.data.id,
    })
  } else {
    stageStore.reorderToolbox({
      from: object,
      to: props.data,
    })
  }
}
</script>

<style scoped lang="scss">
.stream-key {
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.skeleton {
  >* {
    transition-duration: 0.25s;
  }
}

.dropzone {
  background: repeating-radial-gradient(circle,
      green,
      green 10px,
      #007011 10px,
      #007011 20px);

  >* {
    transform: translateX(50%) !important;
  }
}
</style>
