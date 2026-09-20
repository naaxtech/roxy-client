import type { ReportContentType } from '../lib/reportTargets';

/**
 * Who a report or a block from inside an audio room is actually about.
 *
 * Speed dating has one other person, so its ConsentStrip has an obvious
 * subject. A room has many, and this schema stores no participant list —
 * `community_rooms` carries an integer `participant_count` and there is no
 * `room_participants` table. Inventing a picker over data that does not exist
 * would be a control that cannot work.
 *
 * So the subject is the woman who OPENED the room. Reporting hands a moderator
 * the session id, which is what `contentType: 'room'` exists for (migration
 * 094, and `submit-report`'s allowlist — both deployed). Blocking the host is a
 * real, specific action rather than a gesture at a crowd.
 *
 * Both return null when they cannot be built. A control that can only fail is
 * worse than no control: it teaches her the safety surface does not work, at
 * the moment she most needs to believe it does.
 */

export type RoomReportTarget = {
  userId: string;
  contentType: ReportContentType;
  contentId: string;
};

export function roomReportTarget(
  { roomId, hostId }: { roomId: string; hostId: string | null }
): RoomReportTarget | null {
  // submit-report requires a subject. A null userId is refused by the function,
  // so the control is withheld rather than offered and broken.
  if (!hostId) return null;
  return { userId: hostId, contentType: 'room', contentId: roomId };
}

export function roomBlockTarget(
  { hostId, viewerId }: { hostId: string | null; viewerId: string | null }
): string | null {
  if (!hostId) return null;
  // `block_user` raises 22023 on a self-block. A host looking at her own room
  // must not be shown a control whose only outcome is an error.
  if (hostId === viewerId) return null;
  return hostId;
}
