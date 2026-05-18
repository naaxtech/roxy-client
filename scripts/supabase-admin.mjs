#!/usr/bin/env node
/**
 * Server-side Supabase admin helper (uses SUPABASE_SERVICE_ROLE_KEY from .env).
 * Usage: node scripts/supabase-admin.mjs posts-count
 *        node scripts/supabase-admin.mjs join-all-communities
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const cmd = process.argv[2] ?? 'posts-count';

async function postsCount() {
  const { count, error } = await sb.from('posts').select('*', { count: 'exact', head: true }).is('deleted_at', null);
  if (error) throw error;
  const { data: byType } = await sb.from('posts').select('post_type').is('deleted_at', null);
  const types = {};
  for (const r of byType ?? []) types[r.post_type] = (types[r.post_type] ?? 0) + 1;
  console.log(JSON.stringify({ total: count, byType: types }, null, 2));
}

async function joinAllCommunities() {
  const { data: communities, error: cErr } = await sb.from('communities').select('id').eq('is_private', false);
  if (cErr) throw cErr;
  const { data: profiles, error: pErr } = await sb.from('profiles').select('id');
  if (pErr) throw pErr;
  const rows = [];
  for (const c of communities ?? []) {
    for (const p of profiles ?? []) {
      rows.push({ community_id: c.id, user_id: p.id, role: 'member' });
    }
  }
  const { error } = await sb.from('community_members').upsert(rows, {
    onConflict: 'community_id,user_id',
    ignoreDuplicates: true,
  });
  if (error) throw error;
  console.log(`Ensured memberships for ${profiles?.length ?? 0} profiles × ${communities?.length ?? 0} public communities`);
}

async function verifyFeedContent() {
  const { data: photos, error } = await sb
    .from('posts')
    .select('id, post_type, media_urls, video_thumbnail_url')
    .in('post_type', ['photo', 'gallery', 'video'])
    .is('deleted_at', null);
  if (error) throw error;
  const broken = (photos ?? []).filter(
    (p) =>
      (p.post_type === 'photo' || p.post_type === 'gallery') &&
      (!p.media_urls || p.media_urls.length === 0),
  );
  const { count: members } = await sb
    .from('community_members')
    .select('*', { count: 'exact', head: true });
  console.log(
    JSON.stringify(
      {
        mediaPosts: photos?.length ?? 0,
        brokenPhotoGallery: broken.length,
        communityMemberships: members,
      },
      null,
      2,
    ),
  );
}

async function feedScoreBackfill() {
  const { data: posts, error } = await sb
    .from('posts')
    .select('id, like_count, comment_count, save_count, created_at, feed_score')
    .is('deleted_at', null)
    .eq('feed_score', 0)
    .limit(100);
  if (error) throw error;
  console.log(`Posts with feed_score=0: ${posts?.length ?? 0} (run db push for compute_feed_score backfill if needed)`);
}

try {
  if (cmd === 'posts-count') await postsCount();
  else if (cmd === 'join-all-communities') await joinAllCommunities();
  else if (cmd === 'feed-check') await feedScoreBackfill();
  else if (cmd === 'verify-feed') await verifyFeedContent();
  else {
    console.error(`Unknown command: ${cmd}`);
    process.exit(1);
  }
} catch (e) {
  console.error(e.message ?? e);
  process.exit(1);
}
