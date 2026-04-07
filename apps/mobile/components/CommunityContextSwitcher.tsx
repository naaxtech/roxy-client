import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, TextInput, FlatList,
  Animated,
} from 'react-native';
import { useCommunityFilterStore } from '../store/communityFilterStore';
import { COLORS } from '../lib/constants';

type CommunityOption = { id: string; name: string };

interface Props {
  communities: CommunityOption[];
}

export function CommunityContextSwitcher({ communities }: Props) {
  const { selectedCommunityId, setSelectedCommunity } = useCommunityFilterStore();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const slideAnim = useRef(new Animated.Value(300)).current; // starts off-screen below

  // Slide the sheet up when the modal opens
  useEffect(() => {
    if (open) {
      slideAnim.setValue(300);
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 4,
        speed: 14,
      }).start();
    }
  }, [open]);

  const selected = communities.find((c) => c.id === selectedCommunityId);
  const rawLabel = selected ? selected.name : 'All';
  const label = rawLabel.length > 12 ? rawLabel.slice(0, 10) + '… ▾' : rawLabel + ' ▾';

  const filtered = search
    ? communities.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
    : communities;

  const handleSelect = (id: string | null) => {
    setSelectedCommunity(id);
    setOpen(false);
    setSearch('');
  };

  type Row = { id: string | null; name: string };
  const allOption: Row = { id: null, name: 'All Communities' };
  const rows: Row[] = search ? filtered : [allOption, ...filtered];

  return (
    <>
      <TouchableOpacity
        style={styles.btn}
        onPress={() => setOpen(true)}
        activeOpacity={0.75}
        testID="community-switcher-btn"
      >
        <Text style={styles.btnText} numberOfLines={1}>{label}</Text>
      </TouchableOpacity>

      <Modal
        visible={open}
        animationType="none"
        transparent
        onRequestClose={() => { setOpen(false); setSearch(''); }}
      >
        {/* Overlay appears instantly — only the sheet slides up */}
        <TouchableOpacity
          style={styles.overlay}
          activeOpacity={1}
          onPress={() => { setOpen(false); setSearch(''); }}
        >
          <Animated.View
            style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>View a Community</Text>
            <TextInput
              style={styles.searchInput}
              placeholder="Search your communities..."
              placeholderTextColor={COLORS.textMuted}
              value={search}
              onChangeText={setSearch}
              testID="community-search-input"
              autoCorrect={false}
            />
            <FlatList
              data={rows}
              keyExtractor={(item) => item.id ?? '__all__'}
              style={styles.list}
              renderItem={({ item }) => {
                const isSelected = item.id === selectedCommunityId;
                return (
                  <TouchableOpacity
                    style={styles.row}
                    onPress={() => handleSelect(item.id)}
                    testID={`community-option-${item.id ?? 'all'}`}
                  >
                    <View style={[styles.radio, isSelected && styles.radioSelected]} />
                    <Text style={[styles.rowText, isSelected && styles.rowTextSelected]}>
                      {item.name}
                    </Text>
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <Text style={styles.emptyText}>No communities match</Text>
              }
            />
          </Animated.View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  btn: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: COLORS.primary + '60',
    maxWidth: 160,
  },
  btnText: {
    color: COLORS.primary,
    fontWeight: '700',
    fontSize: 12,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 40,
    maxHeight: '70%',
  },
  handle: {
    width: 40, height: 4,
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetTitle: {
    color: COLORS.textPrimary,
    fontWeight: '800',
    fontSize: 16,
    marginBottom: 12,
  },
  searchInput: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    color: COLORS.textPrimary,
    fontSize: 14,
    marginBottom: 12,
  },
  list: { flexGrow: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.surfaceLight,
  },
  radio: {
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 2, borderColor: COLORS.textMuted,
  },
  radioSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary,
  },
  rowText: { color: COLORS.textSecondary, fontSize: 14, flex: 1 },
  rowTextSelected: { color: COLORS.textPrimary, fontWeight: '700' },
  emptyText: {
    color: COLORS.textMuted, fontSize: 13,
    paddingVertical: 16, textAlign: 'center',
  },
});
