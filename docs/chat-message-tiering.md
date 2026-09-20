# ADR — Chat Message Tiering (Hot Postgres → Cold S3)

**Status:** Accepted — deferred until a trigger condition is met.
**Date:** 2026-09-20
**Applies to:** `messages` (DMs), `community_channel_messages` (group channels).

## Context

Chat history grows monotonically and is never deleted. That is correct — Roxy's
moderation, reporting, and emotional-AI data pipeline (`AGENTS.md` §17) all
require the full transcript to survive. But access is heavily recency-biased:
roughly **~90 days of messages = ~80% of all reads**, while old messages
accumulate storage cost forever. Keeping a decade of history in the same
per-row hot store that serves the inbox is paying hot-storage prices for data
that is almost never read.

## Decision

Tier the message stores by age:

| Tier | Where | What | Latency |
|---|---|---|---|
| **Hot** | Postgres (`messages`, `community_channel_messages`) | last ~90 days of content + metadata | ~5 ms |
| **Cold** | Object storage (S3 / Cloudflare R2 / Supabase Storage) | message body older than the cutoff | ~50–200 ms |

A message's **metadata row stays in Postgres forever** — it becomes the index.
Only the **content** moves. The row gains a pointer to the cold object and a
flag so the client knows to hydrate it.

Cost math that justifies it (source: DynamoDB tiered-storage analysis, 2026):
`S3 ≈ $0.023/GB/mo`, `Glacier ≈ $0.004/GB/mo` vs a hot row store at `~$0.25/GB/mo`
— **~10–60× cheaper** on the archived bulk. For Roxy the trigger is not yet met
(see below), so this is a design to have ready, not to build now.

## What we do NOT do (bounded by this decision)

- **Do not move live text to object storage.** Text is tiny and must stay
  queryable per-message (RLS, pagination, realtime, read receipts, search).
  Only *cold* content moves.
- **Do not go local-first / device-only storage** (WhatsApp model). Roxy is
  server-authoritative: moderation, cross-device, and the AI pipeline depend on
  it.
- **Do not build tiering for the first 500 testers.** ~250 MB of text is free.
  The real cost drivers at this scale are Realtime message count and egress,
  not storage.

## Schema change when triggered

Add to each message table (one small, index-light migration):

```sql
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,        -- null = still hot
  ADD COLUMN IF NOT EXISTS content_key text;               -- S3 object key, when archived
```

Plus a partial index for the sweep job:

```sql
CREATE INDEX IF NOT EXISTS idx_messages_hot_archivable
  ON public.messages (created_at)
  WHERE archived_at IS NULL AND content IS NOT NULL;
```

The `content` column stays (nullable already on `messages`; `body` on channel
messages) — the client reads it hot, hydrates from `content_key` when cold.

## The job (when triggered)

A daily `archive-old-messages` edge function (or pg_cron):
1. `SELECT id, content FROM messages WHERE created_at < now() - interval '90 days' AND archived_at IS NULL LIMIT n`.
2. Write content to `s3://roxy-messages-archive/<conversation_id>/<id>.json` (or a
   compressed per-conversation segment).
3. `UPDATE messages SET content_key = <key>, archived_at = now() WHERE id = ...`
   and null the `content` column (or leave it; set `content = NULL` to reclaim
   space).

Rollback is trivial: the row is never deleted, only its content location
changes. A PITR restore is not needed to reverse a tiering pass.

## Client behavior (when triggered)

- Hot reads are unchanged.
- On scroll-back past the cutoff, `useRealtime.loadOlder` / channel loader
  detects `content IS NULL AND content_key IS NOT NULL` and fetches the body
  via a presigned URL (batched per page), then merges it in as if it had been
  hot. The only visible difference is ~100–200 ms on messages from years ago,
  which is acceptable.

## Trigger conditions (revisit, not auto-build)

Start tiering when **any** of these becomes true:

1. `messages` + `community_channel_messages` combined exceed **~5 GB** of
   logical storage, or
2. monthly DB storage cost exceeds the monthly cost of the S3 archive path plus
   the sweep job, or
3. p95 scroll-back latency on a 2-year-old conversation exceeds ~300 ms.

## Consequences

- **Positive:** storage cost stays flat once the cutoff is crossed; the inbox
  stays fast because the hot set is small.
- **Negative:** two read paths (hot vs cold) to maintain; a cold read is slower;
  the sweep job is a new thing to operate.
- **Neutral:** the metadata index is still in Postgres, so search, unread, and
  RLS keep working; only content bytes are relocated.
