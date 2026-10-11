# Roxy production launch runbook

Ordered steps to take production from "testers" to "first invite cohort".
Owner: Nicole (CTO). Each step says **who** runs it, **what** proves it worked,
and **how to undo** it. Stop at the first step whose proof fails.

Production project: one Supabase project ("Roxy Demo", ref in the repo-root
`.env` as `SUPABASE_PROJECT_REF`). As of this runbook prod has migrations up to
**128** applied (`select max(version) from supabase_migrations.schema_migrations`),
**no pg_cron, no pg_net, and no `roxy_%` Vault secrets**.

> Hard rules: one migration at a time, in order, only through
> `scripts/apply-migration.mjs` (it lints, demands the local proof, backs up and
> records history). Never paste migration SQL into the SQL editor. Never type a
> key into a file you save or into chat. The two setup scripts in step 6 are the
> only SQL you run by hand.

---

## 0. Before anything: plan, backup, freeze

1. **Upgrade the project to Supabase Pro before the first cohort.** Free caps
   Realtime at **200 concurrent connections** (Pro: 500; Pro with the spend cap
   off: 10,000). Every open app holds a Realtime socket for chat, typing and the
   bell, so ~200 women online at once is the ceiling on Free, and connection
   201 is refused. Pro also brings daily backups, no auto-pause on idle, and
   the leaked-password check in step 7.
   Source: supabase.com/docs/guides/realtime/limits ("Concurrent connections").
   - Pro (spend cap ON) is fine for the first cohort. Turn the spend cap off, or
     ask support for a higher limit, before you pass ~400 concurrent.
2. **Check the project is awake** (a Free project pauses when idle):
   `node <skill>/scripts/supabase-readonly-sql.mjs projects` → `ACTIVE_HEALTHY`.
3. **Logical backup** (outside the repo; contains member data):
   ```bash
   node scripts/backup-prod.mjs           # -> D:/Work/Development/JoNicole/_backups/roxy/<ts>/
   ```
   Proof: `manifest.json` lists every public table with row counts.
   `apply-migration.mjs --prod` takes another backup before each migration.
4. **Freeze**: no deploys from other branches while this runbook runs.

## 1. Merge the launch lanes and record the local proof

On the integration branch (never `main`), with launch/gate, launch/ops,
launch/chat and launch/feed merged:

```bash
node scripts/check-migrations.mjs          # 0 error(s)
bash scripts/db-verify.sh                  # applies every migration from zero on a DISPOSABLE local Postgres,
                                           # runs every supabase/tests/*.sql, then records the "local proof"
                                           # (supabase/.temp/verified-migrations.json via scripts/record-local-proof.mjs)
```

`apply-migration.mjs` refuses any migration whose sha is not in that ledger,
so re-run `db-verify.sh` after any edit to a migration.

> **Known cross-lane blocker (found by the ops order proof):** with 129, 132 and
> 133 applied together, 133's check fails at `T2b author cannot see her own
> processing video`. It passes with 129+133, 129+130+133 and 129+131+133, and
> fails with just 129+132+133, so it is the chat (132) × feed (133)
> interaction, not 130/131. Chat and feed
> must fix it, and `db-verify.sh` must be green, before step 2.

## 2. Migrations 129 → 133, one at a time, in this order

Run each command, read its output, check its proof, then go to the next. Set
`ROXY_CONFIRM_REF=<ref>` for a non-interactive run (or type the ref at the prompt).

| # | File | Lane | What it does | Proof after apply |
|---|------|------|--------------|-------------------|
| 129 | `129_push_notifications.sql` | push | push_outbox, notification_settings, claim/wake functions | `select to_regclass('public.push_outbox')` not null |
| 130 | `130_gate_airtight.sql` | gate | invite gate closed end to end (applications, codes, reviewer, purge) | `to_regclass('public.application_decisions')` not null |
| 131 | `131_ops_launch_hardening.sql` | ops | anon locked out of RPCs/tables, money/trust column grants, suspension, reports queue, audit log, cron helpers, bucket limits | see the 131 checks below |
| 132 | `132_private_groups_and_requests.sql` | chat | private groups, request-first DMs, chat write-path lockdown | `to_regclass('public.conversation_members')` not null |
| 133 | `133_feed_archive_profile_launch.sql` | feed | hide persists, gap-free paging, Archive safety, creator-loop notifications | `to_regclass('public.archive_shelf')` not null |
| 134 | *(none yet)* | — | no lane has produced a 134; if one lands, it goes last and follows the same rule | — |

```bash
node scripts/apply-migration.mjs 129_push_notifications.sql --prod
node scripts/apply-migration.mjs 130_gate_airtight.sql --prod
node scripts/apply-migration.mjs 131_ops_launch_hardening.sql --prod
node scripts/apply-migration.mjs 132_private_groups_and_requests.sql --prod
node scripts/apply-migration.mjs 133_feed_archive_profile_launch.sql --prod
```

Why this order: 133 alters `notification_settings` (from 129); 130's purge is
what 131's cron schedule calls; 131 must precede `setup-cron.sql`. The ops
order proof applied 129→133 in this order on a local copy of the schema, ran
129/130/131/132's checks green, then ran every down in reverse (133→129) with
nothing left behind.

**131 checks on prod** (read-only, via the helper):
```sql
select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
  and has_function_privilege('anon', p.oid, 'EXECUTE');                 -- 0
