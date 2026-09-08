import { readFileSync } from 'fs';
import { join } from 'path';
import { writeFailureMessage, ChannelInputError } from '../../lib/channels';

/**
 * The two holes review found in migration 105, and the error text that reached
 * a member's screen.
 *
 * Both database holes were verified by running the attack against production
 * before 107, and again after it. 105's own verification run had covered
 * "editing her OWN body ALLOWED" and "hard DELETE REFUSED" — neither of these
 * was one column away from what was checked, which is the lesson:
 *
 *   1. The author could write `deleted_at = null`, so the person being
 *      moderated could undo the moderation, unlimited times.
 *   2. A moderator could write `body`, so she could put words in a member's
 *      mouth — silently, since nothing set `edited_at`.
 *
 * There is no database in this environment, so these read the migration text.
 * They exist to fail if a later edit removes the guard.
 */

const M107 = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations', '107_channel_messages_integrity.sql'),
  'utf8',
);
const body = M107.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

describe('migration 107', () => {
  it('stops anyone but the author changing a message body', () => {
    expect(body).toMatch(/new\.body\s+is\s+distinct\s+from\s+old\.body\s+and\s+not\s+is_author/i);
  });

  it('stops the author restoring a message a moderator removed', () => {
    expect(body).toMatch(/old\.deleted_at\s+is\s+not\s+null\s+and\s+new\.deleted_at\s+is\s+null\s+and\s+not\s+is_mod/i);
  });

  it('gates on OLD, never on NEW alone', () => {
    // Reading only NEW lets the caller choose which rule applies to her.
    for (const m of [/old\.body/, /old\.deleted_at/, /old\.sender_id/]) expect(body).toMatch(m);
  });

  it('stamps edited_at itself, so the badge cannot be forged or forgotten', () => {
    // It was a read with no writer: ChannelMessage rendered an "edited" badge
    // from a column nothing in the codebase ever set.
    expect(body).toMatch(/new\.edited_at\s*:=\s*now\(\)/i);
    expect(body).toMatch(/revoke\s+update\s*\(\s*edited_at\s*\)[\s\S]*?from\s+authenticated/i);
  });

  it('freezes the columns that decide identity and order', () => {
    for (const col of ['created_at', 'sender_id', 'channel_id']) {
      expect(body).toMatch(new RegExp(`new\\.${col}\\s*:=\\s*old\\.${col}`, 'i'));
    }
  });

  it('runs BEFORE the update, where it can still refuse', () => {
    expect(body).toMatch(/before\s+update\s+on\s+public\.community_channel_messages/i);
  });
});

describe('writeFailureMessage', () => {
  it('never lets a database error reach the woman reading it', () => {
    // PostgrestError extends Error, so `e.message` reached the composer as
    // policy text naming the table — a client-visible internal error and a
    // schema leak both, which `.claude/rules/react.md` bans.
    const dbError = Object.assign(
      new Error('new row violates row-level security policy for table "community_channel_messages"'),
      { code: '42501' },
    );
    const shown = writeFailureMessage(dbError);
    expect(shown).toBe('You do not have permission to do that here.');
    expect(shown).not.toMatch(/policy|community_channel_messages|row-level/);
  });

  it('translates a constraint violation without naming the constraint', () => {
    const shown = writeFailureMessage(
      Object.assign(new Error('violates check constraint "community_channel_messages_body_len"'), { code: '23514' }),
    );
    expect(shown).toBe('That message could not be saved as written.');
    expect(shown).not.toMatch(/constraint|body_len/);
  });

  it('shows the messages this module wrote FOR her', () => {
    expect(writeFailureMessage(new ChannelInputError('Keep it under 2000 characters.')))
      .toBe('Keep it under 2000 characters.');
  });

  it('recognises her message the FIRST time, not only after one has been thrown', () => {
    // The first version kept a Set filled in at throw time, so whether her own
    // error was shown or swallowed depended on what had happened earlier in
    // the session. A marker class has no such order dependence.
    expect(new ChannelInputError('x')).toBeInstanceOf(ChannelInputError);
    expect(writeFailureMessage(new ChannelInputError('Nothing to send.'))).toBe('Nothing to send.');
  });

  it('falls back to something true for anything unrecognised', () => {
    expect(writeFailureMessage(new Error('kaboom'))).toBe('That did not send. Try again.');
    expect(writeFailureMessage(null)).toBe('That did not send. Try again.');
    expect(writeFailureMessage(undefined)).toBe('That did not send. Try again.');
  });
});
