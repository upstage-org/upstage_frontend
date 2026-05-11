// @ts-nocheck
/**
 * Vuex `stage` facade — Phase 5.3 Wave D (introduced) / Wave E (drained).
 *
 * Pinia (`src/store/pinia/stage.ts`) is the authoritative source of
 * state, mutations, and actions. As of Wave E this facade has no
 * remaining first-party consumers in `src/`; it stays mounted only
 * to keep the e2e suites (`tests/e2e/*.spec.ts`, `tests/e2e/pages/*`)
 * working, since they reach into `window.__UPSTAGE_STORE__` and
 * dispatch `stage/...` directly. Wave F migrates those helpers to
 * `__UPSTAGE_PINIA__.stage` and deletes this file plus the `vuex`
 * dependency entirely.
 *
 * How the facade works
 * --------------------
 * • State: `state()` returns a Proxy whose get/set route through to the
 *   Pinia store's refs. Pinia's store-level auto-unwrapping means
 *   `useStageStore().model` already returns the underlying value (not
 *   the Ref), so the Proxy just forwards. Reactivity is preserved
 *   because the Pinia ref's `.value` getter (invoked via the store
 *   proxy) registers the current Vue effect as a dependency on the
 *   ref, just as it would if a component read the Pinia store directly.
 * • Getters: each one returns `useStageStore().<getterName>`.
 * • Mutations: each one calls `useStageStore().<MUTATION_NAME>(payload)`.
 * • Actions: each one calls `useStageStore().<actionName>(payload)`,
 *   with two renames forced by Pinia setup-store name uniqueness:
 *     - Vuex `dispatch("stage/showPlayerChat", v)`  → Pinia
 *       `useStageStore().setShowPlayerChat(v)`
 *     - Vuex `dispatch("stage/reloadStreams")`      → Pinia
 *       `useStageStore().triggerReloadStreams()`
 *
 * State-key collisions (Vuex allowed `state.foo` and `getters.foo` to
 * coexist; Pinia setup stores can't). Pinia gives the state ref a `_`
 * prefix and keeps the public computed name. The facade maps Vuex
 * state-key reads/writes back to the Pinia `_`-prefixed refs:
 *
 *   activeMovable        → _activeMovable
 *   config               → _config
 *   reloadStreams        → _reloadStreams
 *   enabledLiveStreaming → _enabledLiveStreaming
 *
 * Side effects (MQTT, TTS, replay timers) live entirely in the Pinia
 * actions; the Vuex facade emits no MQTT traffic of its own and creates
 * no second broker client. The `buildClient()` call that used to sit at
 * the top of this file is gone.
 *
 * Wave plan
 * ---------
 * • Wave D (here): facade in place; consumer code unchanged.
 * • Wave E: migrate consumers off `store.*` onto `useStageStore().*` in
 *   batches of 5–10 files, running `pnpm e2e:perform` + `pnpm
 *   e2e:features` between batches.
 * • Wave F: delete this file and remove `vuex` from `package.json`.
 */

import { useStageStore } from "@stores/pinia/stage";

// Vuex state keys whose name in Pinia is prefixed with `_` because the
// matching getter took the public name on the Pinia setup-store return.
const STATE_KEY_REMAP: Record<string, string> = {
  activeMovable: "_activeMovable",
  config: "_config",
  reloadStreams: "_reloadStreams",
  enabledLiveStreaming: "_enabledLiveStreaming",
};

// Full list of Vuex-visible state keys, in the order they used to be
// declared. Used by the Proxy's `ownKeys`/`getOwnPropertyDescriptor` so
// `Object.keys(state.stage)`, devtools enumeration, and Vuex's internal
// reactive-state setup all see the same shape they did pre-Wave D.
const STATE_KEYS: ReadonlyArray<string> = [
  "preloading",
  "model",
  "background",
  "curtain",
  "backdropColor",
  "chatPosition",
  "status",
  "subscribeSuccess",
  "activeMovable",
  "chat",
  "board",
  "tools",
  "config",
  "settings",
  "settingPopup",
  "preferences",
  "reactions",
  "viewport",
  "sessions",
  "session",
  "replay",
  "audioPlayers",
  "isSavingScene",
  "isLoadingScenes",
  "showPlayerChat",
  "showClearChatSetting",
  "showDownloadChatSetting",
  "lastSeenPrivateMessage",
  "masquerading",
  "purchasePopup",
  "receiptPopup",
  "reloadStreams",
  "enabledLiveStreaming",
];

function piniaKey(vuexKey: string): string {
  return STATE_KEY_REMAP[vuexKey] || vuexKey;
}

