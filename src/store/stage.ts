import { defineStore } from 'pinia'

interface StageObject {
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

interface StageState {
  curtain: string | null
  tools: {
    curtains: Array<{
      src: string
      name: string
    }>
  }
  whiteboard: any[]
  stageSize: {
    width: number
    height: number
    top: number
    left: number
  }
  objects: StageObject[]
}

export const useStageStore = defineStore('stage', {
  state: (): StageState => ({
    curtain: null,
    tools: {
      curtains: []
    },
    whiteboard: [],
    stageSize: {
      width: 0,
      height: 0,
      top: 0,
      left: 0
    },
    objects: []
  }),
  
  getters: {
    getObjects: (state) => state.objects
  },
  
  actions: {
    drawCurtain(curtain: string | null) {
      this.curtain = curtain
    },
    setStageSize(size: StageState['stageSize']) {
      this.stageSize = size
    },
    setWhiteboard(commands: any[]) {
      this.whiteboard = commands
    },
    setObjects(objects: StageObject[]) {
      this.objects = objects
    },
    addObject(object: StageObject) {
      this.objects.push(object)
    },
    removeObject(id: string) {
      this.objects = this.objects.filter(obj => obj.id !== id)
    }
  }
}) 