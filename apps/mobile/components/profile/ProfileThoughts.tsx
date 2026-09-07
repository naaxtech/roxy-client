import { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { contentDetailPath } from '../../lib/contentNavigation';
import { logError } from '../../lib/errorLogger';
import { isThought } from '../../lib/postKind';
import { useFeedStore } from '../../store/feedStore';
import { ThoughtRow, type Thought, type ThoughtAuthor } from './ThoughtRow';
import type { PostType } from '../../types';

/** The row shape as the database returns it, before it becomes a `Thought`. */
type ThoughtRowData = {
  id: string;
  content: string;
  post_type: PostType;
  created_at: string;
  reaction_counts: Record<string, number> | null;
  comment_count: number | null;
  like_count: number | null;
  profiles: ThoughtAuthor | null;
};

interface Props {
  /** A member's own written posts. */
  userId?: string;
  /** A community's written posts. Exactly one of the two is given. */
  communityId?: string;
  testID?: string;
}

/**
 * The Thoughts tab — text posts, read the way Threads reads them.
 *
 * These used to sit in the photo grid, where a paragraph was cropped into a
 * square thumbnail. A square is the wrong container for a sentence: it crops
 * the one thing the post is made of, and a wall of cropped paragraphs reads as
 * broken image tiles rather than as things somebody said.
 *
 * So: full width, no crop, text at reading size, a hairline between entries and
 * a quiet count row underneath. The rail down the left is Threads' own device —
 * it makes a column of separate posts read as one continuous voice.
 */
export function ProfileThoughts({ userId, communityId, testID = 'profile-thoughts' }: Props) {
  const colors = useThemeColors();
  const router = useRouter();
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // Likes are the feed's business, not a second implementation here: the store
  // owns the optimistic flip, the upsert-not-insert that survives a double tap,
  // and the rollback when the write fails.
  const likedPostIds = useFeedStore((st) => st.likedPostIds);
  const toggleLike = useFeedStore((st) => st.toggleLike);
  // The store's own count lives on ITS post list, which this screen does not
  // use — so the visible number is adjusted here and reconciled on next load.
  const [likeDelta, setLikeDelta] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    setLoading(true);
    // One column or the other, never both and never neither: a query with no
    // scope would return the whole table's newest 60 posts and render them as
    // this profile's own.
    const scopeColumn = communityId ? 'community_id' : 'author_id';
    const scopeValue = communityId ?? userId;
    if (!scopeValue) {
      setThoughts([]);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from('posts')
      .select(
        'id, content, post_type, created_at, reaction_counts, comment_count, like_count, '
        + 'profiles!posts_author_id_fkey(id, display_name, username, avatar_url)',
      )
      .eq(scopeColumn, scopeValue)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(60);

    if (error) {
      logError(error, 'ProfileThoughts.load');
      setFailed(true);
      setLoading(false);
      return;
    }
    // Filtered here rather than in the query: `isThought` is the one definition
    // the Posts grid also reads, and a `.in('post_type', [...])` here would be
    // a second copy of it that drifts the day a type is added.
    const rows = (data ?? []) as unknown as ThoughtRowData[];
    setThoughts(
      rows
        .filter((row) => isThought(row.post_type))
        .map((row) => ({
          id: row.id,
          content: row.content,
          post_type: row.post_type,
          created_at: row.created_at,
          replyCount: row.comment_count ?? 0,
          // `like_count` is the column the feed maintains. `reaction_counts` is
          // the emoji map and summing it here would show a different number to
          // the one the same post shows in the feed.
          likeCount: row.like_count ?? 0,
          author: row.profiles ?? null,
        })),
    );
    // A fresh load is the truth; drop any local adjustments it supersedes.
    setLikeDelta({});
    setFailed(false);
    setLoading(false);
  }, [userId, communityId]);

  useEffect(() => { void load(); }, [load]);

  const s = StyleSheet.create({
    wrap: { paddingTop: 4 },
    row: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 14 },
    // Threads' continuity rail: a thin line under each post joining it to the
    // next, so a column of separate posts reads as one voice.
    railCol: { width: 2, alignItems: 'center' },
    rail: { flex: 1, width: 2, borderRadius: 1, backgroundColor: colors.line },
    body: { flex: 1, minWidth: 0, paddingBottom: 14 },
    head: { flexDirection: 'row', alignItems: 'baseline', gap: 7 },
    when: { ...TYPE.micro, color: colors.textMuted },
    // Reading size, and never clamped. The whole point of this tab is that the
    // words are not cropped.
    text: { ...TYPE.bodyLg, color: colors.textPrimary, marginTop: 3 },
    counts: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 9 },
    count: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    countText: { ...TYPE.micro, color: colors.textMuted },
    sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginLeft: 44 },
    empty: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 32, gap: 6 },
    emptyTitle: { ...TYPE.title, color: colors.textPrimary, textAlign: 'center' },
    emptyBody: { ...TYPE.caption, color: colors.textSecondary, textAlign: 'center' },
    retry: { ...TYPE.caption, color: colors.primaryInk, fontWeight: '700' },
    retryHit: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  });

  if (loading) {
    return <ActivityIndicator color={colors.primary} style={{ marginVertical: 24 }} testID={`${testID}-loading`} />;
  }

  if (failed) {
    return (
      <View style={s.empty} testID={`${testID}-error`}>
        <Text style={s.emptyBody}>Could not load these.</Text>
        <TouchableOpacity
          onPress={() => { void load(); }}
          style={s.retryHit}
          accessibilityRole="button"
          accessibilityLabel="Try again"
        >
          <Text style={s.retry}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (thoughts.length === 0) {
    return (
      <View style={s.empty} testID={`${testID}-empty`}>
        <Text style={s.emptyTitle}>No thoughts yet</Text>
        <Text style={s.emptyBody}>
          Anything you write without a photo lands here, in full.
        </Text>
      </View>
    );
  }

  const open = (t: Thought) =>
    router.push(contentDetailPath(t.id, t.post_type) as never);

  return (
    <View style={s.wrap} testID={testID}>
      {thoughts.map((thought, i) => (
        <ThoughtRow
          key={thought.id}
          thought={{
            ...thought,
            likeCount: Math.max(0, thought.likeCount + (likeDelta[thought.id] ?? 0)),
          }}
          liked={likedPostIds.has(thought.id)}
          connected={i < thoughts.length - 1}
          onOpen={() => open(thought)}
          // Reply lands on the post's own page, where the composer and the
          // existing comment thread already live. A second comment surface here
          // would be a second place for a reply to go missing.
          onReply={() => open(thought)}
          onLike={() => {
            const wasLiked = likedPostIds.has(thought.id);
            setLikeDelta((d) => ({
              ...d,
              [thought.id]: (d[thought.id] ?? 0) + (wasLiked ? -1 : 1),
            }));
            void toggleLike(thought.id);
          }}
          onPressAuthor={(id) => router.push(`/user/${id}` as never)}
          testID={`${testID}-${thought.id}`}
        />
      ))}
    </View>
  );
}