export default {
  namespaced: true,

  state() {
    return new Proxy(
      {},
      {
        get(_, key) {
          // Vue's reactive wrapper occasionally pokes at symbols like
          // `Symbol.toPrimitive` or `__v_isReactive`. Return undefined
          // for those so we don't accidentally hand back a Pinia value
          // for a symbol the consumer never asked for.
          if (typeof key === "symbol") return undefined;
          return useStageStore()[piniaKey(key as string)];
        },
        set(_, key, value) {
          if (typeof key === "symbol") return false;
          useStageStore()[piniaKey(key as string)] = value;
          return true;
        },
        has(_, key) {
          return typeof key === "string" && STATE_KEYS.includes(key);
        },
        ownKeys() {
          return [...STATE_KEYS];
        },
        getOwnPropertyDescriptor(_, key) {
          if (typeof key === "string" && STATE_KEYS.includes(key)) {
            return { enumerable: true, configurable: true };
          }
          return undefined;
        },
      },
    );
  },

  getters: {
    ready: () => useStageStore().ready,
    url: () => useStageStore().url,
    objects: () => useStageStore().objects,
    config: () => useStageStore().config,
    preloadableAssets: () => useStageStore().preloadableAssets,
    audios: () => useStageStore().audios,
    currentAvatar: () => useStageStore().currentAvatar,
    activeMovable: () => useStageStore().activeMovable,
    stageSize: () => useStageStore().stageSize,
    canPlay: () => useStageStore().canPlay,
    players: () => useStageStore().players,
    audiences: () => useStageStore().audiences,
    unreadPrivateMessageCount: () => useStageStore().unreadPrivateMessageCount,
    whiteboard: () => useStageStore().whiteboard,
    jitsiTracks: () => useStageStore().jitsiTracks,
    reloadStreams: () => useStageStore().reloadStreams,
    activeObject: () => useStageStore().activeObject,
    enabledLiveStreaming: () => useStageStore().enabledLiveStreaming,
  },

  // All 61 mutations forward 1:1 to the Pinia store. The Vuex `state`
  // argument is ignored because the Pinia mutation already knows where
  // to write.
  mutations: {
    SET_MODEL: (_, p) => useStageStore().SET_MODEL(p),
    CLEAN_STAGE: (_, p) => useStageStore().CLEAN_STAGE(p),
    SET_BACKGROUND: (_, p) => useStageStore().SET_BACKGROUND(p),
    SET_STATUS: (_, p) => useStageStore().SET_STATUS(p),
    SET_SUBSCRIBE_STATUS: (_, p) => useStageStore().SET_SUBSCRIBE_STATUS(p),
    PUSH_CHAT_MESSAGE: (_, p) => useStageStore().PUSH_CHAT_MESSAGE(p),
    PUSH_PLAYER_CHAT_MESSAGE: (_, p) => useStageStore().PUSH_PLAYER_CHAT_MESSAGE(p),
    CLEAR_CHAT: () => useStageStore().CLEAR_CHAT(),
    CLEAR_PLAYER_CHAT: () => useStageStore().CLEAR_PLAYER_CHAT(),
    REMOVE_MESSAGE: (_, p) => useStageStore().REMOVE_MESSAGE(p),
    HIGHLIGHT_MESSAGE: (_, p) => useStageStore().HIGHLIGHT_MESSAGE(p),
    PUSH_OBJECT: (_, p) => useStageStore().PUSH_OBJECT(p),
    UPDATE_OBJECT: (_, p) => useStageStore().UPDATE_OBJECT(p),
    DELETE_OBJECT: (_, p) => useStageStore().DELETE_OBJECT(p),
    SET_OBJECT_SPEAK: (_, p) => useStageStore().SET_OBJECT_SPEAK(p),
    SET_PRELOADING_STATUS: (_, p) => useStageStore().SET_PRELOADING_STATUS(p),
    UPDATE_AUDIO: (_, p) => useStageStore().UPDATE_AUDIO(p),
    SET_SETTING_POPUP: (_, p) => useStageStore().SET_SETTING_POPUP(p),
    SEND_TO_BACK: (_, p) => useStageStore().SEND_TO_BACK(p),
    BRING_TO_FRONT: (_, p) => useStageStore().BRING_TO_FRONT(p),
    BRING_TO_FRONT_OF: (_, p) => useStageStore().BRING_TO_FRONT_OF(p),
    SET_PREFERENCES: (_, p) => useStageStore().SET_PREFERENCES(p),
    PUSH_DRAWING: (_, p) => useStageStore().PUSH_DRAWING(p),
    POP_DRAWING: (_, p) => useStageStore().POP_DRAWING(p),
    PUSH_TEXT: (_, p) => useStageStore().PUSH_TEXT(p),
    POP_TEXT: (_, p) => useStageStore().POP_TEXT(p),
    UPDATE_IS_DRAWING: (_, p) => useStageStore().UPDATE_IS_DRAWING(p),
    UPDATE_IS_WRITING: (_, p) => useStageStore().UPDATE_IS_WRITING(p),
    UPDATE_TEXT_OPTIONS: (_, p) => useStageStore().UPDATE_TEXT_OPTIONS(p),
    PUSH_REACTION: (_, p) => useStageStore().PUSH_REACTION(p),
    UPDATE_VIEWPORT: (_, p) => useStageStore().UPDATE_VIEWPORT(p),
    RESCALE_OBJECTS: (_, p) => useStageStore().RESCALE_OBJECTS(p),
    SET_CHAT_PARAMETERS: (_, p) => useStageStore().SET_CHAT_PARAMETERS(p),
    SET_PLAYER_CHAT_PARAMETERS: (_, p) => useStageStore().SET_PLAYER_CHAT_PARAMETERS(p),
    UPDATE_SESSIONS_COUNTER: (_, p) => useStageStore().UPDATE_SESSIONS_COUNTER(p),
    SET_CHAT_VISIBILITY: (_, p) => useStageStore().SET_CHAT_VISIBILITY(p),
    SET_DARK_MODE_CHAT: (_, p) => useStageStore().SET_DARK_MODE_CHAT(p),
    SET_REACTION_VISIBILITY: (_, p) => useStageStore().SET_REACTION_VISIBILITY(p),
    SET_CHAT_POSITION: (_, p) => useStageStore().SET_CHAT_POSITION(p),
    SET_BACKDROP_COLOR: (_, p) => useStageStore().SET_BACKDROP_COLOR(p),
    SET_REPLAY: (_, p) => useStageStore().SET_REPLAY(p),
    SET_ACTIVE_MOVABLE: (_, p) => useStageStore().SET_ACTIVE_MOVABLE(p),
    UPDATE_AUDIO_PLAYER_STATUS: (_, p) => useStageStore().UPDATE_AUDIO_PLAYER_STATUS(p),
    SET_CURTAIN: (_, p) => useStageStore().SET_CURTAIN(p),
    REPLACE_SCENE: (_, p) => useStageStore().REPLACE_SCENE(p),
    SET_SAVING_SCENE: (_, p) => useStageStore().SET_SAVING_SCENE(p),
    SET_SHOW_PLAYER_CHAT: (_, p) => useStageStore().SET_SHOW_PLAYER_CHAT(p),
    SET_SHOW_CLEAR_CHAT_SETTINGS: (_, p) => useStageStore().SET_SHOW_CLEAR_CHAT_SETTINGS(p),
    SET_SHOW_DOWNLOAD_CHAT_SETTINGS: (_, p) => useStageStore().SET_SHOW_DOWNLOAD_CHAT_SETTINGS(p),
    TAG_PLAYER: (_, p) => useStageStore().TAG_PLAYER(p),
    SEEN_PRIVATE_MESSAGES: () => useStageStore().SEEN_PRIVATE_MESSAGES(),
    UPDATE_WHITEBOARD: (_, p) => useStageStore().UPDATE_WHITEBOARD(p),
    TOGGLE_MASQUERADING: () => useStageStore().TOGGLE_MASQUERADING(),
    CREATE_ROOM: (_, p) => useStageStore().CREATE_ROOM(p),
    CREATE_STREAM: (_, p) => useStageStore().CREATE_STREAM(p),
    REORDER_TOOLBOX: (_, p) => useStageStore().REORDER_TOOLBOX(p),
    SET_PURCHASE_POPUP: (_, p) => useStageStore().SET_PURCHASE_POPUP(p),
    ADD_TRACK: (_, p) => useStageStore().ADD_TRACK(p),
    RELOAD_STREAMS: () => useStageStore().RELOAD_STREAMS(),
    OPEN_RECEIPT_POPUP: (_, p) => useStageStore().OPEN_RECEIPT_POPUP(p),
    CLOSE_RECEIPT_POPUP: () => useStageStore().CLOSE_RECEIPT_POPUP(),
  },

  // All 69 actions forward 1:1 to the Pinia store, except two whose
  // names collided with state or getter names on the Pinia setup-store
  // return (see file-header note). The Vuex names are preserved here so
  // existing `dispatch("stage/...")` call sites keep working unchanged.
  actions: {
    connect: () => useStageStore().connect(),
    subscribe: () => useStageStore().subscribe(),
    disconnect: () => useStageStore().disconnect(),
    handleMessage: (_, p) => useStageStore().handleMessage(p),
    sendChat: (_, p) => useStageStore().sendChat(p),
    speakAsAvatar: (_, p) => useStageStore().speakAsAvatar(p),
    handleChatMessage: (_, p) => useStageStore().handleChatMessage(p),
    placeObjectOnStage: (_, p) => useStageStore().placeObjectOnStage(p),
    shapeObject: (_, p) => useStageStore().shapeObject(p),
    deleteObject: (_, p) => useStageStore().deleteObject(p),
    switchFrame: (_, p) => useStageStore().switchFrame(p),
    sendToBack: (_, p) => useStageStore().sendToBack(p),
    bringToFront: (_, p) => useStageStore().bringToFront(p),
    bringToFrontOf: (_, p) => useStageStore().bringToFrontOf(p),
    toggleAutoplayFrames: (_, p) => useStageStore().toggleAutoplayFrames(p),
    handleBoardMessage: (_, p) => useStageStore().handleBoardMessage(p),
    setBackground: (_, p) => useStageStore().setBackground(p),
    showChatBox: (_, p) => useStageStore().showChatBox(p),
    enableDarkModeChat: (_, p) => useStageStore().enableDarkModeChat(p),
    showReactionsBar: (_, p) => useStageStore().showReactionsBar(p),
    setChatPosition: (_, p) => useStageStore().setChatPosition(p),
    setBackdropColor: (_, p) => useStageStore().setBackdropColor(p),
    drawCurtain: (_, p) => useStageStore().drawCurtain(p),
    loadScenes: () => useStageStore().loadScenes(),
    switchScene: (_, p) => useStageStore().switchScene(p),
    blankScene: () => useStageStore().blankScene(),
    handleBackgroundMessage: (_, p) => useStageStore().handleBackgroundMessage(p),
    updateAudioStatus: (_, p) => useStageStore().updateAudioStatus(p),
    handleAudioMessage: (_, p) => useStageStore().handleAudioMessage(p),
    closeSettingPopup: () => useStageStore().closeSettingPopup(),
    openSettingPopup: (_, p) => useStageStore().openSettingPopup(p),
    addDrawing: (_, p) => useStageStore().addDrawing(p),
    addText: (_, p) => useStageStore().addText(p),
    handleReactionMessage: (_, p) => useStageStore().handleReactionMessage(p),
    sendReaction: (_, p) => useStageStore().sendReaction(p),
    loadStage: (_, p) => useStageStore().loadStage(p),
    reloadPermission: () => useStageStore().reloadPermission(),
    loadPermission: () => useStageStore().loadPermission(),
    reloadScenes: () => useStageStore().reloadScenes(),
    reloadMissingEvents: () => useStageStore().reloadMissingEvents(),
    replaceScene: (_, p) => useStageStore().replaceScene(p),
    replayEvent: (_, p) => useStageStore().replayEvent(p),
    replicateEvent: (_, p) => useStageStore().replicateEvent(p),
    replayRecording: (_, p) => useStageStore().replayRecording(p),
    pauseReplay: () => useStageStore().pauseReplay(),
    seekForwardReplay: () => useStageStore().seekForwardReplay(),
    seekBackwardReplay: () => useStageStore().seekBackwardReplay(),
    handleCounterMessage: (_, p) => useStageStore().handleCounterMessage(p),
    joinStage: () => useStageStore().joinStage(),
    leaveStage: () => useStageStore().leaveStage(),
    sendStatisticsBeforeDisconnect: () => useStageStore().sendStatisticsBeforeDisconnect(),
    sendCounterLeave: () => useStageStore().sendCounterLeave(),
    sendStatistics: () => useStageStore().sendStatistics(),
    clearChat: () => useStageStore().clearChat(),
    clearPlayerChat: () => useStageStore().clearPlayerChat(),
    removeChat: (_, p) => useStageStore().removeChat(p),
    highlightChat: (_, p) => useStageStore().highlightChat(p),
    // Pinia rename: Vuex `showPlayerChat` action → Pinia `setShowPlayerChat`.
    showPlayerChat: (_, p) => useStageStore().setShowPlayerChat(p),
    autoFocusMoveable: (_, p) => useStageStore().autoFocusMoveable(p),
    handleDrawMessage: (_, p) => useStageStore().handleDrawMessage(p),
    sendDrawWhiteboard: (_, p) => useStageStore().sendDrawWhiteboard(p),
    sendUndoWhiteboard: () => useStageStore().sendUndoWhiteboard(),
    sendClearWhiteboard: () => useStageStore().sendClearWhiteboard(),
    closePurchasePopup: () => useStageStore().closePurchasePopup(),
    openPurchasePopup: (_, p) => useStageStore().openPurchasePopup(p),
    openReceiptPopup: (_, p) => useStageStore().openReceiptPopup(p),
    closeReceiptPopup: () => useStageStore().closeReceiptPopup(),
    addTrack: (_, p) => useStageStore().addTrack(p),
    // Pinia rename: Vuex `reloadStreams` action → Pinia `triggerReloadStreams`.
    reloadStreams: () => useStageStore().triggerReloadStreams(),
  },
};
