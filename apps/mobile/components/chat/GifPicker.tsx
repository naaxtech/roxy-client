import React, { useCallback, useEffect, useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  FlatList, Image, ActivityIndicator, StyleSheet, Animated,
} from 'react-native';
import { usePopIn } from '../ui/popIn';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useAppWidth, FRAME_MAX_WIDTH } from '../../hooks/useAppWidth';
import { isGiphyConfigured, giphyEndpoint } from '../../lib/giphy';

interface GiphyResult {
  id: string;
  title: string;
  images: {
    fixed_width: { url: string; width: string; height: string };
  };
}

interface GifPickerProps {
  visible: boolean;
  onGifSelected: (url: string) => void;
  onClose: () => void;
}

export function GifPicker({ visible, onGifSelected, onClose }: GifPickerProps) {
  const colors = useThemeColors();
  const pop = usePopIn(visible);
  const appWidth = useAppWidth();
  const COL_WIDTH = (appWidth - 48) / 2;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GiphyResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  // No key was bundled, so every request would 403. Say so instead of showing an
  // empty grid that looks like "no GIFs matched".
  const configured = isGiphyConfigured();

  const search = useCallback(async (q: string) => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch(giphyEndpoint(q));
      const json = await res.json() as { data?: GiphyResult[] };
      if (!Array.isArray(json.data)) {
        setResults([]);
        setFailed(true);
        return;
      }
      setResults(json.data);
    } catch {
      setResults([]);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible && configured) void search('');
  }, [visible, configured, search]);

  useEffect(() => {
    if (!visible || !configured) return;
    const t = setTimeout(() => void search(query), 400);
    return () => clearTimeout(t);
  }, [query, visible, configured, search]);

  const handleSelect = (url: string) => {
    onGifSelected(url);
    onClose();
    setQuery('');
  };

  const styles = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
    container: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      maxHeight: '70%',
      width: '100%', maxWidth: FRAME_MAX_WIDTH, alignSelf: 'center',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.surface,
    },
    headerTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 17 },
    searchInput: {
      margin: 12,
      backgroundColor: colors.surface,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
      color: colors.textPrimary,
      fontSize: 14,
    },
    grid: { paddingHorizontal: 12, paddingBottom: 12 },
    row: { gap: 8, marginBottom: 8 },
    gif: { borderRadius: 8 },
    empty: { color: colors.textMuted, textAlign: 'center', marginTop: 32 },
    unavailable: { alignItems: 'center', paddingHorizontal: 32, paddingVertical: 40, gap: 8 },
    unavailableTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 15, textAlign: 'center' },
    unavailableBody: { color: colors.textMuted, fontSize: 13, lineHeight: 19, textAlign: 'center' },
    poweredBy: {
      color: colors.textMuted,
      fontSize: 10,
      textAlign: 'center',
      paddingBottom: 8,
    },
  });

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <Animated.View style={[styles.container, pop]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>GIFs</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12} accessibilityLabel="Close GIF picker">
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {!configured ? (
          <View style={styles.unavailable}>
            <Ionicons name="image-outline" size={32} color={colors.textMuted} />
            <Text style={styles.unavailableTitle}>GIFs aren&apos;t set up yet</Text>
            <Text style={styles.unavailableBody}>
              Roxy needs a GIPHY key before GIF search works. Everything else in chat is fine —
              photos and emoji still send.
            </Text>
          </View>
        ) : (
          <>
            <TextInput
              style={styles.searchInput}
              placeholder="Search GIFs..."
              placeholderTextColor={colors.textMuted}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
            />

            {loading ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: 32 }} />
            ) : (
              <FlatList
                data={results}
                keyExtractor={(item) => item.id}
                numColumns={2}
                columnWrapperStyle={styles.row}
                contentContainerStyle={styles.grid}
                renderItem={({ item }) => {
                  const w = parseFloat(item.images.fixed_width.width);
                  const h = parseFloat(item.images.fixed_width.height);
                  const displayH = w > 0 ? (COL_WIDTH / w) * h : 150;
                  return (
                    <TouchableOpacity onPress={() => handleSelect(item.images.fixed_width.url)}>
                      <Image
                        source={{ uri: item.images.fixed_width.url }}
                        style={[styles.gif, { width: COL_WIDTH, height: Math.min(displayH, 200) }]}
                        resizeMode="cover"
                      />
                    </TouchableOpacity>
                  );
                }}
                ListEmptyComponent={
                  <Text style={styles.empty}>
                    {failed ? "GIF search isn't responding right now — try again in a moment" : 'No GIFs found'}
                  </Text>
                }
              />
            )}
            <Text style={styles.poweredBy}>Powered by GIPHY</Text>
          </>
        )}
      </Animated.View>
    </Modal>
  );
}
