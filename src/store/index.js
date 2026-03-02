import { createStore } from "vuex";
import VuexPersistence from "vuex-persist";
import auth from "./modules/auth";
import user from "./modules/user";
import stage from "./modules/stage";
import cache from "./modules/cache";
import config from "./modules/config";

const vuexLocal = new VuexPersistence({
  storage: window.localStorage,
  reducer: (state) => ({ auth: state.auth }),
});

export default createStore({
  modules: {
    auth,
    user,
    stage,
    cache,
    config,
  },
  plugins: [vuexLocal.plugin],
});
