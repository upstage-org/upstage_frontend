import { getDefaultVoice, isValidVoice } from "./voice";

const { loadVoice, speak, stop } = (window as any).meSpeak;

type SpeakParams = { variant?: string; amplitude?: number; pitch?: number; speed?: number };

// A board avatar object; only `voice` and `speak.behavior` are read here.
export const avatarSpeak = (avatar: Record<string, any>, message: string) => {
  const params: SpeakParams = {};
  if (avatar.voice && avatar.voice.voice) {
    const { voice, variant, amplitude, pitch, speed } = avatar.voice;
    params.variant = variant;
    params.amplitude = amplitude ?? 100;
    if (avatar.speak) {
      if (avatar.speak.behavior === "think") {
        return;
      }
      if (avatar.speak.behavior === "shout") {
        params.amplitude = (params.amplitude ?? 100) * 5;
      }
    }
    params.pitch = pitch;
    params.speed = speed;

    const callback = () => speak(cleanEmoji(message), params); // voice got loaded assynchronous
    if (isValidVoice(voice)) {
      loadVoice(voice, callback);
    } else {
      loadVoice(getDefaultVoice(), callback);
    }
  }
};

export const stopSpeaking = stop;

export const cleanEmoji = (message: string) => {
  return message.replace(
    /([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g,
    "",
  );
};
