import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, TextInput, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../../store/authStore';
import { useConnectStore } from '../../../store/connectStore';
import { useFriendStore, isOnline, sortByPresence } from '../../../store/friendStore';
import { openDirectChat } from '../../../lib/directMessages';
import { createGroup, GROUP_MAX_MEMBERS } from '../../../lib/chat';
import { logError } from '../../../lib/errorLogger';
import { showAlert } from '../../../lib/confirm';
import { avatarGradient } from '../../../lib/avatars';
import { TYPE } from '../../../lib/typography';
import { RADII, inkOn } from '../../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../../lib/touchTargets';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { FeatureGate } from '../../../components/features/FeatureGate';
import { GROUP_EMOJIS, GROUP_TITLE_MAX } from '../../../lib/groupInfo';
import { BusySwap, RowsSkeleton } from '../../../components/messages/LoadingShapes';

// Shared with Group info (app/chat/info/[id].tsx); kept exported from here for
// anything that imported it before it moved to lib/groupInfo.
export { GROUP_EMOJIS };

/**
 * New message — one friend for a 1:1, two or more for a private group.
 *
 * Only friends are listed: a group can only be made of people who already
 * know you (the server re-checks friendship, blocks both ways, each person's
 * "allow group adds" setting and the 32-person cap — this screen never has
 * the last word). A stranger is reached from her profile, as a request.
 */
function NewMessageScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { user } = useAuthStore();
  const { friends, fetchAll } = useFriendStore();
  const refreshInbox = useConnectStore((s) => s.refresh);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [groupName, setGroupName] = useState('');
  const [emoji, setEmoji] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!user) return;
    setLoading(true);
    fetchAll(user.id).finally(() => setLoading(false));
  }, [user?.id]);

  const sorted = useMemo(() => sortByPresence(friends), [friends]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((f) =>
      `${f.profile.display_name ?? ''} ${f.profile.username ?? ''}`.toLowerCase().includes(q),
    );
  }, [sorted, query]);
  const byId = useMemo(() => new Map(friends.map((f) => [f.profile.id, f.profile])), [friends]);

  const isGroup = picked.length >= 2;
  // She is the 32nd member.
  const atCap = picked.length >= GROUP_MAX_MEMBERS - 1;

  const toggle = (id: string) => {
    // No haptic (motion spec §3.3: only the mapped events buzz).
    setPicked((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= GROUP_MAX_MEMBERS - 1) return prev;
      return [...prev, id];
    });
  };

  const go = async () => {
    if (!user || busy || picked.length === 0) return;
    setBusy(true);
    try {
      let convId: string;
      if (picked.length === 1) {
        convId = await openDirectChat(user.id, picked[0]);
      } else {
        const title = groupName.trim().slice(0, GROUP_TITLE_MAX) || null;
        convId = await createGroup(title, picked, emoji);
        void refreshInbox();
      }
      router.replace(`/chat/${convId}` as never);
    } catch (e) {
      logError(e, 'newMessage.go');
      // lib/chat already turned the server's refusal into words for her.
      const msg = e instanceof Error && e.message ? e.message : 'Something went wrong on our side — try again in a moment 💜';
      showAlert("Couldn't start that chat", msg);
    } finally {
      setBusy(false);
    }
  };

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingHorizontal: 16, paddingVertical: 12,
      borderBottomWidth: 1, borderBottomColor: colors.surface,
    },
    backBtn: { minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
    headerTitle: { ...TYPE.title, color: colors.textPrimary, flex: 1 },
    go: {
      minHeight: 36, paddingHorizontal: 16, borderRadius: RADII.pill,
      backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
    },
    goOff: { backgroundColor: colors.surfaceLight },
    goText: { ...TYPE.caption, color: inkOn(colors.primary), fontWeight: '800' },
    goTextOff: { color: colors.textMuted },
    search: {
      flexDirection: 'row', alignItems: 'center', gap: 9,
      backgroundColor: colors.surface, borderRadius: 14,
      marginHorizontal: 14, marginTop: 10, marginBottom: 6,
      paddingHorizontal: 13, paddingVertical: 9,
      borderWidth: 1, borderColor: colors.line,
    },
    searchInput: { ...TYPE.body, color: colors.textPrimary, flex: 1 },
    chips: { paddingHorizontal: 14, paddingVertical: 6, gap: 6 },
    chip: {
      flexDirection: 'row', alignItems: 'center', gap: 5,
      paddingLeft: 10, paddingRight: 6, height: 30, borderRadius: RADII.pill,
      backgroundColor: colors.surfaceLight, borderWidth: 1, borderColor: colors.line,
    },
    chipText: { ...TYPE.caption, color: colors.textPrimary, fontWeight: '700' },
    builder: {
      marginHorizontal: 14, marginVertical: 6, padding: 12, gap: 10,
      borderRadius: RADII.lg, backgroundColor: colors.surface,
      borderWidth: 1, borderColor: colors.line,
    },
    builderRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    builderAva: {
      width: 44, height: 44, borderRadius: RADII.pill,
      alignItems: 'center', justifyContent: 'center',
    },
    builderEmoji: { fontSize: 22 },
    nameInput: {
      ...TYPE.bodyLg, color: colors.textPrimary, flex: 1,
      paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line,
    },
    emojis: { gap: 6 },
    emojiBtn: {
      width: 38, height: 38, borderRadius: RADII.pill,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surfaceLight,
    },
    emojiOn: { borderWidth: 2, borderColor: colors.primary },
    emojiText: { fontSize: 18 },
    builderNote: { ...TYPE.micro, color: colors.textMuted, lineHeight: 15 },
    hint: {
      ...TYPE.micro, color: colors.textMuted, fontWeight: '700',
      paddingHorizontal: 18, paddingTop: 10, paddingBottom: 6, letterSpacing: 0.6,
    },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingHorizontal: 18, paddingVertical: 10, minHeight: MIN_TOUCH_TARGET + 12,
    },
    avatarWrap: { position: 'relative' },
    avatar: {
      width: 44, height: 44, borderRadius: 22,
      alignItems: 'center', justifyContent: 'center',
    },
    avatarText: { color: '#fff', fontWeight: '800', fontSize: 16 },
    onlineDot: {
      position: 'absolute', bottom: 0, right: 0,
      width: 11, height: 11, borderRadius: 6,
      backgroundColor: colors.success,
      borderWidth: 2, borderColor: colors.background,
    },
    rowInfo: { flex: 1 },
    rowName: { ...TYPE.bodyLg, color: colors.textPrimary, fontWeight: '700' },
    rowSub: { ...TYPE.caption, color: colors.textMuted, marginTop: 1 },
    check: {
      width: 24, height: 24, borderRadius: 12,
      borderWidth: 2, borderColor: colors.lineStrong,
      alignItems: 'center', justifyContent: 'center',
    },
    checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
    emptyIcon: { fontSize: 44 },
    emptyText: { ...TYPE.body, color: colors.textMuted, textAlign: 'center', lineHeight: 20 },
    emptyCTA: {
      backgroundColor: colors.roxy, borderRadius: 20,
      paddingHorizontal: 20, paddingVertical: 10,
    },
    emptyCTAText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  });

  const goLabel = isGroup ? 'Create group' : 'Chat';
  const canGo = picked.length > 0 && !busy;

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn} accessibilityLabel="Back">
            <Ionicons name="arrow-back-outline" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>{isGroup ? 'New group' : 'New message'}</Text>
          <TouchableOpacity
            onPress={() => void go()}
            disabled={!canGo}
            style={[s.go, !canGo && s.goOff]}
            accessibilityRole="button"
            accessibilityLabel={goLabel}
            accessibilityState={{ disabled: !canGo, busy }}
            testID="new-message-go"
          >
            <BusySwap busy={busy} onFill label={goLabel}>
              <Text style={[s.goText, !canGo && s.goTextOff]}>{goLabel}</Text>
            </BusySwap>
          </TouchableOpacity>
        </View>

        <View style={s.search}>
          <Ionicons name="search-outline" size={15} color={colors.textMuted} />
          <TextInput
            style={s.searchInput}
            placeholder="Search friends"
            placeholderTextColor={colors.textMuted}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            testID="new-message-search"
          />
        </View>

        {picked.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips} style={{ flexGrow: 0 }}>
            {picked.map((id) => (
              <TouchableOpacity
                key={id}
                style={s.chip}
                onPress={() => toggle(id)}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${byId.get(id)?.display_name ?? 'friend'}`}
              >
                <Text style={s.chipText}>{byId.get(id)?.display_name ?? '?'}</Text>
                <Ionicons name="close-circle" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : null}

        {isGroup ? (
          <View style={s.builder} testID="group-builder">
            <View style={s.builderRow}>
              <LinearGradient colors={avatarGradient(groupName || 'group')} style={s.builderAva}>
                <Text style={s.builderEmoji}>{emoji ?? '👯'}</Text>
              </LinearGradient>
              <TextInput
                style={s.nameInput}
                placeholder="Name the group (optional)"
                placeholderTextColor={colors.textMuted}
                value={groupName}
                onChangeText={setGroupName}
                maxLength={GROUP_TITLE_MAX}
                testID="group-name"
                accessibilityLabel="Group name"
              />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.emojis}>
              {GROUP_EMOJIS.map((e) => (
                <TouchableOpacity
                  key={e}
                  onPress={() => setEmoji((cur) => (cur === e ? null : e))}
                  style={[s.emojiBtn, emoji === e && s.emojiOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: emoji === e }}
                  accessibilityLabel={`Group emoji ${e}`}
                  testID={`group-emoji-${e}`}
                >
                  <Text style={s.emojiText}>{e}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={s.builderNote}>
              {atCap
                ? `Groups are capped at ${GROUP_MAX_MEMBERS}, you included.`
                : 'Only friends who allow group adds can be added. New people won\'t see earlier messages.'}
            </Text>
          </View>
        ) : null}

        {/* F7: friends already in memory show at once; F8: rows on a first load. */}
        {loading && friends.length === 0 ? (
          <RowsSkeleton testID="new-message-loading" label="Loading your friends" rows={5} />
        ) : (
          <FlatList
            data={visible}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ flexGrow: 1, paddingBottom: 24 }}
            ListHeaderComponent={
              friends.length > 0 ? <Text style={s.hint}>FRIENDS · PICK 2+ FOR A GROUP</Text> : null
            }
            ListEmptyComponent={
              friends.length === 0 ? (
                <View style={s.empty}>
                  <Text style={s.emptyIcon}>🌸</Text>
                  <Text style={s.emptyText}>
                    Add friends in your communities first — chats start with people you already know.
                  </Text>
                  <TouchableOpacity style={s.emptyCTA} onPress={() => router.push('/communities' as never)}>
                    <Text style={s.emptyCTAText}>Find your communities →</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={s.empty}><Text style={s.emptyText}>No friends match “{query}”.</Text></View>
              )
            }
            renderItem={({ item }) => {
              const name = item.profile.display_name ?? '?';
              const on = picked.includes(item.profile.id);
              const disabled = !on && atCap;
              return (
                <TouchableOpacity
                  style={[s.row, disabled && { opacity: 0.45 }]}
                  onPress={() => toggle(item.profile.id)}
                  activeOpacity={0.7}
                  disabled={busy || disabled}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on, disabled }}
                  accessibilityLabel={name}
                  testID={`friend-${item.profile.id}`}
                >
                  <View style={s.avatarWrap}>
                    <LinearGradient colors={avatarGradient(name)} style={s.avatar}>
                      <Text style={s.avatarText}>{name[0]?.toUpperCase() ?? '?'}</Text>
                    </LinearGradient>
                    {isOnline(item.profile.last_seen_at ?? null) && <View style={s.onlineDot} />}
                  </View>
                  <View style={s.rowInfo}>
                    <Text style={s.rowName}>{name}</Text>
                    <Text style={s.rowSub}>@{item.profile.username}</Text>
                  </View>
                  <View style={[s.check, on && s.checkOn]}>
                    {on ? <Ionicons name="checkmark" size={15} color={inkOn(colors.primary)} /> : null}
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export default function NewMessageRoute() {
  return (
    <FeatureGate feature="dms">
      <NewMessageScreen />
    </FeatureGate>
  );
}
