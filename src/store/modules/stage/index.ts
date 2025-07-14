import { defineStore } from 'pinia';
import moment from 'moment';
import { v4 as uuidv4 } from 'uuid';
import hash from 'object-hash';
import buildClient from 'services/mqtt';
import {
  absolutePath,
  cloneDeep,
  randomColor,
  randomMessageColor,
  randomRange,
} from 'utils/common';
import {
  TOPICS,
  BOARD_ACTIONS,
  BACKGROUND_ACTIONS,
  COLORS,
  DRAW_ACTIONS,
} from 'constants/index';
import {
  deserializeObject,
  recalcFontSize,
  serializeObject,
  unnamespaceTopic,
  getDefaultStageConfig,
  getDefaultStageSettings,
} from './reusable';
import { getViewport } from './reactiveViewport';
import { stageGraph } from 'services/graphql';
import { useAttribute } from 'services/graphql/composable';
import { avatarSpeak, stopSpeaking } from 'services/speech';
import { animate } from 'animejs';
import { Promise } from 'core-js';
import { useUserStore } from '../user';

const mqtt = buildClient();

interface StageState {
  preloading: boolean;
  model: any;
  background: any;
  curtain: any;
  backdropColor: string;
  chatPosition: string;
  status: string;
  subscribeSuccess: boolean;
  activeMovable: string | null;
  chat: {
    messages: any[];
    privateMessages: any[];
    privateMessage: string;
    color: string | { text: string; bg: string };
    opacity: number;
    fontSize: string;
    playerFontSize: string;
  };
  board: {
    objects: any[];
    drawings: any[];
    texts: any[];
    whiteboard: any[];
    tracks: any[];
  };
  tools: {
    avatars: any[];
    props: any[];
    backdrops: any[];
    audios: any[];
    streams: any[];
    meetings: any[];
    curtains: any[];
  };
  config: any;
  settings: any;
  settingPopup: {
    isActive: boolean;
  };
  preferences: {
    isDrawing: boolean;
    text: {
      fontSize: string;
      fontFamily: string;
    };
  };
  reactions: any[];
  viewport: any;
  sessions: any[];
  session: any;
  replay: {
    timestamp: {
      begin: number;
      end: number;
      current: number;
    };
    timers: any[];
    interval: any;
    speed: number;
    isReplaying: boolean;
  };
  audioPlayers: any[];
  isSavingScene: boolean;
  isLoadingScenes: boolean;
  showPlayerChat: boolean;
  showClearChatSetting: boolean;
  showDownloadChatSetting: boolean;
  lastSeenPrivateMessage: number;
  masquerading: boolean;
  purchasePopup: {
    isActive: boolean;
    title: string;
    amount: number;
    description: string;
  };
  receiptPopup: {
    isActive: boolean;
    donationDetails: { amount: number; date: string };
  };
  reloadStreams: any;
}

