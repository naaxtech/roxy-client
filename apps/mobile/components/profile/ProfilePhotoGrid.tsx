import { useCallback, useEffect, useState } from 'react';
import {
  View, Image, TouchableOpacity, StyleSheet, Text, Alert, ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { useThemeColors } from '../../hooks/useThemeColors';
import { logError } from '../../lib/errorLogger';

const MAX_PHOTOS = 6;
const SLOT = 108;

interface PhotoRow { id: string; photo_url: string; sort_order: number }

interface Props {
  userId: string;
  editable?: boolean;
}

export function ProfilePhotoGrid({ userId, editable = false }: Props) {
  const colors = useThemeColors();
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const styles = StyleSheet.create({
    wrap: { marginTop: 20, paddingHorizontal: 16 },
    label: { color: colors.textMuted, fontSize: 12, fontWeight: '700', letterSpacing: 0.6, marginBottom: 10 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    slot: { width: SLOT, height: SLOT, borderRadius: 10, overflow: 'hidden' },
    img: { width: '100%', height: '100%' },
    add: {
      flex: 1, alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surface, borderRadius: 10,
      borderWidth: 1, borderColor: colors.primary + '50', borderStyle: 'dashed',
    },
    placeholder: { flex: 1, backgroundColor: colors.surface, borderRadius: 10, opacity: 0.35 },
    remove: {
      position: 'absolute', top: 4, right: 4,
      backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 10, padding: 2,
    },
  });

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('profile_photos')
      .select('id, photo_url, sort_order')
      .eq('user_id', userId)
      .order('sort_order', { ascending: true });
    setPhotos((data ?? []) as PhotoRow[]);
    setLoading(false);
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  const addPhoto = async () => {
    if (!editable || photos.length >= MAX_PHOTOS) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [3, 4],
      quality: 0.85,
    });
    if (result.canceled || !result.assets?.[0]) return;

    setUploading(true);
    try {
      const asset = result.assets[0];
      const ext = asset.uri.split('.').pop()?.split('?')[0] ?? 'jpg';
      const path = `${userId}/${Date.now()}.${ext}`;
      const blob = await (await fetch(asset.uri)).blob();
      const { error: upErr } = await supabase.storage
        .from('profile-photos')
        .upload(path, blob, { contentType: asset.mimeType ?? 'image/jpeg', upsert: true });
      if (upErr) throw upErr;

      const { data: pub } = supabase.storage.from('profile-photos').getPublicUrl(path);
      const { error } = await supabase.from('profile_photos').insert({
        user_id: userId,
        photo_url: pub.publicUrl,
        sort_order: photos.length,
      });
      if (error) throw error;
      await load();
    } catch (e) {
      logError(e, 'ProfilePhotoGrid.addPhoto');
      Alert.alert('Upload failed', 'Could not add photo. Try again.');
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = async (row: PhotoRow) => {
    if (!editable) return;
    const storagePrefix = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/public/profile-photos/`;
    if (row.photo_url.startsWith(storagePrefix)) {
      const storagePath = row.photo_url.slice(storagePrefix.length);
      await supabase.storage.from('profile-photos').remove([storagePath]);
    }
    await supabase.from('profile_photos').delete().eq('id', row.id);
    await load();
  };

  if (loading) {
    return <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} />;
  }

  const slots = Array.from({ length: MAX_PHOTOS }, (_, i) => photos[i] ?? null);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Photos</Text>
      <View style={styles.grid}>
        {slots.map((p, i) => (
          <View key={p?.id ?? `empty-${i}`} style={styles.slot}>
            {p ? (
              <>
                <Image source={{ uri: p.photo_url }} style={styles.img} />
                {editable && (
                  <TouchableOpacity style={styles.remove} onPress={() => void removePhoto(p)}>
                    <Ionicons name="close" size={14} color="#fff" />
                  </TouchableOpacity>
                )}
              </>
            ) : editable && i === photos.length ? (
              <TouchableOpacity style={styles.add} onPress={() => void addPhoto()} disabled={uploading}>
                {uploading ? (
                  <ActivityIndicator color={colors.primary} size="small" />
                ) : (
                  <Ionicons name="add" size={28} color={colors.primary} />
                )}
              </TouchableOpacity>
            ) : (
              <View style={styles.placeholder} />
            )}
          </View>
        ))}
      </View>
    </View>
  );
}
