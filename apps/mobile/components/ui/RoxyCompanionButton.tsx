import { useEffect, useRef, useState } from 'react';
import { TouchableOpacity, StyleSheet, Animated, View, Text, Modal, Pressable, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useCommunityStore } from '../../store/communityStore';
import { useCommunityFilterStore } from '../../store/communityFilterStore';
import { BRAND_GRADIENT } from '../../lib/theme';
import { PRESS_SPRING, SNAP_SPRING } from '../../lib/motion';
import { a11yState } from '../../lib/a11yState';

interface Props {
  visible?: boolean;
}

// Whether "Filter this view" can do anything is not a property of the route.
//
// It used to be decided by matching the pathname — first against `/connect` and
// `/build`, two tabs the 3.0 shell retired, and then against `/feed`. Both were
// wrong in the same way: the Feed honours a community filter on ONE of its
// three segments, and a pathname cannot tell them apart. On For You the action
// rendered enabled, opened the radio list, wrote a selection and changed
// nothing on screen. The filterable surface now says so itself, in
// `communityFilterStore`.

export function RoxyCompanionButton({ visible = true }: Props) {
  const colors = useThemeColors();
  const router = useRouter();

  const joinedCommunities = useCommunityStore((s) => s.joinedCommunities);
  const canFilter = useCommunityFilterStore((s) => s.filterable);
  const selectedCommunityId = useCommunityFilterStore((s) => s.selectedCommunityId);
  const setSelectedCommunity = useCommunityFilterStore((s) => s.setSelectedCommunity);

  const fabScale = useRef(new Animated.Value(0.55)).current;

  const [open, setOpen] = useState(false);
  const [filterExpanded, setFilterExpanded] = useState(false);
  const pillAnims = useRef(
    [0, 1, 2].map(() => ({
      translateY: new Animated.Value(18),
      scale: new Animated.Value(0.7),
    }))
  ).current;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    Animated.spring(fabScale, { toValue: 1, ...PRESS_SPRING }).start();
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) {
      setFilterExpanded(false);
      return;
    }
    pillAnims.forEach((anim, i) => {
      anim.translateY.setValue(18);
      anim.scale.setValue(0.7);
      Animated.parallel([
        Animated.spring(anim.translateY, { toValue: 0, delay: i * 40, ...SNAP_SPRING }),
        Animated.spring(anim.scale, { toValue: 1, delay: i * 40, ...SNAP_SPRING }),
      ]).start();
    });
  }, [open]);

  const styles = StyleSheet.create({
    fabWrap: { position: 'absolute', bottom: 90, right: 20, zIndex: 1000 },
    button: {
      width: 56, height: 56, borderRadius: 28,
      alignItems: 'center', justifyContent: 'center',
      shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3, shadowRadius: 6, elevation: 8,
      overflow: 'hidden',
    },
    buttonGradient: {
      width: '100%', height: '100%',
      alignItems: 'center', justifyContent: 'center',
    },
    icon: { width: 34, height: 34 },
    scrim: { flex: 1 },
    scrimFill: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
    sheetWrap: {
      position: 'absolute', bottom: 158, right: 20,
      alignItems: 'flex-end', gap: 12,
    },
    pill: {
      backgroundColor: colors.surface,
      borderRadius: 24,
      shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.2, shadowRadius: 6, elevation: 6,
      minWidth: 170,
    },
    pillTouchable: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      paddingHorizontal: 18, paddingVertical: 12, minHeight: 44,
    },
    pillDisabled: { opacity: 0.55 },
    pillEmoji: { fontSize: 15, color: colors.roxy },
    pillText: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
    pillTextDisabled: { color: colors.textMuted },
    pillHint: {
      color: colors.textMuted, fontSize: 11, fontWeight: '600',
      paddingHorizontal: 18, paddingBottom: 10, marginTop: -8,
    },
    communityList: {
      borderTopWidth: 1, borderTopColor: colors.surfaceLight,
      paddingTop: 6, paddingBottom: 6,
    },
    communityRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      paddingHorizontal: 18, paddingVertical: 10, minHeight: 40,
    },
    radio: {
      width: 16, height: 16, borderRadius: 8,
      borderWidth: 2, borderColor: colors.textMuted,
    },
    radioSelected: { borderColor: colors.roxy, backgroundColor: colors.roxy },
    communityRowText: { color: colors.textSecondary, fontSize: 13, flex: 1 },
    communityEmpty: {
      color: colors.textMuted, fontSize: 12,
      paddingHorizontal: 18, paddingVertical: 10,
    },
  });

  if (!visible) return null;

  const closeSheet = () => setOpen(false);

  const goToChat = () => {
    setOpen(false);
    router.push('/roxy-chat' as any);
  };

  const goToSearch = () => {
    setOpen(false);
    router.push('/search' as any);
  };

  const handleFilterPress = () => {
    if (!canFilter) return;
    setFilterExpanded((v) => !v);
  };

  const handleSelectCommunity = (id: string | null) => {
    setSelectedCommunity(id);
    setOpen(false);
  };

  return (
    <>
      <Animated.View style={[styles.fabWrap, { transform: [{ scale: fabScale }] }]}>
        <TouchableOpacity
          testID="fab-button"
          style={styles.button}
          onPress={() => setOpen(true)}
          onLongPress={goToChat}
          activeOpacity={1}
          accessibilityLabel="Roxy companion menu"
        >
          <LinearGradient colors={BRAND_GRADIENT} style={styles.buttonGradient}>
            <ExpoImage
              source={require('../../assets/brand/roxy-icon.png')}
              style={styles.icon}
              contentFit="contain"
              // White mark on the brand gradient (colored-on-colored didn't read).
              tintColor="#FFFFFF"
              accessibilityLabel="Roxy"
            />
          </LinearGradient>
        </TouchableOpacity>
      </Animated.View>

      <Modal visible={open} transparent animationType="none" onRequestClose={closeSheet}>
        <Pressable style={styles.scrim} onPress={closeSheet} accessibilityLabel="Close Roxy menu">
          <View style={styles.scrimFill} />
        </Pressable>

        <View style={styles.sheetWrap} pointerEvents="box-none">
          <Animated.View
            style={[styles.pill, { transform: [{ translateY: pillAnims[0].translateY }, { scale: pillAnims[0].scale }] }]}
          >
            <TouchableOpacity style={styles.pillTouchable} onPress={goToChat} accessibilityLabel="Chat with Roxy">
              <Text style={styles.pillEmoji}>✦</Text>
              <Text style={styles.pillText}>Chat with Roxy</Text>
            </TouchableOpacity>
          </Animated.View>

          <Animated.View
            style={[styles.pill, { transform: [{ translateY: pillAnims[1].translateY }, { scale: pillAnims[1].scale }] }]}
          >
            <TouchableOpacity style={styles.pillTouchable} onPress={goToSearch} accessibilityLabel="Search Roxy">
              <Ionicons name="search" size={16} color={colors.roxy} />
              <Text style={styles.pillText}>Search Roxy</Text>
            </TouchableOpacity>
          </Animated.View>

          <Animated.View
            style={[styles.pill, { transform: [{ translateY: pillAnims[2].translateY }, { scale: pillAnims[2].scale }] }]}
          >
            <TouchableOpacity
              style={[styles.pillTouchable, !canFilter && styles.pillDisabled]}
              onPress={handleFilterPress}
              accessibilityLabel="Filter this view"
              accessibilityHint={canFilter ? undefined : 'Works on Feed › Communities'}
              {...a11yState({ disabled: !canFilter })}
            >
              <Ionicons name="options" size={16} color={canFilter ? colors.roxy : colors.textMuted} />
              <Text style={[styles.pillText, !canFilter && styles.pillTextDisabled]}>Filter this view</Text>
            </TouchableOpacity>
            {!canFilter && <Text style={styles.pillHint}>Works on Feed › Communities</Text>}

            {canFilter && filterExpanded && (
              <View style={styles.communityList}>
                <TouchableOpacity
                  style={styles.communityRow}
                  onPress={() => handleSelectCommunity(null)}
                  testID="fab-filter-all"
                  accessibilityLabel="View all communities"
                >
                  <View style={[styles.radio, selectedCommunityId === null && styles.radioSelected]} />
                  <Text style={styles.communityRowText}>All Communities</Text>
                </TouchableOpacity>
                <FlatList
                  data={joinedCommunities}
                  keyExtractor={(c) => c.id}
                  style={{ maxHeight: 160 }}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={styles.communityRow}
                      onPress={() => handleSelectCommunity(item.id)}
                      testID={`fab-filter-${item.id}`}
                      accessibilityLabel={`View ${item.name}`}
                    >
                      <View style={[styles.radio, selectedCommunityId === item.id && styles.radioSelected]} />
                      <Text style={styles.communityRowText} numberOfLines={1}>{item.name}</Text>
                    </TouchableOpacity>
                  )}
                  ListEmptyComponent={
                    <Text style={styles.communityEmpty}>Join a community first 🌸</Text>
                  }
                />
              </View>
            )}
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}
