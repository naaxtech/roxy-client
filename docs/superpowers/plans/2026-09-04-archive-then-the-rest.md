# Archive first, then everything else

Written 2026-09-04. Branch `feature/wlw-archive`, deployed continuously to
<https://roxy.expo.app>, production database at head 104.

Standing instruction: **polish the Archive to done, then work through the rest.**
This file is the "do not forget" list.

---

## Where things stand

Live and working: the 3.0 IA, the Archive (schema, RLS, 45 seeded works, browse,
entry, four composers, Discover rail, global search, studio moderation), profile
posting, chat reliability, the room consent strip, DM permissions, and every fix
from the production review.

Migration 104 removed the 28,972 fabricated votes and 21 fabricated reviews. The
Archive is now **honest and empty**: 45 entries, 95 content notes, zero ratings.
That is the state everything below is designed for.

---

## Phase A — the Archive, to done

### A1. The unrated catalogue *(in progress)*

Zeroing the votes exposed a defect that was previously masked: `Top rated`
filters `has_score = true`, so with no ratings the default view returns **zero
rows** and a catalogue of 45 titles renders as "The Archive is empty right now".

- `Top rated` ranks rated-first rather than excluding unrated. The ≥10 gate
  stops meaning *hide* and starts meaning *rank below*.
- Unrated is a designed state: the row invites a first vote instead of reporting
  an absence.
- A `Needs ratings` sort, so contributing has a front door.

### A2. Entry page hierarchy

The entry screen was built when every entry had a score. With none, the ring
dominates a screen that has nothing to show in it. Re-weight toward the work
itself — title, creator, summary, content notes — and toward the vote card.

### A3. The first-vote moment

Casting the first vote on an entry is the single most valuable action in the
product right now, and it currently changes a number silently. It should feel
like it landed.

### A4. Reviews as the second loop

Once an entry has a rating, the ask becomes a review. The write-review composer
exists; what is missing is the invitation, at the moment a woman has just voted.

### A5. Lower-severity review findings

- Counter drift when a member moves her own vote (largely closed by 101's column
  revoke — confirm and close out).
- Migration 100's comment claims column scoping RLS cannot express. Correct the
  comment.
- Analytics re-publishes per-woman vote and watchlist events to two vendors
  under a stable hashed id, which is a finer-grained record than the schema's own
  privacy line. Decide and align.

---

## Phase B — the rest of the 3.0 brief

In order. Each is independently shippable.

### B1. Community route on the profile shell
`(tabs)/discover/community/[id].tsx` still draws its own header and tabs. The
tab model already fits (`photos`/`policies` are seller-only). Rooms · Events ·
Games · About, LIVE as dot **and** word.

### B2. Business route on the profile shell
Same, for `app/business/[id].tsx`. Shop tab only for an approved seller.

### B3. Community channels
`#general` / `#meetups-events` / `#buy-sell-trade`, per community. Needs a
migration (`community_channels`, `channel_messages`, RLS in the same file),
channel switcher, per-channel unread, last-message preview in the inbox. The
largest remaining piece.

### B4. Rich message cards in chat
Event and product cards inline, via `lib/contentNavigation`.

### B5. In-room moderation
Long-press a message: report, mute, delete (mods), pin (mods). Pinned banner.

### B6. Raise hand in audio rooms
Needs `room_hands` + RLS. Read defensively so the branch ships before the
migration is applied.

---

## Phase C — the pipeline

`_kernel/doctrine/release-pipeline.md` describes dev → staging → production. None
of it exists yet: no `dev` or `staging` branch, one Supabase project, CI wired
only for `main` / `session-*` / `version*`.

**This is what would have caught 104.** A staging database would have shown the
fabricated votes to nobody, and the seed guard would have behaved as designed.

### C1. `dev` and `staging` branches, CI triggers for both
### C2. A second and third Supabase project
### C3. A promotion check that a migration was actually applied

---

## Standing rules for this work

- Migrations are applied with `node scripts/apply-migration.mjs`, one at a time,
  and verified by asking the database afterwards. `npx supabase` resolves to a
  broken shim; `npx --yes supabase@2.99.0` works.
- Every change deploys to roxy.expo.app and is verified in the shipped bundle,
  not in the deploy log.
- A defect found in live code jumps the queue ahead of new work.

---

## B3 — Community channels (design: "Community channels", markup 655–697)

**The outcome:** a member opens her community and talks in one of its channels.

**Why a dedicated table, not `conversations`.** `conversations` decides access by
scanning `participant_ids uuid[]`. Migration 103 fixed two DM bypasses that came
straight out of that shape — a null `conversation_type`, and a three-participant
array carrying a permissive decoy. A channel with 1,240 members would need 1,240
array entries and would force the DM permission logic to special-case itself.
Channel access is a *property* — "is she in this community" — so it is asked of
`community_members` through the existing `is_community_member(cid)`, which is
already STABLE SECURITY DEFINER with a pinned search_path and already composes
`is_approved_member()`.

**Schema (105):**
- `community_channels(id, community_id→communities, slug, name, topic, position,
  is_default, created_by, created_at)`, unique `(community_id, slug)`.
- `community_channel_messages(id, channel_id→community_channels, sender_id→profiles,
  body, created_at, edited_at, deleted_at)`.
- RLS on both in the SAME file (`.claude/rules/migrations.md`).
- Read: `is_community_member(community_id)`. Write: member AND
  `sender_id = auth.uid()`. Edit/soft-delete: own message, or a community
  admin/moderator.
- A down migration in `supabase/downs/`.

**Client:** `lib/channels.ts` (fetch/send), `store/channelStore.ts`,
`app/community/channels/[communityId].tsx` (the house pattern, matching
`app/community/members/[communityId].tsx`), and `components/channels/`
— `ChannelBar`, `ChannelMessage`, `ChannelComposer`.

`ChannelBar` is a horizontal ScrollView and therefore gets
`flexGrow: 0, flexShrink: 0` — without it a flex sibling crushes it to 6px on
react-native-web, which is the bug MediaTypeChips already shipped once.

**Deferred to B4:** the design's rich message cards (`m.hasCard`). Attachment
columns are NOT in 105 — schema nothing reads is dead schema.