select count(*) from pg_policies where schemaname in ('public','storage')
  and 'public' = any(roles)
  and tablename not in ('communities','community_members','friendships'); -- 0
select id, file_size_limit, allowed_mime_types from storage.buckets;      -- every bucket limited
select to_regprocedure('public.ops_invoke_edge(text,jsonb)');            -- not null
```
If 131 logged `WARNING 131: could not move storage policy ...` (the hosted
`postgres` role cannot alter a `storage.objects` policy), run that one line in
the SQL editor as shown in the warning: `ALTER POLICY <name> ON storage.objects TO authenticated;`.

## 3. Edge function secrets (names only; values are typed by Nicole)

Set with `npx supabase secrets set NAME=...` from a terminal Nicole controls, or
in Dashboard › Edge Functions › Secrets. Never commit or paste them in chat.

| Secret | Used by | On prod now? |
|--------|---------|:---:|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` | all (platform-provided) | yes |
| `STRIPE_SECRET_KEY` | 12 Stripe functions | yes |
| `STRIPE_WEBHOOK_SECRET` | stripe-webhooks | yes |
| `STRIPE_PRODUCT_WEBHOOK_SECRET` | stripe-product-webhook | yes |
| `STRIPE_PUBLISHABLE_KEY` | create-payment-intent | **no** — add before paid events |
| `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` | process-email-queue, resend-webhook | yes |
| `DAILY_API_KEY` | rooms / speed dates | yes |
| `DAILY_WEBHOOK_SECRET` | daily-webhook — the **base64 `hmac`** you pass when creating the Daily webhook (step 5) | **no** |
| `CLOUDFLARE_WEBHOOK_SECRET` | cloudflare-video-webhook — the Stream webhook signing secret | **no** |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_STREAM_API_TOKEN`, `CF_CUSTOMER_SUBDOMAIN` | get-video-upload-url, cloudflare-video-webhook | **no** — video upload is off until set |
| `CODE_HASH_SALT` | validate-invite-code | yes |
| `ANTHROPIC_API_KEY`, `ROXY_AI_ENABLED` | Roxy wingwoman / Sister functions | key yes; flag **no** (off by default) |
| `EXPO_ACCESS_TOKEN` | push-dispatch (only if Expo "enhanced push security" is on) | no (optional) |
| `STUDIO_URL` | Stripe return URLs | yes |
| `DIDIT_API_KEY`, `DIDIT_WEBHOOK_SECRET`, `DIDIT_WORKFLOW_ID`, `KYC_REDIRECT_URL` | kyc-create-session, kyc-webhook | **no** — KYC is off until set |

Proof: `node <skill>/scripts/supabase-readonly-sql.mjs secrets` lists the names.

## 4. Deploy edge functions

From the repo root, after the full gate set passes on the committed tree
(`deno check --node-modules-dir=auto */index.ts` = 0 errors, `deno test` green):

```bash
npx supabase functions deploy --project-ref <ref>     # all functions; config.toml carries verify_jwt
```

`supabase/config.toml` sets `verify_jwt = false` ONLY for callers that cannot
hold a member's JWT, and each of those verifies its own signature or the
service key:

| Function | verify_jwt | Authenticates by |
|----------|:---:|------------------|
| stripe-webhooks, stripe-product-webhook | false | `Stripe-Signature` via `constructEventAsync` |
| resend-webhook | false | Svix `svix-signature` |
| daily-webhook | false | `X-Webhook-Signature` = base64 HMAC-SHA256(base64-decoded secret, `ts.body`) |
| cloudflare-video-webhook | false | `Webhook-Signature: time=..,sig1=..` (5-min replay window) |
| kyc-webhook | false | vendor HMAC (`_shared/kyc.ts`) |
| validate-invite-code | false | pre-account; rate-limited on salted IP hash |
| push-dispatch, process-email-queue, auto-complete-events, process-refunds, release-payout, reconcile-orders | false | exact `Bearer <service key>`, constant time (`_shared/serviceAuth.ts`) |
| request-invite-code, livekit-token | false | retired: return **410** and do nothing (old builds may call them) |
| everything else | **true** | member JWT at the gateway + `verifyJWT` in the handler |

Proof (no secrets needed):
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://<ref>.supabase.co/functions/v1/livekit-token          # 410
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://<ref>.supabase.co/functions/v1/release-payout         # 403 (no key)
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://<ref>.supabase.co/functions/v1/daily-webhook -d '{}'  # 401 (no signature)
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://<ref>.supabase.co/functions/v1/stripe-webhooks -d '{}' # 400 (no Stripe-Signature), not 401
```

