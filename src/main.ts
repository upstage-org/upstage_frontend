import { createApp } from "vue";
import App from "./App.vue";
import i18n from "./i18n";
import "./styles/studio.less";
import { router } from "router";
import store from "./store";
import "@fortawesome/fontawesome-free/css/all.css";
import ClickOutside from "./directives/ClickOutside";

createApp(App).use(store).use(router).use(i18n).directive("click-outside", ClickOutside).mount("#app");
