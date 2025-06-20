import { defineStore } from 'pinia'

interface Video {
  url: string;
  // Add other video properties as needed
}

export const useVideoStore = defineStore('videos', {
  state: () => ({
    videos: [] as Video[]
  }),
  
  getters: {
    getVideos: (state) => state.videos
  },
  
  actions: {
    setVideos(videos: Video[]) {
      this.videos = videos
    },
    
    addVideo(video: Video) {
      this.videos.push(video)
    },
    
    removeVideo(videoUrl: string) {
      this.videos = this.videos.filter(v => v.url !== videoUrl)
    }
  }
}) 