## 5. Provider webhooks (dashboards)

- **Stripe** (Dashboard › Developers › Webhooks): endpoint
  `https://<ref>.supabase.co/functions/v1/stripe-webhooks` (platform) and
  `.../stripe-product-webhook` (Connect, "listen to events on connected
  accounts"). Add `transfer.reversed` to the product endpoint's events (the old
  `transfer.failed` no longer exists). Copy each signing secret into the
  matching secret in step 3. Then "Send test event" → 200.
- **Daily**: generate a secret (`openssl rand -base64 32`), set it as
  `DAILY_WEBHOOK_SECRET` FIRST, then create the webhook passing that value as
  `hmac` (`POST https://api.daily.co/v1/webhooks` with `url` = `.../daily-webhook`,
  `hmac` = the same base64 string, `eventTypes` = `participant.joined`,
  `participant.left`). Daily sends a signed `{"test":"test"}` and must get a 200
  within 8 s, so the secret has to be in place before you create it.
- **Cloudflare Stream**: `PUT accounts/<id>/stream/webhook` with
  `notificationUrl` = `.../cloudflare-video-webhook`; copy the returned `secret`
  into `CLOUDFLARE_WEBHOOK_SECRET`.
- **Resend** (Webhooks): endpoint `.../resend-webhook`; signing secret →
  `RESEND_WEBHOOK_SECRET`.

## 6. Turn on push and the scheduler (human-run SQL, SQL editor)

1. `scripts/setup-push.sql` — fill `v_ref` and `v_key` (service_role key from
   Dashboard › Project Settings › API keys) **in the editor only**, run, and
   close the tab without saving. Stores `roxy_push_dispatch_url` and
   `roxy_service_role_key` in Vault and schedules `roxy-push-dispatch`.
2. `scripts/setup-cron.sql` — fill only `v_ref`, run. It refuses to run before
   131 or without `roxy_service_role_key`. It enables pg_cron/pg_net, stores
   `roxy_functions_url`, and (unschedule-if-exists, then schedule):

   | Job | Schedule (UTC) | Runs |
   |-----|----------------|------|
   | roxy-email-queue | every minute | process-email-queue |
   | roxy-push-dispatch | every minute | push-dispatch sweep (same name as setup-push, never doubled) |
   | roxy-stale-rooms | every 10 min | `ops_cleanup_stale_rooms()` |
   | roxy-auto-complete-events | hourly :07 | auto-complete-events |
   | roxy-applicant-purge | daily 03:17 | `purge_expired_applicant_data()` via `ops_call_if_exists` |
   | roxy-account-purge | daily 03:27 | `purge_deleted_accounts()` via `ops_call_if_exists` (skipped quietly until it exists) |
   | roxy-cron-history-trim | daily 03:37 | keep 7 days of `cron.job_run_details` |

   Money jobs (refunds every 15 min, payouts daily, reconcile daily) are in the
   file but commented out: turn them on when paid events go live.

Vault secret names (values never shown): `roxy_functions_url`,
`roxy_push_dispatch_url`, `roxy_service_role_key`.

Proof, 5 minutes later:
```sql
select jobname, status, return_message, start_time
from cron.job_run_details d join cron.job j using (jobid)
where j.jobname like 'roxy-%' order by start_time desc limit 20;      -- all 'succeeded'
select status_code, count(*) from net._http_response
where created > now() - interval '10 minutes' group by 1;            -- 200s, no 401/403
```
A 401/403 here means the Vault key does not match `SUPABASE_SERVICE_ROLE_KEY`
(re-run setup-push.sql with the right key).

