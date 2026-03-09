import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Image,
  ScrollView, StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../../../store/authStore';
import { useProfileStore } from '../../../../store/profileStore';
import { supabase } from '../../../../lib/supabase';
import { COLORS } from '../../../../lib/constants';

const PRONOUN_PRESETS = ['she/her', 'they/them', 'she/they', 'any/all', 'ask me'];
const IDENTITY_PRESETS = ['lesbian', 'bisexual', 'queer', 'pansexual', 'asexual', 'questioning'];

const getLevel = (pts: number): string => {
  if (pts >= 500) return 'Radiant ✨';
  if (pts >= 100) return 'Bloom 🌸';
  return 'Seedling 🌱';
};

export default function ProfileScreen() {
  const { user } = useAuthStore();
  const { profile, updateProfile } = useProfileStore();
  const router = useRouter();
  const [localBio, setLocalBio] = useState(profile?.bio ?? '');
  const [avatarUploading, setAvatarUploading] = useState(false);

  if (!user || !profile) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={COLORS.roxy} />
      </SafeAreaView>
    );
  }

  const handleAvatarPress = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]) return;
    setAvatarUploading(true);
    try {
      const uri = result.assets[0].uri;
      const response = await fetch(uri);
      const blob = await response.blob();
      const path = `${user.id}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
      if (uploadError) { Alert.alert('Upload failed', uploadError.message); return; }
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      await updateProfile({ avatar_url: data.publicUrl });
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message ?? 'Unknown error');
    } finally {
      setAvatarUploading(false);
    }
  };

  const togglePronoun = async (pronoun: string) => {
    const current = profile.pronouns ?? [];
    const updated = current.includes(pronoun)
      ? current.filter((p) => p !== pronoun)
      : [...current, pronoun];
    try { await updateProfile({ pronouns: updated }); }
    catch { Alert.alert('Error', 'Could not save pronouns'); }
  };

  const toggleIdentity = async (label: string) => {
    const current = profile.identity_labels ?? [];
    const updated = current.includes(label)
      ? current.filter((l) => l !== label)
      : [...current, label];
    try { await updateProfile({ identity_labels: updated }); }
    catch { Alert.alert('Error', 'Could not save identity labels'); }
  };

  const points = profile.gamification_points ?? 0;
  const levelLabel = getLevel(points);
  const initials = (profile.display_name ?? '?').charAt(0).toUpperCase();

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>

        {/* Avatar section */}
        <View style={styles.avatarSection}>
          <TouchableOpacity onPress={handleAvatarPress} style={styles.avatarWrapper} disabled={avatarUploading}>
            {avatarUploading ? (
              <View style={styles.avatarCircle}>
                <ActivityIndicator color={COLORS.textPrimary} />
              </View>
            ) : profile.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={styles.avatarImage} />
            ) : (
              <View style={styles.avatarCircle}>
                <Text style={styles.avatarInitial}>{initials}</Text>
              </View>
            )}
          </TouchableOpacity>
          <Text style={styles.editPhotoText}>Edit Photo</Text>
        </View>

        {/* Name + username */}
        <View style={styles.nameSection}>
          <Text style={styles.displayName}>{profile.display_name}</Text>
          <Text style={styles.username}>@{profile.username}</Text>
        </View>

        {/* Bio */}
        <View style={styles.section}>
          <Text style={styles.label}>Bio</Text>
          <TextInput
            style={styles.bioInput}
            multiline
            placeholder="Add a bio..."
            placeholderTextColor={COLORS.textMuted}
            value={localBio}
            onChangeText={setLocalBio}
            onBlur={() => updateProfile({ bio: localBio })}
            numberOfLines={3}
          />
        </View>

        {/* Pronouns */}
        <View style={styles.section}>
          <Text style={styles.label}>Pronouns</Text>
          <View style={styles.chipRow}>
            {PRONOUN_PRESETS.map((pronoun) => {
              const selected = (profile.pronouns ?? []).includes(pronoun);
              return (
                <TouchableOpacity
                  key={pronoun}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => togglePronoun(pronoun)}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                    {pronoun}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Identity */}
        <View style={styles.section}>
          <Text style={styles.label}>Identity</Text>
          <View style={styles.chipRow}>
            {IDENTITY_PRESETS.map((label) => {
              const selected = (profile.identity_labels ?? []).includes(label);
              return (
                <TouchableOpacity
                  key={label}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => toggleIdentity(label)}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Stats row */}
        <View style={styles.section}>
          <Text style={styles.statsText}>
            {`✨ ${points} pts · ${levelLabel}`}
          </Text>
        </View>

        {/* Settings button */}
        <TouchableOpacity
          style={styles.settingsButton}
          onPress={() => router.push('/(tabs)/profile/settings')}
        >
          <Text style={styles.settingsButtonText}>Settings</Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { padding: 16, gap: 16, alignItems: 'center' },

  // Avatar
  avatarSection: { alignItems: 'center', marginTop: 8 },
  avatarWrapper: { marginBottom: 8 },
  avatarImage: { width: 80, height: 80, borderRadius: 40 },
  avatarCircle: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: COLORS.roxy, alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { color: '#FFFFFF', fontSize: 32, fontWeight: '700' },
  editPhotoText: { color: COLORS.roxy, fontSize: 13, fontWeight: '500' },

  // Name
  nameSection: { alignItems: 'center' },
  displayName: { color: COLORS.textPrimary, fontSize: 22, fontWeight: '700' },
  username: { color: COLORS.textMuted, fontSize: 14, marginTop: 2 },

  // Sections
  section: {
    backgroundColor: COLORS.surface, borderRadius: 16, padding: 16,
    width: '100%',
  },
  label: { color: COLORS.textMuted, fontSize: 12, fontWeight: '600', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },

  // Bio
  bioInput: {
    color: COLORS.textPrimary, fontSize: 15,
    minHeight: 72, textAlignVertical: 'top',
  },

  // Chips
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: COLORS.surface,
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7,
    borderWidth: 1, borderColor: COLORS.textMuted + '60',
  },
  chipSelected: {
    backgroundColor: COLORS.roxy,
    borderColor: COLORS.roxy,
  },
  chipText: { color: COLORS.textPrimary, fontSize: 13, fontWeight: '500' },
  chipTextSelected: { color: '#FFFFFF', fontWeight: '600' },

  // Stats
  statsText: { color: COLORS.textPrimary, fontSize: 15, fontWeight: '600', textAlign: 'center' },

  // Settings button
  settingsButton: {
    width: '100%', backgroundColor: COLORS.surface,
    borderRadius: 16, padding: 16, alignItems: 'center',
    borderWidth: 1, borderColor: COLORS.textMuted + '40',
  },
  settingsButtonText: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '600' },
});
