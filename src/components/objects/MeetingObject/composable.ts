// @ts-nocheck
import { useMeetingStore } from 'store/modules/meeting';
import { useStageStore } from 'store/modules/stage';
import { useUserStore } from 'store/modules/user';
import configs from 'config';

export const useLowLevelAPI = () => {
  return window?.JitsiMeetJS;
};

export const useJitsiDomain = () => {
  return configs.JITSI_DOMAIN;
};

export const useJitsi = () => {
  const meetingStore = useMeetingStore();
  const stageStore = useStageStore();
  const domain = useJitsiDomain();
  const stageUrl = stageStore.url;

  const initializeJitsi = async () => {
    await meetingStore.initializeJitsi(domain, stageUrl);
  };

  return [meetingStore.jitsi, meetingStore.joined];
};
