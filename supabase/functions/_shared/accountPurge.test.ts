// Tests for _shared/accountPurge.ts (G-16: erase accounts 30 days after deletion).
//   deno test --no-check --allow-env _shared/accountPurge.test.ts

import { FILE_BATCH, groupByBucket, MAX_BATCHES, runAccountPurge, type StorageObject } from './accountPurge.ts';

function eq(actual: unknown, expected: unknown, label = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}\n  expected ${e}\n  received ${a}`);
}

function world(files: StorageObject[], opts: { refuse?: string } = {}) {
  const store = [...files];
  const calls: string[] = [];
  return {
    calls,
    store,
    deps: {
      purgeAccounts: async () => { calls.push('purge'); return { deleted: 2 }; },
      listFiles: async (limit: number) => { calls.push(`list:${limit}`); return store.slice(0, limit); },
      removeFiles: async (bucket: string, names: string[]) => {
        calls.push(`remove:${bucket}:${names.length}`);
        if (bucket === opts.refuse) return 0;
        let n = 0;
        for (const name of names) {
          const i = store.findIndex((f) => f.bucket_id === bucket && f.name === name);
          if (i >= 0) { store.splice(i, 1); n++; }
        }
        return n;
      },
      markCleared: async () => { calls.push('mark'); return 2; },
    },
  };
}

Deno.test('erases the accounts first, then their files bucket by bucket, then closes the purges', async () => {
  const w = world([
    { bucket_id: 'avatars', name: 'u1/a.jpg' },
    { bucket_id: 'post-media', name: 'u1/p.jpg' },
    { bucket_id: 'avatars', name: 'u2/b.jpg' },
  ]);
  const s = await runAccountPurge(w.deps);
  eq(w.calls, ['purge', `list:${FILE_BATCH}`, 'remove:avatars:2', 'remove:post-media:1', `list:${FILE_BATCH}`, 'mark']);
  eq(s, { accounts: { deleted: 2 }, filesRemoved: 3, batches: 1, purgesClosed: 2, stalled: false });
  eq(w.store.length, 0);
});

Deno.test('nothing to remove: still closes purges whose files were already gone', async () => {
  const w = world([]);
  const s = await runAccountPurge(w.deps);
  eq(w.calls, ['purge', `list:${FILE_BATCH}`, 'mark']);
  eq(s.filesRemoved, 0);
  eq(s.stalled, false);
});

Deno.test('a bucket that refuses every delete stops the loop instead of spinning', async () => {
  const w = world([{ bucket_id: 'locked', name: 'u1/x' }], { refuse: 'locked' });
  const s = await runAccountPurge(w.deps);
  eq(s.stalled, true);
  eq(s.batches, 1);
  eq(w.calls.filter((c) => c.startsWith('list')).length, 1);
});

Deno.test('a huge backlog is cut at MAX_BATCHES per run; the next run continues', async () => {
  const many = Array.from({ length: FILE_BATCH * (MAX_BATCHES + 3) }, (_, i) => ({ bucket_id: 'avatars', name: `u/${i}` }));
  const w = world(many);
  const s = await runAccountPurge(w.deps);
  eq(s.batches, MAX_BATCHES);
  eq(s.filesRemoved, FILE_BATCH * MAX_BATCHES);
  eq(w.store.length, FILE_BATCH * 3);
});

Deno.test('groupByBucket ignores rows without a bucket or a name', () => {
  eq([...groupByBucket([
    { bucket_id: 'a', name: '1' }, { bucket_id: '', name: '2' }, { bucket_id: 'a', name: '' }, { bucket_id: 'b', name: '3' },
  ])], [['a', ['1']], ['b', ['3']]]);
});
