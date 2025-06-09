import { createPinia } from 'pinia';
import { useUserStore } from './modules/user';
import { useStageStore } from './modules/stage';
import { useCacheStore } from './modules/cache';
import { useConfigStore } from './modules/config';

const pinia = createPinia();

export {
  useUserStore,
  useStageStore,
  useCacheStore,
  useConfigStore,
};

export default pinia;
