import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, RefreshControl } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/authStore';
import { COLORS } from '../../../lib/constants';
import { TicketCard } from '../../../components/TicketCard';

interface TicketRow {
  event_id: string;
  ticket_code: string;
  is_checked_in: boolean;
  checked_in_at: string | null;
  rsvp_at: string;
  events: {
    id: string;
    title: string;
    starts_at: string;
    ends_at: string | null;
    location_text: string | null;
    status: 'active' | 'cancelled' | 'completed';
    communities: { name: string } | null;
  };
}

const PAGE_SIZE = 20;

export default function MyTicketsScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const channelRef = useRef<any>(null);

  const fetchTickets = useCallback(async (reset = false) => {
    if (!user) return;
    const currentPage = reset ? 0 : page;
    const from = currentPage * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data } = await supabase
      .from('event_attendees')
      .select('event_id, ticket_code, is_checked_in, checked_in_at, rsvp_at, events(id, title, starts_at, ends_at, location_text, status, communities(name))')
      .eq('user_id', user.id)
      .not('ticket_code', 'is', null)
      .order('rsvp_at', { ascending: false })
      .range(from, to);

    const rows = (data ?? []) as unknown as TicketRow[];
    if (reset) {
      setTickets(rows);
      setPage(1);
    } else {
      setTickets((prev) => [...prev, ...rows]);
      setPage((p) => p + 1);
    }
    setHasMore(rows.length === PAGE_SIZE);
    setLoading(false);
    setRefreshing(false);
  }, [user, page]);

  useEffect(() => {
    fetchTickets(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Realtime: update is_checked_in when host checks attendee in
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`my-attendees:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'event_attendees',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          setTickets((prev) =>
            prev.map((t) =>
              t.event_id === payload.new?.event_id
                ? { ...t, is_checked_in: payload.new.is_checked_in, checked_in_at: payload.new.checked_in_at }
                : t,
            ),
          );
        },
      )
      .subscribe();
    channelRef.current = channel;
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchTickets(true);
  };

  const now = new Date();
  const upcoming = tickets.filter((t) => t.events && new Date(t.events.starts_at) >= now);
  const past = tickets.filter((t) => t.events && new Date(t.events.starts_at) < now);

  type ListItem =
    | { type: 'ticket'; data: TicketRow }
    | { type: 'divider' };

  const listData: ListItem[] = [
    ...upcoming.map((t): ListItem => ({ type: 'ticket', data: t })),
    ...(past.length > 0 ? [{ type: 'divider' } as ListItem] : []),
    ...past.map((t): ListItem => ({ type: 'ticket', data: t })),
  ];

  const renderItem = ({ item }: { item: ListItem }) => {
    if (item.type === 'divider') {
      return (
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerLabel}>Past</Text>
          <View style={styles.dividerLine} />
        </View>
      );
    }
    const t = item.data;
    const isExpanded = expandedId === t.event_id;
    const eventStatus = t.events?.status ?? 'active';
    const ticketStatus: 'active' | 'cancelled' | 'checked_in' = eventStatus === 'cancelled'
      ? 'cancelled'
      : t.is_checked_in ? 'checked_in'
      : 'active';

    return (
      <View style={styles.ticketWrap}>
        {isExpanded ? (
          <TouchableOpacity onPress={() => setExpandedId(null)} activeOpacity={1}>
            <TicketCard
              eventTitle={t.events?.title ?? ''}
              startsAt={t.events?.starts_at ?? ''}
              locationText={t.events?.location_text ?? null}
              communityName={t.events?.communities?.name ?? null}
              ticketCode={t.ticket_code}
              variant="full"
              status={ticketStatus}
            />
          </TouchableOpacity>
        ) : (
          <TicketCard
            eventTitle={t.events?.title ?? ''}
            startsAt={t.events?.starts_at ?? ''}
            locationText={t.events?.location_text ?? null}
            communityName={t.events?.communities?.name ?? null}
            ticketCode={t.ticket_code}
            variant="collapsed"
            status={ticketStatus}
            onExpand={() => setExpandedId(t.event_id)}
          />
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <Ionicons name="arrow-back-outline" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.heading}>My Tickets</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={COLORS.roxy} style={{ marginTop: 48 }} />
      ) : tickets.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No tickets yet.</Text>
          <Text style={styles.emptySubText}>Find events in the Discover tab.</Text>
        </View>
      ) : (
        <FlashList
          data={listData}
          renderItem={renderItem}
          estimatedItemSize={80}
          keyExtractor={(item, _i) => item.type === 'divider' ? 'divider' : item.data.event_id}
          contentContainerStyle={styles.list}
          onEndReached={() => { if (hasMore && !loading) fetchTickets(); }}
          onEndReachedThreshold={0.4}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.roxy} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  back: { marginRight: 12 },
  heading: { fontSize: 20, fontWeight: '800', color: COLORS.textPrimary },
  list: { padding: 16 },
  ticketWrap: { marginBottom: 12 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 16, gap: 8 },
  dividerLine: { flex: 1, height: 1, backgroundColor: COLORS.surface },
  dividerLabel: { color: COLORS.textMuted, fontSize: 12, fontWeight: '600' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyText: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '700' },
  emptySubText: { color: COLORS.textSecondary, fontSize: 14 },
});
