import { createClient } from '@/lib/supabase/server';
import { formatDistanceToNow } from 'date-fns';

// ─── Types ────────────────────────────────────────────────────────────────────

export type GameStatus =
  | 'pitch_pending'
  | 'pitch_approved'
  | 'pitch_rejected'
  | 'build_pending'
  | 'build_changes'
  | 'live'
  | 'suspended';

export type GameCategory = 'party' | 'trivia' | 'dating' | 'icebreaker' | 'other';

export interface Game {
  id: string;
  name: string;
  short_description: string;
  how_it_works: string;
  why_wlw: string;
  category: GameCategory;
  publisher_type: 'roxy' | 'community';
  status: GameStatus;
  url: string | null;
  thumbnail_url: string | null;
  submitted_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubmissionEvent {
  id: string;
  game_id: string;
  stage: 'pitch' | 'build';
  action: 'submitted' | 'approved' | 'rejected' | 'changes_requested' | 'resubmitted';
  actor_id: string | null;
  developer_notes: string | null;
  roxy_feedback: string | null;
  attachments: string[];
  created_at: string;
}

export interface GameWithSubmitter extends Game {
  profiles: { username: string | null; display_name: string | null } | null;
}

// ─── Community selector ───────────────────────────────────────────────────────

/** All live games for the community game selector. */
export async function getLiveGames(): Promise<Game[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('games')
    .select('*')
    .eq('status', 'live')
    .order('publisher_type', { ascending: true }) // roxy first
    .order('name', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** IDs of games already enabled for a community. */
export async function getCommunityGameIds(communityId: string): Promise<Set<string>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('community_games')
    .select('game_id')
    .eq('community_id', communityId);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.game_id));
}

// ─── Developer submissions ────────────────────────────────────────────────────

/** All games submitted by the current user. */
export async function getMySubmissions(userId: string): Promise<Game[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('games')
    .select('*')
    .eq('submitted_by', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Full event timeline for a single game. */
export async function getSubmissionEvents(gameId: string): Promise<SubmissionEvent[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('game_submission_events')
    .select('*')
    .eq('game_id', gameId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as SubmissionEvent[];
}

/** Single game — used in submission detail page. */
export async function getGame(gameId: string): Promise<Game | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('games')
    .select('*')
    .eq('id', gameId)
    .single();
  if (error) return null;
  return data as Game;
}

// ─── Staff review queue ───────────────────────────────────────────────────────

/** All pitch_pending and build_pending games for the staff queue. */
export async function getPendingReviews(): Promise<GameWithSubmitter[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('games')
    .select('*, profiles(username, display_name)')
    .in('status', ['pitch_pending', 'build_pending'])
    .order('updated_at', { ascending: true }); // oldest first
  if (error) throw error;
  return (data ?? []) as GameWithSubmitter[];
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

/** "24 Apr 2026 · 2 days ago" */
export function formatSubmittedAt(isoString: string): string {
  const date = new Date(isoString);
  const absolute = date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const relative = formatDistanceToNow(date, { addSuffix: true });
  return `${absolute} · ${relative}`;
}

export const STATUS_LABEL: Record<GameStatus, string> = {
  pitch_pending: 'Pitch Pending',
  pitch_approved: 'Pitch Approved',
  pitch_rejected: 'Pitch Rejected',
  build_pending: 'Build Pending',
  build_changes: 'Changes Requested',
  live: 'Live',
  suspended: 'Suspended',
};

export const STATUS_COLOR: Record<GameStatus, string> = {
  pitch_pending: 'bg-yellow-100 text-yellow-800',
  pitch_approved: 'bg-blue-100 text-blue-800',
  pitch_rejected: 'bg-red-100 text-red-800',
  build_pending: 'bg-yellow-100 text-yellow-800',
  build_changes: 'bg-orange-100 text-orange-800',
  live: 'bg-green-100 text-green-800',
  suspended: 'bg-gray-100 text-gray-600',
};
