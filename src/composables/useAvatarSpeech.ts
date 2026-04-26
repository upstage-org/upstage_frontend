import { avatarSpeak, stopSpeaking } from "@services/speech";

/**
 * Thin composable shell around the speech service so future code can pull in
 * avatar speech without going through the giant Vuex stage module.
 */
export const useAvatarSpeech = () => ({
  speak: avatarSpeak,
  stop: stopSpeaking,
});
