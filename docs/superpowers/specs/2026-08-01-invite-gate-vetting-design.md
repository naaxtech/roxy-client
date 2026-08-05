# Roxy — Invite Gate, Vetting & Border Patrol

**Date:** 2026-08-01
**Status:** Approved shape, pending implementation
**Slices:** C (this doc) · A + B tracked separately in `2026-08-01-dual-feed-community-brand-design.md`

---

## 1. What this is

Roxy becomes invite-only. You cannot create an account without a code issued by a
community. Every applicant is reviewed by a human before they get in. Every member is
permanently attributable to the code that admitted them.

This is not a growth feature. It is the product's core claim — *everyone here was vouched
for by someone* — and that claim is only true if the gate is enforced in the database
rather than the client.

### Decisions taken (do not relitigate)

| Decision | Choice | Rationale |
|---|---|---|
| Reach of community announcements | Everyone, ranked, **1 post per community per day** | Cold-start fix + anti-spam as a DB constraint, not a policy |
| Who reviews | Own-code applicants, **plus opt-in overflow** | Small blast radius by default; nothing rots in a queue |
| Auto-approval | **Never.** Always human | The score triages; it never decides. This is the value proposition |
| Existing users | **Grandfathered as `unvetted`** | Nobody loses access to an app they already use |
| Code issuers | **Communities only** | No Roxy issuer type. Staff bootstrap is an operation, not a feature |
| KYC vendor | **Didit**, hosted flow, behind an adapter | See §6 |

---

## 2. Why the KYC vendor choice went the way it did

Because review is always human, the vendor does **not** need a manual-review ops team —
that is what Sumsub's $1.35–$1.85/check and Didit's Enterprise tier are selling. We need a
cheap automated signal with a hosted UI and webhook delivery. It is one input to the score.

| Vendor | Free tier | Per check | Monthly minimum | Self-serve |
|---|---|---|---|---|
| **Didit** | **500/mo forever** | $0.33 full bundle | none | yes |
| Veriff | none | ~$0.80 | — | yes |
| Sumsub | none | $1.35 | **$149** ($299 Conformity) | partly |
| Persona | none | $1–2 | custom | sales call |

Didit's free bundle is ID verification + passive liveness + face match + device/IP
analysis, and includes duplicate detection and blocklisting — both of which this design
uses (§7, G3). Failed verifications cost $0, so fraud attempts are free.

**Rejected: Stripe Identity.** Supported business locations are 34 countries and **PH is
not among them**. Roxy bills under Naaxtech Corp (PH). Being on Stripe Connect is irrelevant.

**Rejected: Didit's native SDK.** `@didit-protocol/sdk-react-native` v3.x requires **RN
0.76+ with the New Architecture**; Roxy is on **Expo 51 / RN 0.74**. We use the **hosted
web flow** instead — which is better anyway, because it structurally guarantees the ID
image and face scan never reach our infrastructure.

### Open vendor items — block launch, not build

1. **DPA — now enforced in code, not trusted to memory** (migration 074).
   A Data Processing Agreement is mandatory under GDPR Art. 28(3). Didit lists its DPA
   under Enterprise, and whether a standard one covers the free tier is unconfirmed.

   `processor_agreements` is seeded with `dpa_signed_at = NULL`, and **identity
   verification is switched off until that row is filled in**. Three layers, because a
   comment cannot stop code from running:
   - `kyc-create-session` refuses *before* calling the vendor — the call itself is the
     disclosure, so refusing afterwards would change nothing.
   - A `BEFORE INSERT` trigger on `identity_verifications` raises if the processor is not
     cleared, even if a future write path forgets to ask.
   - The applicant sees "identity checks are paused"; her other criteria still score.

   **Filling in `dpa_signed_at` is a legal act, not a deployment step.** Do it only when a
   signed agreement genuinely exists:
   ```sql
   UPDATE processor_agreements
   SET dpa_signed_at = '<date>', dpa_reference = '<ref>', transfer_mechanism = 'scc'
   WHERE processor = 'didit';
   ```
   Also record `transfer_mechanism` — Didit is EU-based, but if any sub-processor moves
   data outside the EEA/UK, Art. 46 needs SCCs in place.
2. **Is `X-Timestamp` bound into the webhook HMAC?** Didit documents signing the raw JSON
   body. If the timestamp is *not* part of the signed input, the freshness check is
   worthless — a replayed callback can carry a rewritten header and still validate. We
   therefore treat **data-layer idempotency as the primary replay control**
   (`kyc-webhook/index.ts`: a session that has reached a terminal state cannot be moved,
   and a late `approved` can never overwrite a `declined`). If Didit confirms the timestamp
   is signed, change the HMAC input to `${timestamp}.${rawBody}`. **Do not change it on
   assumption** — signing the wrong string fails every webhook and strands every applicant
   at "verification pending" with no error the applicant can see.
