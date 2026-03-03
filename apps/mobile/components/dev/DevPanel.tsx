// apps/mobile/components/dev/DevPanel.tsx
// This file is only included in __DEV__ builds
import { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView, Switch
} from 'react-native';
import { callEdgeFunction } from '../../lib/supabase';
import { COLORS } from '../../lib/constants';

interface DevStatus {
  ai_enabled: boolean;
  call_counts: Record<string, number>;
}

function DevPanelInner() {
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<DevStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    const { data } = await callEdgeFunction<DevStatus>('dev-control', { action: 'get_status' });
    if (data) setStatus(data);
  };

  useEffect(() => { if (visible) refresh(); }, [visible]);

  const toggleAi = async (val: boolean) => {
    setLoading(true);
    await callEdgeFunction('dev-control', { action: 'set_ai_enabled', value: val });
    await refresh();
    setLoading(false);
  };

  const action = async (a: string) => {
    setLoading(true);
    await callEdgeFunction('dev-control', { action: a });
    await refresh();
    setLoading(false);
  };

  return (
    <>
      {/* Floating button */}
      <TouchableOpacity style={styles.fab} onPress={() => setVisible(true)}>
        <Text style={styles.fabText}>DEV</Text>
      </TouchableOpacity>

      <Modal visible={visible} animationType="slide" transparent>
        <View style={styles.overlay}>
          <View style={styles.panel}>
            <Text style={styles.title}>🛠 ROXY DEV PANEL</Text>

            <View style={styles.row}>
              <Text style={styles.rowLabel}>AI Calls</Text>
              <Switch
                value={status?.ai_enabled ?? false}
                onValueChange={toggleAi}
                disabled={loading}
                trackColor={{ false: COLORS.error, true: COLORS.success }}
              />
              <Text style={[styles.badge, status?.ai_enabled ? styles.badgeLive : styles.badgePaused]}>
                {status?.ai_enabled ? 'LIVE' : 'PAUSED'}
              </Text>
            </View>

            {status && (
              <ScrollView style={styles.counts}>
                {Object.entries(status.call_counts).map(([fn, count]) => (
                  <Text key={fn} style={styles.countRow}>{fn.replace('roxy-', '')}: <Text style={styles.countNum}>{count}</Text></Text>
                ))}
              </ScrollView>
            )}

            <TouchableOpacity style={styles.actionBtn} onPress={() => action('reset_counters')}>
              <Text style={styles.actionBtnText}>Reset all counters</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} onPress={() => action('clear_greeting_cache')}>
              <Text style={styles.actionBtnText}>Clear greeting cache</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, styles.actionBtnAccent]} onPress={() => action('seed_speed_date_session')}>
              <Text style={styles.actionBtnText}>Seed test speed date</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.closeBtn} onPress={() => setVisible(false)}>
              <Text style={styles.closeBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

export function DevPanel() {
  if (!__DEV__) return null;
  return <DevPanelInner />;
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute', bottom: 100, left: 16,
    backgroundColor: COLORS.devPanel, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6, zIndex: 9999,
  },
  fabText: { color: '#fff', fontWeight: '800', fontSize: 11 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  panel: { backgroundColor: COLORS.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 12 },
  title: { fontSize: 16, fontWeight: '800', color: COLORS.textPrimary },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowLabel: { flex: 1, color: COLORS.textSecondary, fontSize: 15 },
  badge: { fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeLive: { backgroundColor: COLORS.success + '30', color: COLORS.success },
  badgePaused: { backgroundColor: COLORS.error + '30', color: COLORS.error },
  counts: { maxHeight: 140, backgroundColor: COLORS.background, borderRadius: 8, padding: 8 },
  countRow: { color: COLORS.textMuted, fontSize: 13, paddingVertical: 2 },
  countNum: { color: COLORS.textPrimary, fontWeight: '600' },
  actionBtn: { backgroundColor: COLORS.background, borderRadius: 10, padding: 12, alignItems: 'center' },
  actionBtnAccent: { backgroundColor: COLORS.primary + '40' },
  actionBtnText: { color: COLORS.textSecondary, fontWeight: '600' },
  closeBtn: { backgroundColor: COLORS.primary, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 4 },
  closeBtnText: { color: '#fff', fontWeight: '700' },
});
