import { defineStore } from "pinia";
import { reactive } from "vue";

interface BoardObject {
  id: string | number;
  type?: string;
  [key: string]: unknown;
}

/**
 * Stage board state (objects, drawings, texts, whiteboard strokes, tracks).
 *
 * Carved out of the 1435-line `store/modules/stage/index.ts` Vuex module. The
 * Vuex module currently owns this data; new components should target this
 * store and the Vuex module will be migrated to delegate here in a follow-up.
 */
export const useStageBoardStore = defineStore("stage-board", () => {
  const state = reactive<{
    objects: BoardObject[];
    drawings: unknown[];
    texts: unknown[];
    whiteboard: unknown[];
    tracks: unknown[];
  }>({
    objects: [],
    drawings: [],
    texts: [],
    whiteboard: [],
    tracks: [],
  });

  const setObjects = (objects: BoardObject[]) => {
    state.objects = objects;
  };
  const upsertObject = (object: BoardObject) => {
    const idx = state.objects.findIndex((o) => o.id === object.id);
    if (idx >= 0) state.objects.splice(idx, 1, object);
    else state.objects.push(object);
  };
  const removeObject = (id: BoardObject["id"]) => {
    state.objects = state.objects.filter((o) => o.id !== id);
  };

  return { state, setObjects, upsertObject, removeObject };
});
