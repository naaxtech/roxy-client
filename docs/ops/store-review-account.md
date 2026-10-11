# Store review account (G-22)

Apple and Google reviewers must be able to get past the gate, or the build is
rejected under App Store Guideline 2.1 ("unable to sign in") or lands the
reviewer on an empty "your application is in review" screen.

Roxy is invite-only, so the reviewer gets a seed account that goes through the
same gate as everyone else: a single-use **review code**, an application, and
a staff approval in Studio. Nothing about it bypasses review (Nicole,
2026-10-11: minting never approves anyone).

**Never put the password in this repo, a commit, a ticket or chat.** It lives
in the team password manager and is pasted only into App Store Connect / Play
Console.

## Before you start

- Migration 134 is applied to production (it adds `mint_review_code` and makes
  every code single use). Check: `select max(version) from supabase_migrations.schema_migrations;` ≥ 134.
- You are **core** staff in Studio (`staff_role = 'core'`), approved and not
  suspended. Only core can mint a review code.
- The `roxy-official` community exists (review codes join it).
- Pick the account email: `appstore-review@seed.roxy.app` (Apple) and
  `play-review@seed.roxy.app` (Google). The `@seed.roxy.app` domain is reserved
  for test accounts: our e2e safety rules aim test writes only at it, and
  analytics can filter it out.

## 1. Mint one review code per store

Studio → **Invite codes** → **Store review code** (visible to core staff only).
Label it per store and cycle, e.g. `App Store review 2026-10` and
`Play review 2026-10`, and press **Create store review code** once per store.
The code is shown once; copy it into the password-manager entry for that
store's reviewer account. It expires in 30 days.

(Same thing without Studio, signed in as core: `select public.mint_review_code('App Store review 2026-10', 30);`.
It refuses anyone who is not core.)

The code is single use. It shows in Studio → **Invite codes** with kind
"Store review", your name as the minter, and, once used, the reviewer
account's name, when it was used, its membership status and its last sign-in.

## 2. Create the seed account and send it for review

On a phone or at roxy.expo.app:

1. Enter the review code on the gate.
2. Sign up with the reviewer email and a strong password (at least 10
   characters; generate it in the password manager and save it there).
3. Fill the application with plain, honest test answers ("App Store review
   account, operated by the Roxy team").
4. She lands on "your application is in review". That is expected: the code
   did not approve anything.

## 3. Approve it in Studio

1. Studio → **Applications**. The review application appears in the queue
   like any other (it was sent to `roxy-official`).
2. Open it, check it is the seed email you just created, and **Approve**.
   The decision is recorded in `application_decisions` with your name, like
   every other decision.
3. The account now opens the app as an approved member. Sign in once on a
   real device to confirm: feed loads, a community opens, messages open.

## 4. Hand the credentials to the store

- App Store Connect → App Review Information → Sign-in required: the reviewer
  email + password from the password manager. In **Notes**, write:
  "Roxy is an invite-only community. This account is already approved; no
  code is needed to sign in."
- Play Console → App content → App access: the same, for the Play account.

## 5. After approval

- Leave the account approved while the build is in review and for the next
  update cycle; reviewers re-check updates with the same account.
- If the password was ever shared outside the password manager, rotate it.
- An unused review code expires by itself; revoke it early from Studio →
  Invite codes if a cycle ends before it is used.
- Launch check (G-22): `select count(*) from invite_codes where is_review_code and revoked_at is null and redeemed_by is not null;` ≥ 1 per store.

## Captcha

If Supabase **Captcha protection** is ever switched on, the reviewer signs in
on the native app, which sends no captcha token today (`apps/mobile/lib/captcha.ts`).
Keep captcha OFF in Supabase Auth until the native widget ships, or the
reviewer (and every phone) is locked out.
