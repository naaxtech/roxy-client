# Clear notifications, keep them in an archive — plan

Owner, 2026-10-26: "Notifications should be archived when cleared, user should be able to clear notifications."
Line it moves: retained revenue. An inbox that can't be emptied fills with noise, and members stop opening it.
Branch `slice/roxy/notifications-clear` (worktree `roxy-client-worktrees/w3-e`), off `main` 5f7e839.

## Decisions (reversible; stated, not asked)

- **Clearing archives, never deletes.** It sets `notifications.archived_at = now()` and also `read_at`, so
  badges drop. The row is kept: data is never deleted here, and the duplicate checks that read past rows
  (post reaction 136:169, follow 133:629) keep working, so a cleared notification doesn't fire again.
- **Two ways to clear:** a visible clear (×) button on each row (44 dp, label "Clear notification"), and a
  "Clear all" header action next to "Mark all read". Each clear shows a snackbar "Cleared" with **Undo**,
  which sets `archived_at` back to null. There is no swipeable-row primitive in the app, and web must behave
  like the installed app, so this uses a visible button rather than a swipe.
- **Archived view:** a "View archived" link at the foot of the list (and in the empty state once she has
  cleared something) opens the same screen in archived mode (`/notifications?view=archived`, header
  "Archived"). Rows can be opened by tapping and restored with "Restore". Archived rows are never counted
  in a badge.
- Server-side writers stay as they are. The trigger DELETEs on unlike, unfollow, cancelled requests and
  deleted comments also remove archived rows; those are retractions, not her archive.

## Slice

1. **Migration `137_notification_archive.sql`** + `supabase/downs/137_notification_archive_down.sql` +
   `supabase/tests/137_notification_archive_check.sql`:
   - `ALTER TABLE public.notifications ADD COLUMN archived_at timestamptz` (nullable, no default).
   - `CHECK (archived_at IS NULL OR archived_at >= created_at)`.
   - Replace the inbox index with `(user_id, created_at DESC) WHERE archived_at IS NULL`, plus
     `(user_id, archived_at DESC) WHERE archived_at IS NOT NULL` for the archived view. Keep the unread
     partial index, and add `AND archived_at IS NULL` to it.
   - Column grant: `GRANT UPDATE (read_at, archived_at)`. Do not widen anything else. The existing UPDATE
     policy (own rows, `TO authenticated`) already limits writes to her own rows.
   - The check file proves:
     - she can archive and unarchive her own row;
     - she can NOT archive another member's row (re-read it: zero rows changed, value unchanged);
     - she can NOT write `title`, `body` or `user_id`;
     - anon has nothing;
     - the CHECK rejects `archived_at < created_at`;
     - the down file restores the 057/131 grants and indexes exactly.
   - `node scripts/check-migrations.mjs` must be green.
2. **Push:** `supabase/functions/_shared/pushDispatch.ts` skips a row whose `archived_at` is set, the same
   way it skips read rows (`:125`). Add a Deno test beside the existing ones.
3. **Client data layer** `apps/mobile/lib/notifications.ts`:
   - `fetchNotifications` filters `archived_at IS NULL`.
   - New `fetchArchivedNotifications()`: ordered by `archived_at` desc, limit 50.
   - **Revised after review (2026-10-26):** clearing goes through two single-statement RPCs in 137,
     `archive_notifications(p_ids | p_up_to)` → `(id, was_unread)` rows (≤ 500 per call) and
     `unarchive_notifications(p_ids, p_mark_unread)` → count. The client wraps them as
     `clearNotifications`, `clearNotificationsUpTo` (looping in batches of 500, capped at 40 calls) and
     `restoreNotifications` (batches of 500). The first two-write design (`archiveNotification` and
     friends) lost the unread state, treated "nothing to clear" as a failure, and broke Undo above 500
     rows. It never shipped and was removed.
   - `fetchUnreadNotificationCount` also filters `archived_at IS NULL`.
   - Only an RPC `error` is a failure. Zero rows means "nothing left" or "already gone", never Retry.
     A short restore count is reported. Never toast a write that wasn't checked.
4. **Screen** `apps/mobile/app/notifications.tsx`:
   - Per-row clear button.
   - "Clear all" header action, shown when the list is non-empty.
   - Optimistic removal with rollback, plus the snackbar with Undo (`snackbar.show({ actionLabel: 'Undo' })`).
   - Archived mode via `view=archived`, with Restore per row.
   - Add an **error state with Retry**. Today a failed fetch shows as empty: give `fetchNotifications`
     an error-reporting variant, and keep the old signature for existing callers.
   - Add testIDs: `notifications-list`, `notification-row-<id>`, `notification-clear-<id>`,
     `notifications-clear-all`, `notifications-view-archived`, `notification-restore-<id>`.
   - Strings are localisable the way the screen's existing strings are.
   - Light theme tokens only (`lib/theme.ts`).
5. **Badges:** the Discover and You bells read `fetchUnreadNotificationCount` on mount only. Re-read it
   when the screen regains focus (`useFocusEffect`), so clearing on the notifications screen updates the
   bell on the way back.
6. **Tests (RED first, watched failing):**
   - jest for every lib function, including the filter, the zero-row-update → false case and the error path;
   - a screen test for clear, clear all, Undo, rollback on a failed write, archived mode with Restore, and the error + Retry state;
   - the bell re-reads on focus;
   - the Deno push-skip test;
   - the SQL check file.

## Gate

`npx jest --ci` (all suites), `npx tsc --noEmit`, eslint on the changed files, `node scripts/check-migrations.mjs`,
`deno check` / `deno test` for the touched function, and a local migration proof (Docker DB:
apply → check → down → re-apply). After that: a read-only browser run on a local export.

## Owner-gated (not done by the slice)

Applying 137 to prod (`scripts/apply-migration.mjs 137_... --prod`), deploying the `push-dispatch` edge function,
`host:deploy` to roxy.expo.app, and the EAS build. The client must ship **after** the migration: a client that
filters on `archived_at` against a prod table without the column gets a PostgREST 400 and shows the error
state on every load.
