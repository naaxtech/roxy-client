// The 30-day account erase (G-16), minus I/O, so it is unit-tested.
//
// 1. purge_deleted_accounts() (migration 134) hard-deletes every account whose
//    profile was deleted more than 30 days ago and records its id in
//    account_purges. The database cannot delete Storage files itself (Supabase
//    blocks direct DELETEs on storage.objects), so:
// 2. account_purge_storage_batch() lists her files; they are removed through
//    the Storage API, bucket by bucket, until nothing is left or a batch makes
//    no progress (a file the API refuses must not loop forever);
// 3. mark_account_storage_cleared() closes every purge whose files are gone.

export type StorageObject = { bucket_id: string; name: string };

export interface AccountPurgeDeps {
  purgeAccounts(): Promise<Record<string, unknown>>;
  listFiles(limit: number): Promise<StorageObject[]>;
  /** Remove these files from one bucket. Returns how many were removed. */
  removeFiles(bucket: string, names: string[]): Promise<number>;
  markCleared(): Promise<number>;
}

export type AccountPurgeSummary = {
  accounts: Record<string, unknown>;
  filesRemoved: number;
  batches: number;
  purgesClosed: number;
  stalled: boolean;
};

export const FILE_BATCH = 500;
export const MAX_BATCHES = 20;

export function groupByBucket(files: StorageObject[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const f of files) {
    if (!f.bucket_id || !f.name) continue;
    const list = out.get(f.bucket_id) ?? [];
    list.push(f.name);
    out.set(f.bucket_id, list);
  }
  return out;
}

export async function runAccountPurge(deps: AccountPurgeDeps): Promise<AccountPurgeSummary> {
  const accounts = await deps.purgeAccounts();
  let filesRemoved = 0;
  let batches = 0;
  let stalled = false;

  while (batches < MAX_BATCHES) {
    const files = await deps.listFiles(FILE_BATCH);
    if (files.length === 0) break;
    batches++;
    let removedThisBatch = 0;
    for (const [bucket, names] of groupByBucket(files)) {
      removedThisBatch += await deps.removeFiles(bucket, names);
    }
    filesRemoved += removedThisBatch;
    if (removedThisBatch === 0) {
      stalled = true;
      break;
    }
  }

  const purgesClosed = await deps.markCleared();
  return { accounts, filesRemoved, batches, purgesClosed, stalled };
}
