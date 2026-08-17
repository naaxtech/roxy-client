import { useEffect, useRef, useState } from 'react';
import { TouchableOpacity, StyleSheet, Animated, View, Text, Modal, Pressable, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, usePathname } from 'expo-router';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useCommunityStore } from '../../store/communityStore';
import { useCommunityFilterStore } from '../../store/communityFilterStore';
import { BRAND_GRADIENT } from '../../lib/theme';

interface Props {
  visible?: boolean;
}

// "Filter this view" only makes sense where a CommunityContextSwitcher lives.
const FILTERABLE_SEGMENTS = ['/connect', '/build'];

export function RoxyCompanionButton({ visible = true }: Props) {
  const colors = useThemeColors();
  const router = useRouter();
  const pathname = usePathname();
  const canFilter = FILTERABLE_SEGMENTS.some((seg) => pathname.includes(seg));

  const joinedCommunities = useCommunityStore((s) => s.joinedCommunities);
  const selectedCommunityId = useCommunityFilterStore((s) => s.selectedCommunityId);
  const setSelectedCommunity = useCommunityFilterStore((s) => s.setSelectedCommunity);

  const fabOpacity = useRef(new Animated.Value(0)).current;
  const fabTranslateY = useRef(new Animated.Value(20)).current;

  const [open, setOpen] = useState(false);
  const [filterExpanded, setFilterExpanded] = useState(false);
  const scrimOpacity = useRef(new Animated.Value(0)).current;
  const pillAnims = useRef(
    [0, 1, 2].map(() => ({
      translateY: new Animated.Value(24),
      opacity: new Animated.Value(0),
    }))
  ).current;

  // Entrance animation for the FAB itself — unchanged from the original.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fabOpacity, { toValue: 1, duration: 300, delay: 400, useNativeDriver: true }),
      Animated.timing(fabTranslateY, { toValue: 0, duration: 300, delay: 400, useNativeDriver: true }),
    ]).start();
  }, []);

  // Pop-out stack animation: dim scrim fade + staggered spring pills.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) {
      setFilterExpanded(false);
      return;
    }
    scrimOpacity.setValue(0);
    Animated.timing(scrimOpacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    pillAnims.forEach((anim, i) => {
      anim.translateY.setValue(24);
      anim.opacity.setValue(0);
      Animated.parallel([
        Animated.spring(anim.translateY, {
          toValue: 0, friction: 7, tension: 140, delay: i * 60, useNativeDriver: true,
        }),
        Animated.timing(anim.opacity, {
          toValue: 1, duration: 200, delay: i * 60, useNativeDriver: true,
        }),
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
      <Animated.View style={[styles.fabWrap, { opacity: fabOpacity, transform: [{ translateY: fabTranslateY }] }]}>
        <TouchableOpacity
          testID="fab-button"
          style={styles.button}
          onPress={() => setOpen(true)}
          onLongPress={goToChat}
          activeOpacity={0.85}
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

      <Modal visible={open} transparent animationType="fade" onRequestClose={closeSheet}>
        <Pressable style={styles.scrim} onPress={closeSheet} accessibilityLabel="Close Roxy menu">
          <Animated.View style={[styles.scrimFill, { opacity: scrimOpacity }]} />
        </Pressable>

        <View style={styles.sheetWrap} pointerEvents="box-none">
          <Animated.View
            style={[styles.pill, { opacity: pillAnims[0].opacity, transform: [{ translateY: pillAnims[0].translateY }] }]}
          >
            <TouchableOpacity style={styles.pillTouchable} onPress={goToChat} accessibilityLabel="Chat with Roxy">
              <Text style={styles.pillEmoji}>✦</Text>
              <Text style={styles.pillText}>Chat with Roxy</Text>
            </TouchableOpacity>
          </Animated.View>

          <Animated.View
            style={[styles.pill, { opacity: pillAnims[1].opacity, transform: [{ translateY: pillAnims[1].translateY }] }]}
          >
            <TouchableOpacity style={styles.pillTouchable} onPress={goToSearch} accessibilityLabel="Search Roxy">
              <Ionicons name="search" size={16} color={colors.roxy} />
              <Text style={styles.pillText}>Search Roxy</Text>
            </TouchableOpacity>
          </Animated.View>

          <Animated.View
            style={[styles.pill, { opacity: pillAnims[2].opacity, transform: [{ translateY: pillAnims[2].translateY }] }]}
          >
            <TouchableOpacity
              style={[styles.pillTouchable, !canFilter && styles.pillDisabled]}
              onPress={handleFilterPress}
              accessibilityLabel="Filter this view"
              accessibilityHint={canFilter ? undefined : 'Works on Connect & Build'}
              accessibilityState={{ disabled: !canFilter }}
            >
              <Ionicons name="options" size={16} color={canFilter ? colors.roxy : colors.textMuted} />
              <Text style={[styles.pillText, !canFilter && styles.pillTextDisabled]}>Filter this view</Text>
            </TouchableOpacity>
            {!canFilter && <Text style={styles.pillHint}>Works on Connect & Build</Text>}

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