3. **Exact response field names.** The reference pages do not render for automated fetching.
   The adapter matches known aliases and throws with the observed keys rather than writing a
   null session id. The first sandbox call resolves this.

---

## 3. Data protection posture

Roxy already holds sexual-orientation data: **GDPR Art. 9 special category**, and sensitive
personal information under the PH Data Privacy Act. This slice joins that to legal name and
government ID verification. That combination, breached, does not leak accounts — it leaks
*the identities of queer women*, some in jurisdictions where that is a physical-safety event.

Three rules follow, and they are structural, not aspirational:

1. **We never hold the artifact.** No ID image, no face scan, no document number touches our
   Postgres or Storage. Didit verifies; we store `status` + `provider_session_id`. Breach of
   our database yields no document.
2. **Legal name lives in one table nothing else joins to**, readable only through a logging
   RPC (§7, G7), purged 30 days after decision.
3. **Every read of Art. 9 data is logged.** RLS cannot log. Therefore the read path is an
   RPC, not a policy — an RPC cannot be bypassed by a direct PostgREST call.

**A DPIA is required** before first collection. Art. 9 data, vulnerable data subjects,
systematic evaluation. It is a document, not code, and it is not optional.

---

## 4. Surfaces

| Surface | App | Who |
|---|---|---|
| Code entry → application → KYC handoff → pending screen | `roxy-client` | Applicant, pre-approval |
| Review queue, approve/reject + note, safety rating, watchlist | `roxy-studio` | Community admin / border patrol |
| Criteria CRUD, overflow window, review codes, appeals | `roxy-studio` | Roxy staff |

No reviewer tooling ships in `roxy-client`. The credential boundary is which app holds the
capability, per the workspace safety-separation rule.

---

## 5. Schema (migrations 070–073)

```
invite_codes              code, community_id, created_by, max_uses, uses_count,
                          expires_at, revoked_at, is_review_code
code_attempts             code_text, ip_hash, attempted_at        ← rate limiting, G1
membership_applications   code_id, community_id, auth_user_id, status,
                          submitted_at, decided_at, rejected_until
application_reviews       application_id, safety_rating, watchlist, watchlist_reason,
                          decision_note, decided_by                ← reviewers only
applicant_identity        application_id, legal_name, purge_after  ← RPC-only read, G7
application_access_log    application_id, viewer_id, field, viewed_at
identity_verifications    auth_user_id, provider, provider_session_id, status,
                          duplicate_signal                          ← no artifacts
verification_criteria     key, label, points, is_required, is_active, sort_order,
                          community_id
application_criteria_met  application_id, criterion_id, evidence_ref
application_answers       application_id, question_id, answer
application_appeals       application_id, requested_at, resolved_at, resolved_by
reviewer_settings         user_id, accepts_overflow, reviewer_agreement_at
member_safety             user_id, safety_rating, watchlist, updated_by
```

### Why `membership_applications` and `application_reviews` are two tables

The applicant must read their own application status. RLS is row-level, not column-level.
If `safety_rating` and `watchlist` sat on the same row, a `select *` by the applicant would
return their own watchlist flag. Splitting is the only way "internal" means internal.

### Why `applicant_identity` is separate from `profiles`

`profiles` is broadly readable across the app. A legal name on it would be readable by
every surface that reads a display name.

### Scoring is a function, not a column

```sql
application_score(app_id) -- SUM(points) over active criteria met
```

Stored, every edit to criteria in roxy-studio would strand thousands of stale scores. As a
function, changing `points` from 1 → 2 reprices the queue on next read. Adding a criterion
is one row — **no migration**, which is what "easy to do admin side" has to mean.

### Roles

`community_members.role` CHECK gains `'border_patrol'` → `member|moderator|admin|border_patrol`.

Reviewer capability resolves as:

```
reviewer of the application's own community
  OR profiles.is_staff
  OR (pending > platform_settings.overflow_after_days
      AND reviewer_settings.accepts_overflow)
```

…**and in all three cases** the caller must be `vetting_status = 'approved'` with a non-null
`reviewer_agreement_at` (G8). A grandfathered `unvetted` admin cannot read Art. 9 data.

---

## 6. Enforcement — where the gate actually lives

Migration 069 (already written, unapplied) introduced `can_read_community_content`,
`can_read_post`, `can_read_comment`. Slice C adds the approval check **inside those helpers**
rather than bolting it onto every policy in the database. An unapproved account holds a
valid JWT and reads nothing.

```sql
is_approved_member() := vetting_status IN ('approved', 'unvetted')
```

**`'unvetted'` must be included.** Grandfathered users retain full access — a helper testing
`= 'approved'` locks out every existing user the moment it deploys.

