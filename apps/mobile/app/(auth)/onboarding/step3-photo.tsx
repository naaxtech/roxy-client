import { useState } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/authStore';
import { logError, logBreadcrumb } from '../../../lib/errorLogger';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { RoxyWordmark } from '../../../components/ui/RoxyWordmark';

export default function Step3Photo() {
  const colors = useThemeColors();
  const [uri, setUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const { user } = useAuthStore();
  const router = useRouter();

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled) setUri(result.assets[0].uri);
  };

  const handleNext = async () => {
    if (!user) return;
    if (uri) {
      logBreadcrumb('onboarding_step3_upload_start');
      setUploading(true);
      try {
        const path = `${user.id}/avatar.jpg`;
        const response = await fetch(uri);
        const blob = await response.blob();
        const { error: uploadError } = await supabase.storage.from('avatars').upload(path, blob, { upsert: true });
        if (uploadError) {
          logError(uploadError, 'onboarding_step3_avatar_upload');
        } else {
          const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);
          const { error: updateError } = await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', user.id);
          if (updateError) logError(updateError, 'onboarding_step3_avatar_url_update');
        }
      } catch (e) {
        logError(e, 'onboarding_step3_upload_exception');
      }
      setUploading(false);
    }
    logBreadcrumb('onboarding_step3_complete', { has_photo: String(!!uri) });
    router.replace('/(auth)/onboarding/step4-status');
  };

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { flex: 1, padding: 24, gap: 16 },
    step: { color: colors.textMuted, fontSize: 13 },
    headline: { fontSize: 28, fontWeight: '700', color: colors.textPrimary },
    sub: { color: colors.textSecondary, fontSize: 15 },
    photoBtn: {
      width: 160, height: 160, borderRadius: 80, backgroundColor: colors.surface,
      alignSelf: 'center', alignItems: 'center', justifyContent: 'center', marginTop: 24,
    },
    photoBtnText: { color: colors.textMuted, textAlign: 'center', padding: 16 },
    preview: { width: 160, height: 160, borderRadius: 80 },
    btn: { backgroundColor: colors.primary, borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 'auto' },
    btnDisabled: { opacity: 0.5 },
    btnText: { color: colors.textPrimary, fontWeight: '700', fontSize: 16 },
  });

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <RoxyWordmark height={34} style={{ marginBottom: 10 }} />
        <Text style={styles.step}>Step 3 of 4</Text>
        <Text style={styles.headline}>Add a photo</Text>
        <Text style={styles.sub}>Optional, but it helps people connect with you.</Text>

        <TouchableOpacity style={styles.photoBtn} onPress={pickImage}>
          {uri
            ? <Image source={{ uri }} style={styles.preview} />
            : <Text style={styles.photoBtnText}>Tap to choose photo</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity style={[styles.btn, uploading && styles.btnDisabled]} onPress={handleNext} disabled={uploading}>
          <Text style={styles.btnText}>{uploading ? 'Uploading...' : uri ? 'Next →' : 'Skip for now'}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