export const useStageStore = defineStore('stage', {
  state: (): StageState => ({
    preloading: true,
    model: null,
    background: null,
    curtain: null,
    backdropColor: 'gray',
    chatPosition: 'right',
    status: 'OFFLINE',
    subscribeSuccess: false,
    activeMovable: null,
    chat: {
      messages: [],
      privateMessages: [],
      privateMessage: '',
      color: randomMessageColor(),
      opacity: 0.9,
      fontSize: '14px',
      playerFontSize: '14px',
    },
    board: {
      objects: [],
      drawings: [],
      texts: [],
      whiteboard: [],
      tracks: [],
    },
    tools: {
      avatars: [],
      props: [],
      backdrops: [],
      audios: [],
      streams: [],
      meetings: [],
      curtains: [],
    },
    config: getDefaultStageConfig(),
    settings: getDefaultStageSettings(),
    settingPopup: {
      isActive: false,
    },
    preferences: {
      isDrawing: false,
      text: {
        fontSize: '20px',
        fontFamily: 'Josefin Sans',
      },
    },
    reactions: [],
    viewport: getViewport(),
    sessions: [],
    session: null,
    replay: {
      isReplaying: false,
      timestamp: {
        begin: 0,
        end: 0,
        current: 0,
      },
      timers: [],
      interval: null,
      speed: 1,
    },
    audioPlayers: [],
    isSavingScene: false,
    isLoadingScenes: false,
    showPlayerChat: false,
    showClearChatSetting: false,
    showDownloadChatSetting: false,
    lastSeenPrivateMessage: Number(localStorage.getItem('lastSeenPrivateMessage') ?? 0),
    masquerading: false,
    purchasePopup: {
      isActive: false,
      title: '',
      amount: 0,
      description: '',
    },
    receiptPopup: {
      isActive: false,
      donationDetails: { amount: 0, date: '' },
    },
    reloadStreams: null,
  }),
  getters: {
    ready: (state) => state.model && !state.preloading,
    url: (state) => state.model ? state.model.fileLocation : 'demo',
    objects: (state) => state.board.objects.map((o) => ({
      ...o,
      holder: state.sessions.find((s) => s.avatarId === o.id),
    })),
    config: (state) => state.config,
    preloadableAssets: (state) => {
      const assets: any[] = []
        .concat(state?.tools?.avatars?.filter(a => !a.multi)?.map((a) => a.src) as any)
        .concat(state?.tools?.avatars?.filter(a => a.multi)?.map((a) => a?.frames ?? []).flat() as any)
        .concat(state?.tools?.props?.filter(a => !a.multi)?.map((p) => p.src) as any)
        .concat(state?.tools?.props?.filter(a => a.multi)?.map((a) => a?.frames ?? []).flat() as any)
        .concat(state?.tools?.backdrops?.filter(a => !a.multi)?.map((b) => b.src) as any)
        .concat(state?.tools?.backdrops?.filter(a => a.multi)?.map((a) => a.frames ?? []).flat() as any)
        .concat(state?.tools?.curtains?.map((b) => b.src) as any);
      return assets;
    },
    audios: (state) => state.tools.audios,
    currentAvatar: (state) => {
      const userStore = useUserStore();
      const id = userStore.avatarId;
      return state.board.objects.find((o) => o.id === id);
    },
    activeMovable: (state) => {
      if (state.masquerading) return null;
      return state.activeMovable;
    },
    stageSize: (state) => {
      let width = state.viewport.width;
      let height = state.viewport.height;
      let left = 0;
      let top = 0;
      const ratio = state.config.ratio;
      if (width / height > ratio) {
        width = height * ratio;
        left = (window.innerWidth - width) / 2;
      } else {
        height = width / ratio;
        if (window.innerWidth < window.innerHeight) {
          top = 0;
        } else {
          top = (window.innerHeight - height) / 2;
        }
      }
      return { width, height, left, top };
    },
    canPlay: (state) => {
      return (
        state.model &&
        state.model.permission &&
        state.model.permission !== 'audience' &&
        !state.replay.isReplaying &&
        !state.masquerading &&
        !state.replay.isReplaying
      );
    },
    players: (state) => state.sessions.filter((s) => s.isPlayer),
    audiences: (state) => state.sessions.filter((s) => !s.isPlayer),
    unreadPrivateMessageCount: (state) => {
      return state.chat.privateMessages.filter(
        (m) => m.at > state.lastSeenPrivateMessage,
      ).length;
    },
    whiteboard: (state) => state.board.whiteboard,
    jitsiTracks: (state) => state.board.tracks,
    activeObject: (state) => state.board.objects.find((o) => o.id === state.activeMovable),
  },
  actions: {
    setModel(model: any) {
      this.model = model;
      if (model) {
        const media = model.assets;
        if (media && media.length) {
          media.forEach((item: any) => {
            if (item.assetType?.name === 'video') {
              item.url = absolutePath(item.fileLocation);
            } else {
              if (item.description) {
                const meta = JSON.parse(item.description);
                delete item.description;
                Object.assign(item, meta);
              }
              item.src = absolutePath(item.fileLocation);
            }
            if (item.multi) {
              item.frames = item.frames.map((src: string) => absolutePath(src));
            }
            const key = item.assetType?.name + 's';
            if (!this.tools[key as keyof typeof this.tools]) {
              this.tools[key as keyof typeof this.tools] = [];
            }
            this.tools[key as keyof typeof this.tools].push(item);
          });
        } else {
          this.preloading = false;
        }
        const config = useAttribute({ value: model }, 'config', true).value;
        if (config) {
          Object.assign(this.config, config);
          this.config.ratio = config.ratio.width / config.ratio.height;
          this.backdropColor = this.config?.defaultcolor || COLORS.DEFAULT_BACKDROP;
        }
        const cover = useAttribute({ value: model }, 'cover', false).value;
        this.model.cover = cover && absolutePath(cover);
      }
    },
    cleanStage(cleanModel: boolean) {
      // Implement clean stage logic here
      if (cleanModel) {
        this.model = null;
        this.tools.audios = [];
      }
      this.status = "OFFLINE";
      this.replay.isReplaying = false;
      this.background = null;
      this.curtain = null;
      this.backdropColor = "gray";
      this.tools.avatars = [];
      this.tools.props = [];
      this.tools.backdrops = [];
      this.tools.streams = [];
      this.tools.curtains = [];
      this.config = getDefaultStageConfig();
      this.settings = getDefaultStageSettings();
      this.board.objects = [];
      this.board.drawings = [];
      this.board.texts = [];
      this.board.whiteboard = [];
      this.chat.messages = [];
      this.chat.privateMessages = [];
      this.chat.color = randomColor();
    },
    setBackground(background: any) {
      if (
        !this.background ||
        !this.background.at ||
        this.background.at < background.at
      ) {
        if (!this.background || this.background.id !== background.id) {
          // Not playing animation if only opacity change
          animate('#board', {
            opacity: [0, 1],
            duration: 5000,
          });
        }
        this.background = background;
      } else {
        this.background = background;
      }
    },
    setStatus(status: string) {
      this.status = status;
    },
    setSubscribeStatus(status: boolean) {
      this.subscribeSuccess = status;
    },
    pushChatMessage(message: any) {
      // TODO: Implement push chat message logic here
      // message.hash = hash(message);
      // const lastMessage = state.chat.messages[state.chat.messages.length - 1];
      // if (lastMessage && lastMessage.hash === message.hash) {
      //   return;
      // }
      // state.chat.messages.push(message);
      this.chat.messages.push(message);
    },
    pushPlayerChatMessage(message: any) {      
      // TODO: Implement push player chat message logic here
      // message.hash = hash(message);
      // const lastMessage =
      //   state.chat.privateMessages[state.chat.privateMessages.length - 1];
      // if (lastMessage && lastMessage.hash === message.hash) {
      //   return;
      // }
      // state.chat.privateMessages.push(message);
      this.chat.privateMessages.push(message);
    },
    clearChat() {
      this.chat.messages = [];
    },
    clearPlayerChat() {
      this.chat.privateMessages = [];
    },
    removeMessage(id: string) {
      this.chat.messages = this.chat.messages.filter((m) => m.id !== id);
    },
    highlightMessage(id: string) {
      const message = this.chat.messages.find((m) => m.id === id);
      if (message) {
        message.highlight = true;
      }
    },
    pushObject(object: any) {
      this.board.objects.push(object);
    },
    updateObject(object: any) {
      const index = this.board.objects.findIndex((o) => o.id === object.id);
      if (index !== -1) {
        this.board.objects[index] = object;
      }
    },
    deleteObject(object: any) {
      this.board.objects = this.board.objects.filter((o) => o.id !== object.id);
    },
    setObjectSpeak({ avatar, speak, mute }: { avatar: any; speak: boolean; mute: boolean }) {
      const object = this.board.objects.find((o) => o.id === avatar.id);
      if (object) {
        object.speak = speak;
        object.mute = mute;
      }
    },
    setPreloadingStatus(status: boolean) {
      this.preloading = status;
    },
    updateAudio(audio: any) {
      const index = this.tools.audios.findIndex((a) => a.id === audio.id);
      if (index !== -1) {
        this.tools.audios[index] = audio;
      }
    },
    setSettingPopup(setting: boolean) {
      this.settingPopup.isActive = setting;
    },
    sendToBack(object: any) {
      const index = this.board.objects.findIndex((o) => o.id === object.id);
      if (index !== -1) {
        this.board.objects.splice(index, 1);
        this.board.objects.unshift(object);
      }
    },
    bringToFront(object: any) {
      const index = this.board.objects.findIndex((o) => o.id === object.id);
      if (index !== -1) {
        this.board.objects.splice(index, 1);
        this.board.objects.push(object);
      }
    },
    bringToFrontOf({ front, back }: { front: any; back: any }) {
      const frontIndex = this.board.objects.findIndex((o) => o.id === front.id);
      const backIndex = this.board.objects.findIndex((o) => o.id === back.id);
      if (frontIndex !== -1 && backIndex !== -1) {
        this.board.objects.splice(frontIndex, 1);
        this.board.objects.splice(backIndex, 0, front);
      }
    },
    setPreferences(preferences: any) {
      this.preferences = preferences;
    },
    pushDrawing(drawing: any) {
      this.board.drawings.push(drawing);
    },
    popDrawing(drawingId: string) {
      this.board.drawings = this.board.drawings.filter((d) => d.id !== drawingId);
    },
    pushText(text: any) {
      this.board.texts.push(text);
    },
    popText(textId: string) {
      this.board.texts = this.board.texts.filter((t) => t.id !== textId);
    },
    updateIsDrawing(isDrawing: boolean) {
      this.preferences.isDrawing = isDrawing;
    },
    updateIsWriting(isWriting: boolean) {
      // Implement update is writing logic here
    },
    updateTextOptions(options: any) {
      this.preferences.text = options;
    },
    pushReaction(reaction: any) {
      this.reactions.push(reaction);
    },
    updateViewport(viewport: any) {
      this.viewport = viewport;
    },
    rescaleObjects(ratio: number) {
      this.board.objects.forEach((o) => {
        o.x *= ratio;
        o.y *= ratio;
        o.width *= ratio;
        o.height *= ratio;
      });
    },
    setChatParameters({ opacity, fontSize }: { opacity: number; fontSize: string }) {
      this.chat.opacity = opacity;
      this.chat.fontSize = fontSize;
    },
    setPlayerChatParameters({ playerFontSize }: { playerFontSize: string }) {
      this.chat.playerFontSize = playerFontSize;
    },
    updateSessionsCounter(session: any) {
      const index = this.sessions.findIndex((s) => s.id === session.id);
      if (index !== -1) {
        this.sessions[index] = session;
      } else {
        this.sessions.push(session);
      }
    },
    setChatVisibility(visible: boolean) {
      // Implement chat visibility logic here
    },
    setDarkModeChat(enabled: boolean) {
      // Implement dark mode chat logic here
    },
    setReactionVisibility(visible: boolean) {
      // Implement reaction visibility logic here
    },
    setChatPosition(position: string) {
      this.chatPosition = position;
    },
    setBackdropColor(color: string) {
      this.backdropColor = color;
    },
    setReplay(replay: any) {
      this.replay = replay;
    },
    setActiveMovable(id: string | null) {
      this.activeMovable = id;
    },
    updateAudioPlayerStatus({ index, ...status }: { index: number; [key: string]: any }) {
      if (this.audioPlayers[index]) {
        this.audioPlayers[index] = { ...this.audioPlayers[index], ...status };
      }
    },
    setCurtain(curtain: any) {
      this.curtain = curtain;
    },
    replaceScene({ payload }: { payload: any }) {
      // Implement replace scene logic here
    },
    setSavingScene(value: boolean) {
      this.isSavingScene = value;
    },
    setShowPlayerChat(value: boolean) {
      // this.showPlayerChat = value;
    },
    setShowClearChatSettings(value: boolean) {
      this.showClearChatSetting = value;
    },
    setShowDownloadChatSettings(value: boolean) {
      this.showDownloadChatSetting = value;
    },
    tagPlayer(player: any) {
      // Implement tag player logic here
    },
    seenPrivateMessages() {
      this.lastSeenPrivateMessage = Date.now();
      localStorage.setItem('lastSeenPrivateMessage', String(this.lastSeenPrivateMessage));
    },
    updateWhiteboard(message: any) {
      // Implement update whiteboard logic here
    },
    toggleMasquerading() {
      this.masquerading = !this.masquerading;
    },
    createRoom(room: any) {
      // Implement create room logic here
    },
    createStream(room: any) {
      // Implement create stream logic here
    },
    reorderToolbox({ from, to }: { from: number; to: number }) {
      // Implement reorder toolbox logic here
    },
    setPurchasePopup(purchase: any) {
      this.purchasePopup = purchase;
    },
    addTrack(track: any) {
      this.board.tracks.push(track);
    },
    reloadStreams() {
      // Implement reload streams logic here
    },
    openReceiptPopup({ amount, date }: { amount: number; date: string }) {
      this.receiptPopup = { isActive: true, donationDetails: { amount, date } };
    },
    closeReceiptPopup() {
      this.receiptPopup.isActive = false;
    },
    connect() {
      // Implement connect logic here
    },
    subscribe() {
      // Implement subscribe logic here
    },
    async disconnect() {
      // Implement disconnect logic here
    },
    handleMessage({ topic, message }: { topic: string; message: any }) {
      // Implement handle message logic here
    },
    sendChat({ message, isPrivate }: { message: string; isPrivate: boolean }) {
      // Implement send chat logic here
    },
    handleChatMessage({ message }: { message: any }) {
      // Implement handle chat message logic here
    },
    placeObjectOnStage(data: any) {
      // Implement place object on stage logic here
    },
    shapeObject(object: any) {
      // Implement shape object logic here
    },
    // deleteObject(object: any) {
    //   // Implement delete object logic here
    // },
    switchFrame(object: any) {
      // Implement switch frame logic here
    },
    // sendToBack(object: any) {
    //   // Implement send to back logic here
    // },
    // bringToFront(object: any) {
    //   // Implement bring to front logic here
    // },
    // bringToFrontOf({ front, back }: { front: any; back: any }) {
    //   // Implement bring to front of logic here
    // },
    toggleAutoplayFrames(object: any) {
      // Implement toggle autoplay frames logic here
    },
    handleBoardMessage({ message }: { message: any }) {
      // Implement handle board message logic here
    },
    // setBackground(background: any) {
    //   // Implement set background logic here
    // },
    showChatBox(visible: boolean) {
      // Implement show chat box logic here
    },
    enableDarkModeChat(enabled: boolean) {
      // Implement enable dark mode chat logic here
    },
    showReactionsBar(visible: boolean) {
      // Implement show reactions bar logic here
    },
    // setChatPosition(position: string) {
    //   // Implement set chat position logic here
    // },
    // setBackdropColor(color: string) {
    //   // Implement set backdrop color logic here
    // },
    drawCurtain(curtain: any) {
      // Implement draw curtain logic here
    },
    loadScenes() {
      // Implement load scenes logic here
    },
    switchScene(scene: any) {
      // Implement switch scene logic here
    },
    blankScene() {
      // Implement blank scene logic here
    },
    handleBackgroundMessage({ message }: { message: any }) {
      // Implement handle background message logic here
    },
    updateAudioStatus(audio: any) {
      // Implement update audio status logic here
    },
    handleAudioMessage({ message }: { message: any }) {
      // Implement handle audio message logic here
    },
    closeSettingPopup() {
      // Implement close setting popup logic here
    },
    openSettingPopup(setting: any) {
      // Implement open setting popup logic here
    },
    addDrawing(drawing: any) {
      // Implement add drawing logic here
    },
    addText(text: any) {
      // Implement add text logic here
    },
    handleReactionMessage({ message }: { message: any }) {
      // Implement handle reaction message logic here
    },
    sendReaction(reaction: any) {
      // Implement send reaction logic here
    },
    async loadStage({ url, recordId }: { url: string; recordId: string }) {
      // Implement load stage logic here
    },
    async reloadPermission() {
      // Implement reload permission logic here
    },
    async loadPermission() {
      // Implement load permission logic here
    },
    async reloadScenes() {
      // Implement reload scenes logic here
    },
    async reloadMissingEvents() {
      // Implement reload missing events logic here
    },
    // replaceScene(sceneId: string) {
    //   // Implement replace scene logic here
    // },
    replayEvent({ topic, payload }: { topic: string; payload: any }) {
      // Implement replay event logic here
    },
    replicateEvent({ topic, payload }: { topic: string; payload: any }) {
      // Implement replicate event logic here
    },
    async replayRecording(timestamp: number) {
      // Implement replay recording logic here
    },
    pauseReplay() {
      // Implement pause replay logic here
    },
    seekForwardReplay() {
      // Implement seek forward replay logic here
    },
    seekBackwardReplay() {
      // Implement seek backward replay logic here
    },
    handleCounterMessage({ message }: { message: any }) {
      // Implement handle counter message logic here
    },
    async joinStage() {
      // Implement join stage logic here
    },
    async leaveStage() {
      // Implement leave stage logic here
    },
    async sendStatisticsBeforeDisconnect() {
      // Implement send statistics before disconnect logic here
    },
    async sendCounterLeave() {
      // Implement send counter leave logic here
    },
    async sendStatistics() {
      // Implement send statistics logic here
    },
    // clearChat() {
    //   // Implement clear chat logic here
    // },
    // clearPlayerChat() {
    //   // Implement clear player chat logic here
    // },
    removeChat(messageId: string) {
      // Implement remove chat logic here
    },
    highlightChat(messageId: string) {
      // Implement highlight chat logic here
    },
    showPlayerChat(visible: boolean) {
      // Implement show player chat logic here
    },
    autoFocusMoveable(id: string) {
      // Implement auto focus moveable logic here
    },
    handleDrawMessage({ message }: { message: any }) {
      // Implement handle draw message logic here
    },
    sendDrawWhiteboard(command: any) {
      // Implement send draw whiteboard logic here
    },
    sendUndoWhiteboard() {
      // Implement send undo whiteboard logic here
    },
    sendClearWhiteboard() {
      // Implement send clear whiteboard logic here
    },
    closePurchasePopup() {
      this.resetPurchasePopup()
    },
    resetPurchasePopup() {
      this.purchasePopup = {
        isActive: false,
        title: '',
        amount: 0,
        description: '',
      };
    },
    openPurchasePopup(setting: any) {
      setting.isActive = true;
      this.purchasePopup = setting;
      this.receiptPopup.donationDetails = {
        ...setting,
        date: new Date().toLocaleDateString(),
      };
    },
    // openReceiptPopup(setting: any) {
    //   // Implement open receipt popup logic here
    // },
    // closeReceiptPopup() {
    //   // Implement close receipt popup logic here
    // },
    // addTrack(track: any) {
    //   // Implement add track logic here
    // },
    // reloadStreams() {
    //   // Implement reload streams logic here
    // },
  },
});
