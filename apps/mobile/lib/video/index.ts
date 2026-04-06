export type { VideoCallProvider, VideoCallState, RemoteParticipant } from './VideoCallProvider';
export { DailyProvider } from './DailyProvider';
export { LiveKitProvider } from './LiveKitProvider';

/**
 * Create the default video call provider.
 * Switch to LiveKitProvider here once it is implemented.
 */
export function createVideoProvider(): import('./VideoCallProvider').VideoCallProvider {
  const { DailyProvider: Daily } = require('./DailyProvider');
  return new Daily();
}
