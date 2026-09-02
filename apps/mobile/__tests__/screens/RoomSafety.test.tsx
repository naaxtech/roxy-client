import { roomReportTarget, roomBlockTarget } from '../../app/roomSafety';

/**
 * A woman in a live audio room needs a way out that is more than the door.
 *
 * The room screen shipped with a Leave button and nothing else — no report, no
 * block. Speed dating has had a pinned ConsentStrip since it was built; the
 * audio room, which is the surface where a stranger can talk over you to a
 * whole community, had neither. The plan's acceptance line is that a session
 * which can render without the strip is a defect, and it named BOTH surfaces.
 *
 * What the strip can honestly do here is narrower than in a video date, and
 * these tests pin that honesty rather than papering over it. A date has exactly
 * one other person, so report and block have an obvious subject. A room has
 * many, and this schema stores no participant list — `community_rooms` carries
 * an integer `participant_count` and no `room_participants` table. So the
 * subject is the person who OPENED the room: reporting it hands a moderator the
 * session, and blocking its host is a real, specific action rather than a
 * gesture at a crowd.
 */

describe('who a room report is about', () => {
  it('reports the room itself, with the session id a moderator can act on', () => {
    const target = roomReportTarget({ roomId: 'r1', hostId: 'u-host' });
    expect(target).toEqual({
      userId: 'u-host',
      contentType: 'room',
      contentId: 'r1',
    });
  });

  it('uses the room content type, which migration 094 and submit-report both accept', () => {
    // Before 094 this value was refused by the reports CHECK, so a report from
    // a live surface died on a constraint. Both are deployed now.
    const target = roomReportTarget({ roomId: 'r1', hostId: 'u-host' });
    expect(target).not.toBeNull();
    expect(target!.contentType).toBe('room');
  });

  it('refuses to build a report with no host rather than sending a null subject', () => {
    // submit-report requires a userId. Sending null would be refused by the
    // function, and the woman would see a failure she cannot act on — better to
    // not offer the control than to offer one that cannot work.
    expect(roomReportTarget({ roomId: 'r1', hostId: null })).toBeNull();
  });
});

describe('who a room block is about', () => {
  it('blocks the host, because a room is not a person', () => {
    expect(roomBlockTarget({ hostId: 'u-host', viewerId: 'u-me' })).toBe('u-host');
  });

  it('never offers to block yourself in your own room', () => {
    // block_user raises 22023 on a self-block. A host looking at her own room
    // must not be shown a control that can only fail.
    expect(roomBlockTarget({ hostId: 'u-me', viewerId: 'u-me' })).toBeNull();
  });

  it('has nothing to block when the host is unknown', () => {
    expect(roomBlockTarget({ hostId: null, viewerId: 'u-me' })).toBeNull();
  });
});
