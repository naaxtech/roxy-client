import { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { contentDetailPath } from '../../lib/contentNavigation';
import { logError } from '../../lib/errorLogger';
import { isThought } from '../../lib/postKind';
import type { PostType } from '../../types';

type Thought = {
  id: string;
  content: string;
  post_type: PostType;
  created_at: string;
  reaction_counts: Record<string, number> | null;
  comment_count: number | null;
};

interface Props {
  userId: string;
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
export function ProfileThoughts({ userId, testID = 'profile-thoughts' }: Props) {
  const colors = useThemeColors();
  const router = useRouter();
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('posts')
      .select('id, content, post_type, created_at, reaction_counts, comment_count')
      .eq('author_id', userId)
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
    setThoughts(((data ?? []) as Thought[]).filter((p) => isThought(p.post_type)));
    setFailed(false);
    setLoading(false);
  }, [userId]);

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

  return (
    <View style={s.wrap} testID={testID}>
      {thoughts.map((thought, i) => {
        const likes = Object.values(thought.reaction_counts ?? {}).reduce((a, b) => a + b, 0);
        const replies = thought.comment_count ?? 0;
        return (
          <View key={thought.id}>
            <TouchableOpacity
              activeOpacity={0.75}
              onPress={() => router.push(contentDetailPath(thought.id, thought.post_type) as never)}
              accessibilityRole="button"
              accessibilityLabel={`Open post: ${thought.content.slice(0, 60)}`}
              testID={`${testID}-${thought.id}`}
            >
              <View style={s.row}>
                <View style={s.railCol}>
                  {i < thoughts.length - 1 ? <View style={s.rail} /> : null}
                </View>
                <View style={s.body}>
                  <View style={s.head}>
                    <Text style={s.when}>{relativeWhen(thought.created_at)}</Text>
                  </View>
                  <Text style={s.text}>{thought.content}</Text>
                  <View style={s.counts}>
                    <View style={s.count}>
                      <Ionicons name="chatbubble-outline" size={13} color={colors.textMuted} />
                      <Text style={s.countText}>{replies}</Text>
                    </View>
                    <View style={s.count}>
                      <Ionicons name="heart-outline" size={13} color={colors.textMuted} />
                      <Text style={s.countText}>{likes}</Text>
                    </View>
                  </View>
                </View>
              </View>
            </TouchableOpacity>
            {i < thoughts.length - 1 ? <View style={s.sep} /> : null}
          </View>
        );
      })}
    </View>
  );
}

/**
 * "2h", "3d", "12 Aug".
 *
 * Built from elapsed milliseconds, never by shifting a Date across a month
 * boundary — `setMonth(getMonth() - 1)` overflows on a day the target month
 * does not have, which is the arithmetic `.claude/rules/tests.md` names.
 */
export function relativeWhen(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const mins = Math.floor((now.getTime() - at.getTime()) / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