**Ordering is load-bearing:** the grandfather backfill runs *before* the enforcement
migration. Reversed, the app is down between the two.

---

## 7. Gaps found in review and how each is resolved

| # | Gap | Resolution |
|---|---|---|
| G1 | Pre-auth code check is a public enumeration target | 10-char Crockford base32 (no I/L/O/U) ≈ 1.1×10¹⁵; `code_attempts` 5/hr per IP hash; code auto-locks after N global failures |
| G2 | `is_approved_member()` vs grandfathering contradiction | `IN ('approved','unvetted')`; backfill ordered first |
| G3 | Rejected applicant gets another code | 30-day `rejected_until`; blocklist keyed on Didit's **duplicate-detection signal**, never raw PII |
| G4 | "Purged post-decision" was prose | `pg_cron`: legal name at 30d post-decision; rejected applications wholly at 90d; `identity_verifications` retains status + session id only |
| G5 | No appeal path under always-human review | `application_appeals`, one staff-level appeal per rejection |
| G6 | No push token exists pre-approval | Existing `email_queue` (`034_marketplace_infra.sql:17`). **Requires** extending its `email_type` CHECK and relaxing `recipient_user_id NOT NULL → profiles(id)`, which an applicant may not yet have |
| G7 | Art. 9 reads unlogged | `applicant_identity` has **no read policy**; sole access is a `SECURITY DEFINER` RPC writing `application_access_log` |
| G8 | Grandfathered admin reading legal names | Reviewer capability requires `approved` + `reviewer_agreement_at` |
| G9 | Cross-community watchlist is defamation-adjacent | Admins see own-community flags only; cross-community is staff-only; reason string mandatory |
| G10 | Scoring stopped at application | `member_safety`, keyed on user, independent lifecycle |
| G11 | Store reviewers cannot pass an invite gate | Staff-issued permanent `is_review_code`, auto-approves, excluded from analytics — a documented exception to "no exceptions" |
| G12 | 069 taken by the RLS hotfix | Slice C starts at 070 |
| G13 | "1 post/community/day" was policy, not schema | Partial unique index on `(community_id, (created_at::date))` where announcement |
| G14 | Two feed tabs, one `feedStore` cursor | Per-tab cursor state — one store cannot paginate two lists |

---

## 8. Flows

### Signup

```
enter code → validate-invite-code (public, rate-limited, returns valid|invalid only)
           → Supabase signUp
           → profile created, vetting_status = 'pending'
           → application row created, bound to code_id
           → criteria checklist (name, gov ID, KYC, socials, essay)
           → KYC: create session server-side → open hosted URL → webhook decides
           → pending screen; RLS denies everything else
           → reviewer decides → email via email_queue → approved | rejected + cooldown
```

### Review

```
queue sorted by application_score DESC, submitted_at ASC
  → own-community by default; overflow toggle adds aged applications
  → open application: answers + criteria met + KYC status (never the document)
  → legal name requires explicit reveal → RPC → access logged
  → approve | reject + note (mandatory) | flag watchlist + reason (mandatory)
```

---

## 9. Error and empty states

Every one of these is a required deliverable, not a nicety:

- Invalid code · expired code · revoked code · code at `max_uses` — four distinct messages
- Rate-limited: "too many attempts, try again in N minutes", no hint whether codes were real
- KYC declined — retry path, does not auto-reject the application
- KYC pending at review time — reviewer sees "verification in progress", can still decide
- Empty review queue · overflow toggle with nothing aged
- Applicant pending screen — expected wait, what to expect, support contact
- Rejected screen — appeal path, cooldown expiry date
- Reviewer without `reviewer_agreement_at` — blocked with the agreement, not a 403

## 10. Testing

- **RLS isolation:** outsider reads 0 applications; community admin reads 0 from another
  community; `unvetted` admin denied Art. 9; applicant reads own row but not `application_reviews`
- **Access log:** every legal-name read produces exactly one log row; no bypass path
- **Rate limiting:** 6th attempt in an hour is rejected; code locks after N global failures
- **Score:** editing `points` reprices existing applications without a rewrite
- **Grandfathering:** existing user retains access across the enforcement migration
- **Cooldown:** rejected applicant with a fresh code is refused until `rejected_until`
- **Migration:** applies and rolls back clean on a fresh database

---

## 11. Known dependencies outside this slice

1. **`roxy-lp` needs a code field + "request a code" path.** A code-only gate makes the
   current survey/waitlist landing page a dead end. Separate slice; launch dependency.
2. **Expo 51 / RN 0.74 upgrade** is owed regardless — Play Store target-SDK deadlines move
   yearly (task #11). The hosted KYC flow dodges it today; it does not remove it.
3. **DPIA** before first production ID collection.
4. **Didit DPA** confirmed in writing (§2).
