import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, RefreshControl } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { TicketCard } from '../components/TicketCard';
import { useThemeColors } from '../hooks/useThemeColors';

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
  const colors = useThemeColors();
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
  const isFinished = (t: TicketRow) => {
    if (!t.events) return true;
    if (t.events.status === 'cancelled' || t.events.status === 'completed') return true;
    return new Date(t.events.starts_at) < now;
  };
  const upcoming = tickets.filter((t) => t.events && !isFinished(t));
  const past = tickets.filter((t) => t.events && isFinished(t));

  type ListItem =
    | { type: 'ticket'; data: TicketRow; finished: boolean }
    | { type: 'section'; label: string };

  const listData: ListItem[] = [
    ...(upcoming.length > 0 ? [{ type: 'section', label: 'Active' } as ListItem] : []),
    ...upcoming.map((t): ListItem => ({ type: 'ticket', data: t, finished: false })),
    ...(past.length > 0 ? [{ type: 'section', label: 'Finished' } as ListItem] : []),
    ...past.map((t): ListItem => ({ type: 'ticket', data: t, finished: true })),
  ];

  const renderItem = ({ item }: { item: ListItem }) => {
    if (item.type === 'section') {
      return (
        <Text
          style={[styles.sectionLabel, item.label === 'Finished' && styles.sectionFinished]}
          testID={`tickets-section-${item.label.toLowerCase()}`}
        >
          {item.label}
        </Text>
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
      <View style={[styles.ticketWrap, item.finished && styles.ticketFinished]}>
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

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
    back: { marginRight: 12 },
    heading: { fontSize: 20, fontWeight: '800', color: colors.textPrimary },
    list: { padding: 16 },
    sectionLabel: {
      color: colors.textPrimary, fontSize: 13, fontWeight: '800',
      letterSpacing: 0.4, marginBottom: 8, marginTop: 4,
    },
    sectionFinished: { color: colors.textMuted, marginTop: 12 },
    ticketWrap: { marginBottom: 12 },
    ticketFinished: { marginBottom: 6, opacity: 0.55 },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
    emptyText: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
    emptySubText: { color: colors.textSecondary, fontSize: 14 },
  });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <Ionicons name="arrow-back-outline" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.heading}>My Tickets</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.roxy} style={{ marginTop: 48 }} />
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
          keyExtractor={(item, i) => item.type === 'section' ? `section-${item.label}` : item.data.event_id + String(i)}
          contentContainerStyle={styles.list}
          onEndReached={() => { if (hasMore && !loading) fetchTickets(); }}
          onEndReachedThreshold={0.4}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.roxy} />}
        />
      )}
    </SafeAreaView>
  );
}

