import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  RefreshControl, Alert,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { format, isToday, isTomorrow, isThisWeek } from 'date-fns';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/authStore';
import { useProfileStore } from '../../../store/profileStore';
import { useFeedStore } from '../../../store/feedStore';
import { COLORS } from '../../../lib/constants';
import { Post, Event } from '../../../types';

const REACTIONS = ['🌸', '💜', '🔥', '✊'] as const;

function buildFeedItems(posts: Post[], isDating: boolean): (Post | { id: string; _type: 'teaser' })[] {
  const items: (Post | { id: string; _type: 'teaser' })[] = [];
  posts.forEach((p, i) => {
    items.push(p);
    if (isDating && (i + 1) % 8 === 0) {
      items.push({ id: `teaser-${i}`, _type: 'teaser' });
    }
  });
  return items;
}

function eventDateLabel(startsAt: string): string {
  const d = new Date(startsAt);
  if (isToday(d)) return 'Today';
  if (isTomorrow(d)) return 'Tomorrow';
  if (isThisWeek(d)) return format(d, 'EEEE');
  return format(d, 'EEE, MMM d');
}

function PostCard({ post, onReact }: { post: Post; onReact: (emoji: string) => void }) {
  return (
    <View style={styles.postCard}>
      <View style={styles.postHeader}>
        <View style={styles.postAvatar} />
        <View style={styles.postMeta}>
          <Text style={styles.postAuthor}>Community Member</Text>
          <Text style={styles.postTime}>{format(new Date(post.created_at), 'MMM d')}</Text>
        </View>
      </View>
      <Text style={styles.postContent}>{post.content}</Text>
      <View style={styles.reactionBar}>
        {REACTIONS.map((emoji) => (
          <TouchableOpacity key={emoji} style={styles.reactionBtn} onPress={() => onReact(emoji)}>
            <Text style={styles.reactionEmoji}>{emoji}</Text>
            <Text style={styles.reactionCount}>{post.reaction_counts[emoji] ?? 0}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function DatingTeaserCard({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.teaserCard} onPress={onPress} activeOpacity={0.8}>
      <Text style={styles.teaserEmoji}>⚡</Text>
      <Text style={styles.teaserTitle}>Speed Dating is open</Text>
      <Text style={styles.teaserSub}>5-minute connections. Meet someone new today.</Text>
    </TouchableOpacity>
  );
}
function EventCard({
  event, isRsvpd, onRsvp,
}: { event: Event; isRsvpd: boolean; onRsvp: () => void }) {
  return (
    <View style={styles.eventCard}>
      <View style={styles.eventLeft}>
        <Text style={styles.eventDateLabel}>{eventDateLabel(event.starts_at)}</Text>
        <Text style={styles.eventTime}>{format(new Date(event.starts_at), 'HH:mm')}</Text>
      </View>
      <View style={styles.eventBody}>
        <Text style={styles.eventTitle} numberOfLines={2}>{event.title}</Text>
        {event.description ? (
          <Text style={styles.eventDesc} numberOfLines={1}>{event.description}</Text>
        ) : null}
        <Text style={styles.eventMeta}>
          {event.event_type === 'online' ? '🌐 Online' : '📍 ' + (event.location_text ?? 'In person')}
          {' · '}{event.attendee_count} going
        </Text>
      </View>
      <TouchableOpacity
        style={[styles.rsvpBtn, isRsvpd && styles.rsvpBtnActive]}
        onPress={onRsvp}
      >
        <Text style={[styles.rsvpBtnText, isRsvpd && styles.rsvpBtnTextActive]}>
          {isRsvpd ? '✓ Going' : 'RSVP'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

export default function DiscoverScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { profile } = useProfileStore();
  const { posts, events, loading, setPosts, setEvents, setLoading, incrementReaction, markRsvpd, rsvpdEventIds } = useFeedStore();

  const [segment, setSegment] = useState<'feed' | 'events'>('feed');
  const [refreshing, setRefreshing] = useState(false);

  const loadFeed = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('posts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(40);
    setPosts((data as Post[]) ?? []);
  }, [user, setPosts]);

  const loadEvents = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('events')
      .select('*')
      .gte('starts_at', new Date().toISOString())
      .order('starts_at', { ascending: true })
      .limit(20);
    setEvents((data as Event[]) ?? []);
  }, [user, setEvents]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadFeed(), loadEvents()]).finally(() => setLoading(false));
  }, [loadFeed, loadEvents, setLoading]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadFeed(), loadEvents()]);
    setRefreshing(false);
  };

  const handleReact = async (postId: string, emoji: string) => {
    incrementReaction(postId, emoji);
    await supabase.rpc('increment_reaction', { p_post_id: postId, p_emoji: emoji }).catch(() => {});
  };

  const handleRsvp = async (event: Event) => {
    if (!user) return;
    const isRsvpd = rsvpdEventIds.has(event.id);
    if (isRsvpd) return;
    markRsvpd(event.id);
    const { error } = await supabase
      .from('event_attendees')
      .insert({ event_id: event.id, user_id: user.id });
    if (error) Alert.alert('Could not RSVP', error.message);
  };

  const feedItems = buildFeedItems(posts, profile?.is_dating_mode ?? false);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.segmentRow}>
        {(['feed', 'events'] as const).map((s) => (
          <TouchableOpacity
            key={s}
            style={[styles.segmentBtn, segment === s && styles.segmentBtnActive]}
            onPress={() => setSegment(s)}
          >
            <Text style={[styles.segmentText, segment === s && styles.segmentTextActive]}>
              {s === 'feed' ? 'Feed' : 'Events'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {segment === 'feed' ? (
        <FlashList
          data={feedItems}
          keyExtractor={(item) => item.id}
          estimatedItemSize={160}
          renderItem={({ item }) => {
            if ('_type' in item && item._type === 'teaser') {
              return <DatingTeaserCard onPress={() => router.push('/(tabs)/connect/speed-dating')} />;
            }
            const post = item as Post;
            return <PostCard post={post} onReact={(emoji) => handleReact(post.id, emoji)} />;
          }}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.roxy} />}
          ListEmptyComponent={
            loading ? null : (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>No posts yet</Text>
                <Text style={styles.emptySub}>Join communities to see their posts here.</Text>
              </View>
            )
          }
        />
      ) : (
        <FlashList
          data={events}
          keyExtractor={(item) => item.id}
          estimatedItemSize={100}
          renderItem={({ item }) => (
            <EventCard
              event={item}
              isRsvpd={rsvpdEventIds.has(item.id)}
              onRsvp={() => handleRsvp(item)}
            />
          )}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.roxy} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No upcoming events</Text>
              <Text style={styles.emptySub}>Events from your communities will appear here.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  segmentRow: {
    flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.surface,
    paddingHorizontal: 16, gap: 4,
  },
  segmentBtn: { paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  segmentBtnActive: { borderBottomColor: COLORS.primary },
  segmentText: { color: COLORS.textMuted, fontWeight: '600', fontSize: 15 },
  segmentTextActive: { color: COLORS.textPrimary },
  listContent: { padding: 16 },
  postCard: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 16, marginBottom: 12 },
  postHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 10 },
  postAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.primary + '40' },
  postMeta: { flex: 1 },
  postAuthor: { color: COLORS.textPrimary, fontWeight: '600', fontSize: 14 },
  postTime: { color: COLORS.textMuted, fontSize: 12 },
  postContent: { color: COLORS.textSecondary, fontSize: 15, lineHeight: 22 },
  reactionBar: { flexDirection: 'row', marginTop: 12, gap: 8 },
  reactionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: COLORS.surfaceLight, borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  reactionEmoji: { fontSize: 16 },
  reactionCount: { color: COLORS.textMuted, fontSize: 12, fontWeight: '600' },
  teaserCard: {
    backgroundColor: COLORS.primary + '20', borderRadius: 16, padding: 16,
    marginBottom: 12, alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: COLORS.primary + '50',
  },
  teaserEmoji: { fontSize: 28 },
  teaserTitle: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 16 },
  teaserSub: { color: COLORS.textSecondary, fontSize: 13, textAlign: 'center' },
  eventCard: {
    backgroundColor: COLORS.surface, borderRadius: 14, padding: 14,
    marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  eventLeft: { alignItems: 'center', minWidth: 52 },
  eventDateLabel: { color: COLORS.primary, fontWeight: '700', fontSize: 12 },
  eventTime: { color: COLORS.textMuted, fontSize: 12 },
  eventBody: { flex: 1, gap: 2 },
  eventTitle: { color: COLORS.textPrimary, fontWeight: '600', fontSize: 14 },
  eventDesc: { color: COLORS.textMuted, fontSize: 12 },
  eventMeta: { color: COLORS.textMuted, fontSize: 11 },
  rsvpBtn: {
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.primary,
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7,
  },
  rsvpBtnActive: { backgroundColor: COLORS.primary },
  rsvpBtnText: { color: COLORS.primary, fontWeight: '700', fontSize: 13 },
  rsvpBtnTextActive: { color: '#fff' },
  empty: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTitle: { color: COLORS.textPrimary, fontSize: 17, fontWeight: '700' },
  emptySub: { color: COLORS.textMuted, fontSize: 14, textAlign: 'center' },
});
