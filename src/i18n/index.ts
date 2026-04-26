import { createI18n } from "vue-i18n";
import de from "./de";
import en from "./en";
import es from "./es";
import fr from "./fr";
import pt from "./pt";
import se from "./se";
import vn from "./vn";

const persistedLocale = localStorage.getItem("locale");

type MessageSchema = typeof en;
type LocaleMessages = Record<string, Partial<MessageSchema>>;

const messages: LocaleMessages = { de, en, es, fr, pt, se, vn };

const i18n = createI18n({
  legacy: false,
  locale: persistedLocale ?? "en",
  fallbackLocale: "en",
  messages,
});

export default i18n;
