import { defineStore } from 'pinia'

interface SettingPopupState {
  isActive: boolean
  type: string | null
  title: string | null
  simple: boolean
}

export const useSettingPopupStore = defineStore('settingPopup', {
  state: (): SettingPopupState => ({
    isActive: false,
    type: null,
    title: null,
    simple: false
  }),

  actions: {
    openSettingPopup(type: string, title?: string, simple: boolean = false) {
      this.isActive = true
      this.type = type
      this.title = title || null
      this.simple = simple
    },

    closeSettingPopup() {
      this.isActive = false
      this.type = null
      this.title = null
      this.simple = false
    }
  }
}) 