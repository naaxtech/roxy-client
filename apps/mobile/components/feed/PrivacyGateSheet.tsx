import React from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';

interface PrivacyGateSheetProps {
  visible: boolean;
  communityName: string;
  onRequestJoin: () => void;
  onClose: () => void;
}

export function PrivacyGateSheet({
  visible, communityName, onRequestJoin, onClose,
}: PrivacyGateSheetProps) {
  const colors = useThemeColors();

  const styles = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 24, borderTopRightRadius: 24,
      padding: 28, alignItems: 'center',
    },
    handle: {
      width: 40, height: 4, backgroundColor: colors.textMuted,
      borderRadius: 2, marginBottom: 20,
    },
    lockIcon: { fontSize: 40, marginBottom: 12 },
    title: { color: colors.textMuted, fontSize: 14 },
    communityName: {
      color: colors.textPrimary, fontWeight: '700', fontSize: 18,
      textAlign: 'center', marginTop: 4,
    },
    subtitle: { color: colors.textMuted, fontSize: 14, marginBottom: 8 },
    body: {
      color: colors.textSecondary, fontSize: 14,
      textAlign: 'center', marginBottom: 24,
    },
    primaryBtn: {
      width: '100%', backgroundColor: colors.primary,
      paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginBottom: 10,
    },
    primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
    cancelBtn: { width: '100%', paddingVertical: 12, alignItems: 'center' },
    cancelBtnText: { color: colors.textMuted, fontSize: 15 },
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.lockIcon}>🔒</Text>
        <Text style={styles.title}>This is inside</Text>
        <Text style={styles.communityName}>"{communityName}"</Text>
        <Text style={styles.subtitle}>a private community.</Text>
        <Text style={styles.body}>Join to access content and participate.</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={onRequestJoin}>
          <Text style={styles.primaryBtnText}>Request to Join</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
          <Text style={styles.cancelBtnText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}
