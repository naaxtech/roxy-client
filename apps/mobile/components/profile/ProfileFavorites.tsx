import { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { COLORS } from '../../lib/constants';

type Fav = { id: string; entity_type: 'event' | 'game'; entity_id: string; title: string };

interface Props {
  userId: string;
  editable?: boolean;
}

export function ProfileFavorites({ userId, editable = false }: Props) {
  const router = useRouter();
  const [items, setItems] = useState<Fav[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('user_favorites')
      .select('id, entity_type, entity_id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);

    const rows = data ?? [];
    const enriched: Fav[] = await Promise.all(
      rows.map(async (r) => {
        if (r.entity_type === 'event') {
          const { data: ev } = await supabase.from('events').select('title').eq('id', r.entity_id).maybeSingle();
          return { ...r, title: ev?.title ?? 'Event' } as Fav;
        }
        const { data: g } = await supabase.from('games').select('name').eq('id', r.entity_id).maybeSingle();
        return { ...r, title: g?.name ?? 'Game' } as Fav;
      })
    );
    setItems(enriched);
    setLoading(false);
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  const open = (f: Fav) => {
    if (f.entity_type === 'event') router.push(`/event/${f.entity_id}` as any);
    else router.push(`/(tabs)/discover` as any);
  };

  const remove = async (id: string) => {
    await supabase.from('user_favorites').delete().eq('id', id);
    await load();
  };

  if (loading) return <ActivityIndicator color={COLORS.primary} style={{ margin: 16 }} />;
  if (!items.length && !editable) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Favourites</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {items.map((f) => (
          <TouchableOpacity key={f.id} style={styles.chip} onPress={() => open(f)} activeOpacity={0.85}>
            <Text style={styles.chipIcon}>{f.entity_type === 'event' ? '📅' : '🎮'}</Text>
            <Text style={styles.chipText} numberOfLines={1}>{f.title}</Text>
            {editable && (
              <TouchableOpacity onPress={() => void remove(f.id)} hitSlop={8}>
                <Text style={styles.remove}>×</Text>
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        ))}
        {!items.length && editable && (
          <Text style={styles.hint}>Save events and games from Roxy to show them here.</Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 16, paddingHorizontal: 16 },
  label: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700', letterSpacing: 0.6, marginBottom: 8 },
  row: { gap: 8, paddingBottom: 4 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.surface, borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 8, maxWidth: 200,
  },
  chipIcon: { fontSize: 14 },
  chipText: { color: COLORS.textPrimary, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  remove: { color: COLORS.textMuted, fontSize: 16, marginLeft: 4 },
  hint: { color: COLORS.textMuted, fontSize: 13 },
});

/** Toggle favourite for current user (call from event/game screens). */
export async function toggleUserFavorite(
  userId: string,
  entityType: 'event' | 'game',
  entityId: string,
): Promise<boolean> {
  const { data: existing } = await supabase
    .from('user_favorites')
    .select('id')
    .eq('user_id', userId)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .maybeSingle();

  if (existing?.id) {
    await supabase.from('user_favorites').delete().eq('id', existing.id);
    return false;
  }
  await supabase.from('user_favorites').insert({
    user_id: userId,
    entity_type: entityType,
    entity_id: entityId,
  });
  return true;
}
