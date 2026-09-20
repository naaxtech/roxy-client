import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Share, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useGamesStore } from '../../../../store/gamesStore';
import { useAuthStore } from '../../../../store/authStore';
import { buildRoxySDK } from '../../../../lib/roxyGameSdk';
import { isPlayableGameUrl } from '../../../../lib/gameUrl';
import { useThemeColors } from '../../../../hooks/useThemeColors';

// react-native-webview guarded import
let WebViewModule: any = null;
try { WebViewModule = require('react-native-webview'); } catch {}
const WebView = WebViewModule?.WebView ?? null;

export default function GameLaunchScreen() {
  const colors = useThemeColors();
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const { games, fetchGameById } = useGamesStore();
  const webViewRef = useRef<any>(null);
  const [resolving, setResolving] = useState(true);

  const game = games.find((g) => g.id === gameId);

  // The tile that got us here holds its own copy of the games list, and a shared
  // link arrives with no list at all — so the route resolves the game itself.
  useEffect(() => {
    if (!gameId) { setResolving(false); return; }
    let active = true;
    void (async () => {
      await fetchGameById(gameId);
      if (active) setResolving(false);
    })();
    return () => { active = false; };
  }, [gameId, fetchGameById]);

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingVertical: 8,
      borderBottomWidth: 1, borderBottomColor: colors.surface,
      backgroundColor: colors.background,
    },
    closeBtn: { padding: 4 },
    gameName: { flex: 1, textAlign: 'center', fontWeight: '700', fontSize: 15, color: colors.textPrimary },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    emptyText: { color: colors.textMuted, fontSize: 15 },
    loadingOverlay: {
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.background,
    },
  });

  if (resolving) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.empty}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  // No row, or a URL we will not hand to a WebView (see lib/gameUrl.ts).
  if (!game || !isPlayableGameUrl(game.url)) {
    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn} hitSlop={8}>
          <Ionicons name="close" size={26} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.empty}>
          <Text style={styles.emptyText}>This game isn&apos;t available to play yet</Text>
        </View>
      </SafeAreaView>
    );
  }

  const sdk = buildRoxySDK({
    id: user?.id ?? '',
    displayName: (user?.user_metadata as any)?.display_name ?? '',
  });

  const handleMessage = (event: any) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'roxy:close') router.back();
      if (msg.type === 'roxy:shareScore') {
        void Share.share({ message: msg.message || `I scored ${msg.score} on ${game.name} in Roxy!` });
      }
    } catch {}
  };

  if (!WebView) {
    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn} hitSlop={8}>
          <Ionicons name="close" size={26} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.empty}>
          <Text style={styles.emptyText}>WebView not available on this platform</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.gameName} numberOfLines={1}>{game.name}</Text>
        <View style={{ width: 32 }} />
      </SafeAreaView>

      <WebView
        ref={webViewRef}
        source={{ uri: game.url }}
        injectedJavaScript={sdk}
        onMessage={handleMessage}
        startInLoadingState
        renderLoading={() => (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        )}
        style={{ flex: 1 }}
      />
    </View>
  );
}

