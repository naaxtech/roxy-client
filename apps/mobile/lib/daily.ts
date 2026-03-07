// DailyVideo is only available in native builds (not Expo Go / web)
// We lazy-import and guard to prevent crashes
let DailyIframe: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const DailyModule = require('@daily-co/react-native-daily-js');
  DailyIframe = DailyModule.default ?? DailyModule.DailyIframe ?? null;
} catch {
  // Daily.co not available (Expo Go or web build) — video will be stubbed
}

export { DailyIframe };

export const isDailyAvailable = (): boolean => DailyIframe !== null;

export interface DailyRoomInfo {
  room_url: string;
  session_id: string;
  status: string;
  participant_count: number;
}
