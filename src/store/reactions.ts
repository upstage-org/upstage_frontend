import { defineStore } from 'pinia'

interface Reaction {
  reaction: string
  x: number
  y: number
}

interface ReactionsState {
  reactions: Reaction[]
  settings: {
    reactionVisibility: boolean
  }
}

export const useReactionsStore = defineStore('reactions', {
  state: (): ReactionsState => ({
    reactions: [],
    settings: {
      reactionVisibility: true
    }
  }),

  actions: {
    sendReaction(reaction: string) {
      // Add new reaction with random position
      const x = Math.random() * window.innerWidth
      const y = Math.random() * window.innerHeight
      this.reactions.push({ reaction, x, y })
      
      // Remove reaction after animation
      setTimeout(() => {
        this.reactions = this.reactions.filter(r => r !== this.reactions[this.reactions.length - 1])
      }, 2000)
    },

    setReactionVisibility(visible: boolean) {
      this.settings.reactionVisibility = visible
    }
  }
}) 