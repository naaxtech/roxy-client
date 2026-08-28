import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, TextInput, FlatList,
  Animated,
} from 'react-native';
import { useCommunityFilterStore } from '../store/communityFilterStore';
import { useThemeColors } from '../hooks/useThemeColors';
import { FRAME_MAX_WIDTH } from '../hooks/useAppWidth';
import { STAGE } from './feed/stageColors';
import { MIN_TOUCH_TARGET } from '../lib/touchTargets';

type CommunityOption = { id: string; name: string };

interface Props {
  communities: CommunityOption[];
  /**
   * The trigger renders on two different grounds: the themed sheet list
   * (light or dark, whichever the viewer picked) when it opens from the FAB
   * menu, and the Feed tab's permanently-dark stage
   * (`components/feed/stageColors.ts`) when it opens from the feed header.
   * Reading `useThemeColors()` unconditionally repeats the exact bug that
   * file's own comment documents — light-theme ink measured against a dark
   * ground lands under 4.5:1. `onStage` sources the TRIGGER's fill, border
   * and label from `STAGE` instead of the active theme. The sheet below is a
   * full-screen overlay with its own themed background — it is never on the
   * stage, so it keeps `useThemeColors()` unconditionally either way.
   *
   * `STAGE.primaryInk` on `STAGE.surface` measures 7.27:1 as text, and on
   * `STAGE_BG` — the ground the border actually meets — 7.93:1 as a border;
   * both clear their floors (4.5:1 text / 3:1 non-text) with margin.
   * `__tests__/components/CommunityContextSwitcher.test.tsx` holds the
   * arithmetic to AA so this cannot drift silently.
   */
  onStage?: boolean;
}

export function CommunityContextSwitcher({ communities, onStage = false }: Props) {
  const colors = useThemeColors();
  const { selectedCommunityId, setSelectedCommunity } = useCommunityFilterStore();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const popAnim = useRef(new Animated.Value(0.94)).current; // pop, not slide-from-below

  const triggerBg = onStage ? STAGE.surface : colors.surface;
  const triggerBorder = onStage ? STAGE.primaryInk : colors.primary + '60';
  const triggerText = onStage ? STAGE.primaryInk : colors.primary;

  const styles = StyleSheet.create({
    btn: {
      backgroundColor: triggerBg,
      borderRadius: 14,
      paddingHorizontal: 10,
      // Measured, not padded. `paddingVertical: 5` on 12pt text made this ~26pt
      // — barely half the floor, and it now sits in a row beside StreakChip and
      // the Now toggle, both of which are 48. `lib/touchTargets.ts` carries the
      // sources; the short version is that Google's TouchTargetSizeCheck
      // hardcodes 48 and runs against this build in the Play Console
      // pre-launch report.
      minHeight: MIN_TOUCH_TARGET,
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: triggerBorder,
      maxWidth: 160,
    },
    btnText: {
      color: triggerText,
      fontWeight: '700',
      fontSize: 12,
    },
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.6)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      width: '100%', maxWidth: FRAME_MAX_WIDTH, alignSelf: 'center',
      padding: 20,
      paddingBottom: 40,
      maxHeight: '70%',
    },
    handle: {
      width: 40, height: 4,
      backgroundColor: colors.surfaceLight,
      borderRadius: 2,
      alignSelf: 'center',
      marginBottom: 16,
    },
    sheetTitle: {
      color: colors.textPrimary,
      fontWeight: '800',
      fontSize: 16,
      marginBottom: 12,
    },
    searchInput: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 8,
      color: colors.textPrimary,
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
      borderBottomColor: colors.surfaceLight,
    },
    radio: {
      width: 18, height: 18, borderRadius: 9,
      borderWidth: 2, borderColor: colors.textMuted,
    },
    radioSelected: {
      borderColor: colors.primary,
      backgroundColor: colors.primary,
    },
    rowText: { color: colors.textSecondary, fontSize: 14, flex: 1 },
    rowTextSelected: { color: colors.textPrimary, fontWeight: '700' },
    emptyText: {
      color: colors.textMuted, fontSize: 13,
      paddingVertical: 16, textAlign: 'center',
    },
  });

  // Pop the sheet in when the modal opens (no slide-from-below drawers)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (open) {
      popAnim.setValue(0.94);
      Animated.spring(popAnim, {
        toValue: 1,
        useNativeDriver: true,
        friction: 8,
        tension: 220,
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
      {/* The spoken label is built from `rawLabel`, not `label`. `label`
          truncates at 12 characters so the pill fits a feed header — "WLW
          Hikers" and "WLW Hiking Club" both become "WLW Hikin…", which is a
          reasonable thing to show and a useless thing to say. And the visible
          text is a name plus "▾": without a role, a screen reader announces a
          value and never mentions that it is a control at all. */}
      <TouchableOpacity
        style={styles.btn}
        onPress={() => setOpen(true)}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel={
          selectedCommunityId
            ? `Filtering by ${rawLabel}. Change which community you are viewing.`
            : 'All communities. Choose which community you are viewing.'
        }
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
            style={[styles.sheet, { opacity: popAnim, transform: [{ scale: popAnim }] }]}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>View a Community</Text>
            <TextInput
              style={styles.searchInput}
              placeholder="Search your communities..."
              placeholderTextColor={colors.textMuted}
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
