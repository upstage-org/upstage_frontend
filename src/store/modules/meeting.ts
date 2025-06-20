import { defineStore } from 'pinia';
import { useStageStore } from './stage';
import { useUserStore } from './user';

interface MeetingState {
  joined: boolean;
  jitsi: {
    room: any;
    connection: any;
  };
}

export const useMeetingStore = defineStore('meeting', {
  state: (): MeetingState => ({
    joined: false,
    jitsi: {
      room: null,
      connection: null
    }
  }),

  actions: {
    setJoined(status: boolean) {
      this.joined = status;
    },

    setJitsiConnection(connection: any) {
      this.jitsi.connection = connection;
    },

    setJitsiRoom(room: any) {
      this.jitsi.room = room;
    },

    async initializeJitsi(domain: string, stageUrl: string) {
      const { JitsiMeetJS } = window;
      
      JitsiMeetJS.init();
      JitsiMeetJS.setLogLevel(JitsiMeetJS.logLevels.ERROR);

      const connection = new JitsiMeetJS.JitsiConnection(null, null, {
        hosts: {
          domain: domain,
          muc: `conference.${domain}`,
          focus: `focus.${domain}`,
        },
        bosh: `https://${domain}/http-bind`,
      });

      this.setJitsiConnection(connection);

      connection.addEventListener(
        JitsiMeetJS.events.connection.CONNECTION_ESTABLISHED,
        () => {
          const room = connection.initJitsiConference(stageUrl, {});
          this.setJitsiRoom(room);

          const stageStore = useStageStore();
          room.on(JitsiMeetJS.events.conference.TRACK_ADDED, (track) => {
            stageStore.addTrack(track);
          });

          room.on(JitsiMeetJS.events.conference.CONFERENCE_JOINED, () => {
            this.setJoined(true);
          });

          room.join();
        }
      );

      connection.addEventListener(
        JitsiMeetJS.events.connection.CONNECTION_FAILED,
        () => {
          this.setJoined(false);
        }
      );

      connection.addEventListener(
        JitsiMeetJS.events.connection.CONNECTION_DISCONNECTED,
        () => {
          this.setJoined(false);
        }
      );

      connection.connect();
    }
  }
}); 