## 7. Auth dashboard settings (Dashboard › Authentication)

| Setting | Value | Why |
|---------|-------|-----|
| Bot and abuse protection › CAPTCHA | **Cloudflare Turnstile**, site + secret key | stops scripted sign-ups/code guessing. Needs the app to send `captchaToken` on `signUp`/`signInWithPassword`/`resetPasswordForEmail` (cross-lane: gate owns the (auth) screens). Do not turn on until that ships, or every sign-in fails. |
| Email › Confirm email | **ON** | an invite gate on an unverified address is not a gate |
| SMTP | **Custom SMTP via Resend** (`smtp.resend.com`, port 465, user `resend`, password = a Resend API key, sender on the verified roxyhq.com domain) | built-in SMTP is rate-limited to a handful per hour and is not for production |
| Password › Minimum length | **10** | the app currently checks only `< 6` (`(auth)/welcome.tsx:53`, `reset-password.tsx:30`); gate lane must raise both to 10 in the same release, or members see a server error instead of a friendly message |
| Password › Leaked password protection | **ON** (Pro) | rejects passwords in HaveIBeenPwned |
| Sessions › JWT expiry | 3600 s (default) | a suspended member's live token dies within the hour; `suspend_member` already revokes her sessions/refresh tokens |
| URL configuration | Site URL + redirect allow-list for the app scheme and roxy.expo.app only | no open redirects |

## 8. Smoke test, then open the gate

1. Run the read-only Playwright set against roxy.expo.app (roxy-platform skill,
   "Release & browser QA").
2. As a seed account: sign in, post, react, open Messages, join a room (Daily
   join → participant_count +1 within seconds = daily-webhook verified).
3. Studio as staff: reports queue loads, member search, suspend + unsuspend a
   seed account (audit_log gets two rows).
4. Mint the first wave of invite codes in Studio with a wave label; watch
   `staff_launch_funnel()` on the staff dashboard.

---

## Rollback

Rollback is per migration, newest first, and only as far back as needed. Each
down lives in `supabase/downs/<n>_<name>_down.sql`, restores the previous state
and **keeps member data** (it drops only what that migration created). Take a
backup first (`node scripts/backup-prod.mjs`).

Run a down through the CLI against the linked project (it is SQL that changes
prod, so never by hand-pasting if the CLI works):

```bash
npx supabase db query --linked --file supabase/downs/<n>_<name>_down.sql
```

then remove that version's history row so the CLI history matches
(`delete from supabase_migrations.schema_migrations where version = '<n>';`,
same command with `--file` on a one-line file), and re-check with the
"Production database" query in the roxy-platform skill.

| Undo | File | Notes |
|------|------|-------|
| 133 | `supabase/downs/133_feed_archive_profile_launch_down.sql` | feed lane |
| 132 | `supabase/downs/132_private_groups_and_requests_down.sql` | chat lane; keeps messages |
| 131 | `supabase/downs/131_ops_launch_hardening_down.sql` | restores every pre-131 grant from the snapshot table 131 took (`ops_acl_snapshot_131`; refuses to run if it is missing), the original policies, function bodies, CHECKs (as NOT VALID so new audit rows survive) and bucket settings; lifts any auth ban 131's suspensions set; keeps audit rows and reports (`actioned` maps back to `reviewed`). Proven: applying 131 then this down leaves grants (every grantee, incl. service_role), policies, default ACLs, functions, constraints, columns, triggers, indexes and buckets **identical** to before. **Unschedule cron first** (below): the jobs call functions this down drops. |
| 130 | `supabase/downs/130_gate_airtight_down.sql` | gate lane |
| 129 | `supabase/downs/129_push_notifications_down.sql` | bottom of the file also undoes setup-push.sql |

Undo the human-run setup (before downing 131 or 129):
```sql
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname LIKE 'roxy-%';
DELETE FROM vault.secrets WHERE name IN ('roxy_functions_url', 'roxy_push_dispatch_url', 'roxy_service_role_key');
```

Edge functions: redeploy the previous commit's functions
(`git checkout <prev> -- supabase/functions && npx supabase functions deploy`
from a scratch worktree, never on main). Auth settings: flip back in the
dashboard (CAPTCHA off first if sign-ins fail).
