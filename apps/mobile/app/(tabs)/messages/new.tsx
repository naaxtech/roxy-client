import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../../store/authStore';
import { useFriendStore, isOnline, sortByPresence } from '../../../store/friendStore';
import { openDirectChat } from '../../../lib/directMessages';
import { logError } from '../../../lib/errorLogger';
import { showAlert } from '../../../lib/confirm';
import { avatarGradient } from '../../../lib/avatars';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { FeatureGate } from '../../../components/features/FeatureGate';

function NewMessageScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { user } = useAuthStore();
  const { friends, fetchAll } = useFriendStore();
  const [loading, setLoading] = useState(false);
  // Row currently opening a chat — doubles as double-tap guard and spinner flag.
  const [creatingId, setCreatingId] = useState<string | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!user) return;
    setLoading(true);
    fetchAll(user.id).finally(() => setLoading(false));
  }, [user?.id]);

  const startChat = async (partnerId: string) => {
    if (!user || creatingId) return;
    setCreatingId(partnerId);
    try {
      const convId = await openDirectChat(user.id, partnerId);
      router.push(`/chat/${convId}` as any);
    } catch (e: any) {
      logError(e, 'newMessage.startChat');
      showAlert('Could not start the chat', 'Something went wrong on our side — try again in a moment 💜');
    } finally {
      setCreatingId(null);
    }
  };

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingHorizontal: 16, paddingVertical: 12,
      borderBottomWidth: 1, borderBottomColor: colors.surface,
    },
    backBtn: { padding: 4 },
    headerTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
    hint: {
      color: colors.textMuted, fontSize: 12, fontWeight: '600',
      paddingHorizontal: 18, paddingVertical: 10,
      letterSpacing: 0.6, textTransform: 'uppercase',
    },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingHorizontal: 18, paddingVertical: 12,
      borderBottomWidth: 1, borderBottomColor: colors.surfaceLight,
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
    rowName: { color: colors.textPrimary, fontWeight: '700', fontSize: 15 },
    rowSub: { color: colors.textMuted, fontSize: 12, marginTop: 1 },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
    emptyIcon: { fontSize: 44 },
    emptyText: { color: colors.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
    emptyCTA: {
      backgroundColor: colors.roxy, borderRadius: 20,
      paddingHorizontal: 20, paddingVertical: 10,
    },
    emptyCTAText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back-outline" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>New message</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.roxy} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={sortByPresence(friends)}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ flexGrow: 1 }}
          ListHeaderComponent={
            friends.length > 0 ? <Text style={styles.hint}>Your people</Text> : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🌸</Text>
              <Text style={styles.emptyText}>
                Add friends in your communities first — chats start with your people 💜
              </Text>
              <TouchableOpacity
                style={styles.emptyCTA}
                onPress={() => router.push('/communities' as any)}
              >
                <Text style={styles.emptyCTAText}>Find your communities →</Text>
              </TouchableOpacity>
            </View>
          }
          renderItem={({ item }) => {
            const name = item.profile.display_name ?? '?';
            const isCreating = creatingId === item.profile.id;
            return (
              <TouchableOpacity
                style={styles.row}
                onPress={() => void startChat(item.profile.id)}
                activeOpacity={0.7}
                disabled={creatingId !== null}
              >
                <View style={styles.avatarWrap}>
                  <LinearGradient colors={avatarGradient(name)} style={styles.avatar}>
                    <Text style={styles.avatarText}>{name[0]?.toUpperCase() ?? '?'}</Text>
                  </LinearGradient>
                  {isOnline(item.profile.last_seen_at ?? null) && <View style={styles.onlineDot} />}
                </View>
                <View style={styles.rowInfo}>
                  <Text style={styles.rowName}>{name}</Text>
                  <Text style={styles.rowSub}>@{item.profile.username}</Text>
                </View>
                {isCreating
                  ? <ActivityIndicator size="small" color={colors.roxy} />
                  : <Ionicons name="chatbubble-outline" size={18} color={colors.roxy} />}
              </TouchableOpacity>
            );
          }}
        />
      )}
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
