import { avatarSpeak, stopSpeaking } from "@services/speech";

/**
 * Thin composable shell around the speech service so callers can pull
 * in avatar speech without dragging in the full stage store.
 */
export const useAvatarSpeech = () => ({
  speak: avatarSpeak,
  stop: stopSpeaking,
});
