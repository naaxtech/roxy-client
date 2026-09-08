import {
  ARCHIVE_DELETE_PHRASE,
  ARCHIVE_DELETE_REASON_MIN,
  archiveDeleteErrorMessage,
  archiveSaveErrorMessage,
  canSubmitArchiveDelete,
} from '@/lib/archiveEntry';

describe('canSubmitArchiveDelete', () => {
  const base = {
    typedTitle: 'Portrait of a Lady on Fire',
    liveTitle: 'Portrait of a Lady on Fire',
    phrase: ARCHIVE_DELETE_PHRASE,
    reason: 'This was added twice and the other row is the one members are scoring.',
    acknowledged: true,
  };

  it('stays off until every gate is met', () => {
    expect(canSubmitArchiveDelete({ ...base, acknowledged: false })).toBe(false);
    expect(canSubmitArchiveDelete({ ...base, typedTitle: 'portrait of a lady on fire' })).toBe(false);
    expect(canSubmitArchiveDelete({ ...base, phrase: 'delete this entry' })).toBe(false);
    expect(canSubmitArchiveDelete({ ...base, reason: 'too short' })).toBe(false);
    expect(canSubmitArchiveDelete(base)).toBe(true);
  });

  it('does not accept a reason under the floor', () => {
    expect(base.reason.trim().length).toBeGreaterThanOrEqual(ARCHIVE_DELETE_REASON_MIN);
    expect(
      canSubmitArchiveDelete({ ...base, reason: 'x'.repeat(ARCHIVE_DELETE_REASON_MIN - 1) }),
    ).toBe(false);
  });
});

describe('archive error copy', () => {
  it('does not leak Postgres codes from a save failure', () => {
    const msg = archiveSaveErrorMessage('not authorised to manage archive entries');
    expect(msg).not.toMatch(/42501/);
    expect(msg.toLowerCase()).toContain('not authorised');
  });

  it('names the delete phrase when the server refuses the confirmation', () => {
    expect(archiveDeleteErrorMessage('type DELETE THIS ENTRY to confirm')).toContain(
      ARCHIVE_DELETE_PHRASE,
    );
  });
});
