import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, Modal, ScrollView,
  ActivityIndicator, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { useThemeColors } from '../../hooks/useThemeColors';
import type { LinkType } from '../../types';

export interface RoxyLinkSelection {
  linkType: LinkType;
  entityId: string;
  entityName: string;
  communityId: string | null;
}

interface RoxyLinkPickerProps {
  visible: boolean;
  userId: string;
  onSelect: (selection: RoxyLinkSelection) => void;
  onClose: () => void;
}

type EntityRow = { id: string; name: string; type: LinkType; communityId: string | null };

export function RoxyLinkPicker({ visible, onSelect, onClose }: RoxyLinkPickerProps) {
  const colors = useThemeColors();
  const [loading, setLoading] = useState(true);
  const [entities, setEntities] = useState<EntityRow[]>([]);

  const styles = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 24, borderTopRightRadius: 24,
      maxHeight: '75%', paddingBottom: 40,
    },
    handle: {
      width: 40, height: 4, backgroundColor: colors.textMuted,
      borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 8,
    },
    header: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingHorizontal: 20, paddingVertical: 12,
      borderBottomWidth: 1, borderBottomColor: colors.surface,
    },
    title: { color: colors.textPrimary, fontWeight: '700', fontSize: 16 },
    entityRow: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 20, paddingVertical: 14,
      borderBottomWidth: 1, borderBottomColor: colors.surface,
    },
    entityIcon: { fontSize: 22, marginRight: 14 },
    entityName: { flex: 1, color: colors.textPrimary, fontSize: 15 },
    empty: {
      color: colors.textMuted, textAlign: 'center',
      padding: 40, fontSize: 14,
    },
  });

  useEffect(() => {
    if (!visible) return;
    void loadEntities();
  }, [visible]);

  const loadEntities = async () => {
    setLoading(true);
    const [{ data: rooms }, { data: events }] = await Promise.all([
      supabase
        .from('community_rooms')
        .select('id, name, community_id')
        .eq('status', 'live')
        .limit(10),
      supabase
        .from('events')
        .select('id, title, community_id')
        .gte('starts_at', new Date().toISOString())
        .limit(10),
    ]);

    const all: EntityRow[] = [
      ...(rooms ?? []).map((r: any) => ({
        id: r.id, name: r.name, type: 'room' as LinkType, communityId: r.community_id,
      })),
      ...(events ?? []).map((e: any) => ({
        id: e.id, name: e.title, type: 'event' as LinkType, communityId: e.community_id,
      })),
    ];
    setEntities(all);
    setLoading(false);
  };

  const TYPE_ICON: Record<LinkType, string> = { game: '🎮', room: '🎙', event: '📅' };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <Text style={styles.title}>Link to...</Text>
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ padding: 40 }} />
        ) : entities.length === 0 ? (
          <Text style={styles.empty}>No active rooms or upcoming events to link.</Text>
        ) : (
          <ScrollView>
            {entities.map(e => (
              <TouchableOpacity
                key={e.id}
                style={styles.entityRow}
                onPress={() =>
                  onSelect({
                    linkType: e.type,
                    entityId: e.id,
                    entityName: e.name,
                    communityId: e.communityId,
                  })
                }
              >
                <Text style={styles.entityIcon}>{TYPE_ICON[e.type]}</Text>
                <Text style={styles.entityName}>{e.name}</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}
