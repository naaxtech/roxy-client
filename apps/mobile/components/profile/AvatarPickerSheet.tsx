import { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Modal, ScrollView, ActivityIndicator,
} from 'react-native';
import { COLORS } from '../../lib/constants';
import { PRESET_AVATARS, PRESET_COLORS } from '../../lib/avatars';

type Tab = 'photo' | 'avatar';

interface AvatarPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  onSelectPreset: (avatarUrl: string) => void;
  onUploadPhoto: () => void;
  uploading: boolean;
}

export function AvatarPickerSheet({
  visible, onClose, onSelectPreset, onUploadPhoto, uploading,
}: AvatarPickerSheetProps) {
  const [tab, setTab] = useState<Tab>('photo');

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />

        <View style={styles.tabs}>
          {(['photo', 'avatar'] as Tab[]).map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.tab, tab === t && styles.tabActive]}
              onPress={() => setTab(t)}
            >
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                {t === 'photo' ? 'Upload Photo' : 'Pick Avatar'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {tab === 'photo' ? (
          <TouchableOpacity
            style={styles.uploadBtn}
            onPress={() => { onUploadPhoto(); onClose(); }}
            disabled={uploading}
          >
            {uploading
              ? <ActivityIndicator color={COLORS.roxy} />
              : <Text style={styles.uploadBtnText}>Choose from Library</Text>
            }
          </TouchableOpacity>
        ) : (
          <ScrollView contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
            {PRESET_AVATARS.map((emoji, i) => (
              <TouchableOpacity
                key={emoji}
                style={[styles.avatarOption, { backgroundColor: PRESET_COLORS[i] + '30', borderColor: PRESET_COLORS[i] }]}
                onPress={() => { onSelectPreset(`avatar://${emoji}`); onClose(); }}
              >
                <Text style={styles.avatarEmoji}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingBottom: 40, paddingTop: 12, maxHeight: '60%',
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: COLORS.textMuted + '60',
    alignSelf: 'center', marginBottom: 16,
  },
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1, borderBottomColor: COLORS.surface,
    marginHorizontal: 20, marginBottom: 16,
  },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: COLORS.roxy },
  tabText: { color: COLORS.textMuted, fontWeight: '600', fontSize: 14 },
  tabTextActive: { color: COLORS.roxy },
  uploadBtn: {
    marginHorizontal: 20, marginTop: 8,
    backgroundColor: COLORS.surface, borderRadius: 14,
    paddingVertical: 16, alignItems: 'center',
  },
  uploadBtnText: { color: COLORS.textPrimary, fontWeight: '600', fontSize: 15 },
  grid: {
    flexDirection: 'row', flexWrap: 'wrap',
    paddingHorizontal: 16, gap: 12, justifyContent: 'center',
  },
  avatarOption: {
    width: 60, height: 60, borderRadius: 30,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2,
  },
  avatarEmoji: { fontSize: 30 },
});
