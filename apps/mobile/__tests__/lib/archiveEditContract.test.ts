import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The client and the deployed function have to agree on the payload key.
 *
 * They did not. `submitEdit` sent `{ entry_id, patch }`; `archive-submit-edit`
 * reads `body.fields` and 400s on anything else — so every "Suggest an edit"
 * in the app failed, and what she saw was the developer string "fields must be
 * an object of proposed changes". The Archive's member-maintained promise had
 * never once worked.
 *
 * Same shape of guard as reportContentTypes.test.ts: read both sides off disk,
 * fail when they drift. A comment asking a future session to keep them in step
 * is not a mechanism.
 */

const REPO = join(__dirname, '..', '..', '..', '..');

const fn = readFileSync(
  join(REPO, 'supabase', 'functions', 'archive-submit-edit', 'index.ts'),
  'utf8'
);
const client = readFileSync(
  join(__dirname, '..', '..', 'components', 'archive', 'composerActions.ts'),
  'utf8'
);

describe('archive-submit-edit payload contract', () => {
  it('the function reads the key the client sends', () => {
    // Asserted as a pair rather than parsed: rename the key on either side and
    // one of these two lines stops being true.
    expect(fn).toContain('body.fields');
    expect(client).toMatch(/fields:\s*patch/);
  });

  it('the client does not still send the old key', () => {
    expect(client).not.toMatch(/patch\s*\}\s*\)/);
  });

  it('both sides agree on the entry identifier', () => {
    expect(fn).toContain('entry_id');
    expect(client).toContain('entry_id: entryId');
  });
});
