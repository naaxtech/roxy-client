export type { VideoCallProvider, VideoCallState, RemoteParticipant } from './VideoCallProvider';
export { DailyProvider } from './DailyProvider';

/**
 * Daily.co is the video provider (CLAUDE.md §4 — locked, do not relitigate).
 *
 * A LiveKitProvider stub and a `livekit-token` edge function used to sit beside
 * this one. Neither was ever wired up — no @livekit/* package is installed —
 * and their only real effect was to send anyone debugging a failed join looking
 * for a provider switch that did not exist. They are deleted. If LiveKit is ever
 * genuinely adopted, add it then; a second provider only earns its place in the
 * tree once something calls it.
 */
export function createVideoProvider(): import('./VideoCallProvider').VideoCallProvider {
  const { DailyProvider: Daily } = require('./DailyProvider');
  return new Daily();
}
