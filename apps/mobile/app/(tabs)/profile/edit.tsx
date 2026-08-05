// apps/mobile/app/(tabs)/profile/edit.tsx
import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, ActivityIndicator, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../../store/authStore';
import { useProfileStore } from '../../../store/profileStore';
import { supabase } from '../../../lib/supabase';
import { PRONOUNS, IDENTITY_LABELS } from '../../../lib/constants';
import { logError } from '../../../lib/errorLogger';
import { showAlert } from '../../../lib/confirm';
import { isPresetAvatar, presetEmoji, presetColor } from '../../../lib/avatars';
import { uploadImageAsset } from '../../../lib/uploads';
import { AvatarPickerSheet } from '../../../components/profile/AvatarPickerSheet';
import { ProfilePhotoGrid } from '../../../components/profile/ProfilePhotoGrid';
import { ProfileFavorites } from '../../../components/profile/ProfileFavorites';
import { useThemeColors } from '../../../hooks/useThemeColors';
import type { UserBadgeProgress, Badge } from '../../../types';

type EarnedBadge = UserBadgeProgress & { badges: Badge | null };

export default function EditProfileScreen() {
  const { user } = useAuthStore();
  const { profile, updateProfile } = useProfileStore();
  const router = useRouter();
  const colors = useThemeColors();

  const [localBio, setLocalBio] = useState(profile?.bio ?? '');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [badges, setBadges] = useState<EarnedBadge[]>([]);

  useEffect(() => {
    setLocalBio(profile?.bio ?? '');
  }, [profile?.bio]);

  useEffect(() => {
    if (!user?.id) return;
    void Promise.resolve(
      supabase.from('user_badge_progress').select('*, badges(*)').eq('user_id', user.id)
    ).then(({ data }) => { if (data) setBadges(data as EarnedBadge[]); })
      .catch((e) => logError(e, 'editProfile_fetchBadges'));
  }, [user?.id]);

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 16, paddingVertical: 12,
      borderBottomWidth: 1, borderBottomColor: colors.surface,
    },
    backBtn: { width: 40 },
    headerTitle: { flex: 1, textAlign: 'center', color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
    // Bottom padding clears the fixed tab bar + Roxy FAB, same fix as profile/index.tsx.
    scroll: { padding: 16, paddingBottom: 100, gap: 14, alignItems: 'center' },

    avatarSection: { alignItems: 'center', gap: 8 },
    avatarCircle: {
      width: 90, height: 90, borderRadius: 45,
      backgroundColor: colors.roxy, alignItems: 'center', justifyContent: 'center',
    },
    avatarImage: { width: 90, height: 90, borderRadius: 45 },
    avatarInitial: { color: '#fff', fontSize: 36, fontWeight: '700' },
    avatarEmoji: { fontSize: 44 },
    editPhotoText: { color: colors.roxy, fontSize: 13, fontWeight: '600' },

    section: { backgroundColor: colors.surface, borderRadius: 16, padding: 16, width: '100%' },
    label: {
      color: colors.textMuted, fontSize: 12, fontWeight: '600',
      marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5,
    },
    readOnlyText: { color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
    hint: { color: colors.textMuted, fontSize: 11, marginTop: 4 },
    bioInput: {
      color: colors.textPrimary, fontSize: 15,
      minHeight: 72, textAlignVertical: 'top',
    },

    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      backgroundColor: colors.surfaceLight, borderRadius: 20,
      paddingHorizontal: 14, paddingVertical: 7,
      borderWidth: 1, borderColor: colors.textMuted + '60',
    },
    chipSelected: { backgroundColor: colors.roxy, borderColor: colors.roxy },
    chipText: { color: colors.textPrimary, fontSize: 13, fontWeight: '500' },
    chipTextSelected: { color: '#fff', fontWeight: '600' },

    emptyBadges: { color: colors.textMuted, fontSize: 13 },
    badgeRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.surfaceLight,
    },
    badgeRowDim: { opacity: 0.6 },
    badgeEmoji: { fontSize: 24, width: 32 },
    badgeName: { color: colors.textPrimary, fontWeight: '600', fontSize: 13 },
    badgeDesc: { color: colors.textMuted, fontSize: 12, marginTop: 1 },
    badgeEarned: { color: colors.success, fontWeight: '700', fontSize: 16 },
    progressTrack: {
      height: 3, backgroundColor: colors.surfaceLight,
      borderRadius: 2, overflow: 'hidden', marginTop: 4,
    },
    progressFill: { height: 3, backgroundColor: colors.primary, borderRadius: 2 },
  });

  if (!user || !profile) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.roxy} />
      </SafeAreaView>
    );
  }

  const handleUploadPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]) return;
    setAvatarUploading(true);
    try {
      // pathPrefix MUST be `${user.id}`: the avatars bucket RLS checks
      // `auth.uid() = foldername(name)[1]`, so a root-level file (no folder)
      // yields NULL and every upload/upsert is denied. Matches the path
      // onboarding already uses. Bytes go via uploadImageAsset because handing
      // storage-js a Blob on React Native uploads 0 bytes on iOS and throws on
      // Android (see lib/uploads.ts).
      const publicUrl = await uploadImageAsset({
        bucket: 'avatars',
        pathPrefix: user.id,
        fileName: 'avatar.jpg',
        asset: result.assets[0],
        upsert: true,
      });
      await updateProfile({ avatar_url: publicUrl });
    } catch (e) {
      logError(e, 'editProfile_uploadPhoto');
      showAlert('Upload failed', 'Could not upload your photo. Check your connection and try again.');
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleSelectPreset = async (avatarUrl: string) => {
    try {
      await updateProfile({ avatar_url: avatarUrl });
    } catch (e: any) {
      logError(e, 'editProfile_selectPreset');
      showAlert('Error', 'Could not save avatar');
    }
  };

  const togglePronoun = async (pronoun: string) => {
    const current = profile.pronouns ?? [];
    const updated = current.includes(pronoun)
      ? current.filter((p) => p !== pronoun)
      : [...current, pronoun];
    try { await updateProfile({ pronouns: updated }); }
    catch (e) { logError(e, 'editProfile_togglePronoun'); showAlert('Error', 'Could not save pronouns'); }
  };

  // Identity is single-choice: picking one replaces the previous.
  const toggleIdentity = async (label: string) => {
    const current = profile.identity_labels ?? [];
    const updated = current.includes(label) ? [] : [label];
    try { await updateProfile({ identity_labels: updated }); }
    catch (e) { logError(e, 'editProfile_toggleIdentity'); showAlert('Error', 'Could not save identity labels'); }
  };

  const initials = (profile.display_name ?? '?').charAt(0).toUpperCase();
  const hasPreset = isPresetAvatar(profile.avatar_url);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back-outline" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Profile</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Avatar tap → picker sheet */}
        <TouchableOpacity
          style={styles.avatarSection}
          onPress={() => setPickerVisible(true)}
          disabled={avatarUploading}
        >
          {avatarUploading ? (
            <View style={styles.avatarCircle}>
              <ActivityIndicator color={colors.textPrimary} />
            </View>
          ) : hasPreset ? (
            <View style={[styles.avatarCircle, { backgroundColor: presetColor(profile.avatar_url!) }]}>
              <Text style={styles.avatarEmoji}>{presetEmoji(profile.avatar_url!)}</Text>
            </View>
          ) : profile.avatar_url ? (
            <Image source={{ uri: profile.avatar_url }} style={styles.avatarImage} />
          ) : (
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarInitial}>{initials}</Text>
            </View>
          )}
          <Text style={styles.editPhotoText}>Change Photo</Text>
        </TouchableOpacity>

        <ProfilePhotoGrid userId={user.id} editable />
        <ProfileFavorites userId={user.id} editable />

        {/* Display name (read-only) */}
        <View style={styles.section}>
          <Text style={styles.label}>Display Name</Text>
          <Text style={styles.readOnlyText}>{profile.display_name}</Text>
          <Text style={styles.hint}>Set during onboarding — contact support to change</Text>
        </View>

        {/* Bio */}
        <View style={styles.section}>
          <Text style={styles.label}>Bio</Text>
          <TextInput
            style={styles.bioInput}
            multiline
            placeholder="Add a bio..."
            placeholderTextColor={colors.textMuted}
            value={localBio}
            onChangeText={setLocalBio}
            onBlur={async () => {
              try { await updateProfile({ bio: localBio }); }
              catch (e) { logError(e, 'editProfile_saveBio'); showAlert('Error', 'Could not save bio'); }
            }}
            numberOfLines={3}
            textAlignVertical="top"
          />
        </View>

        {/* Pronouns */}
        <View style={styles.section}>
          <Text style={styles.label}>Pronouns</Text>
          <View style={styles.chipRow}>
            {PRONOUNS.map((pronoun) => {
              const selected = (profile.pronouns ?? []).includes(pronoun);
              return (
                <TouchableOpacity
                  key={pronoun}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => togglePronoun(pronoun)}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{pronoun}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Identity */}
        <View style={styles.section}>
          <Text style={styles.label}>Identity</Text>
          <View style={styles.chipRow}>
            {IDENTITY_LABELS.map((lbl) => {
              const selected = (profile.identity_labels ?? []).includes(lbl);
              return (
                <TouchableOpacity
                  key={lbl}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => toggleIdentity(lbl)}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{lbl}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* My Badges */}
        <View style={styles.section}>
          <Text style={styles.label}>My Badges</Text>
          {badges.length === 0 ? (
            <Text style={styles.emptyBadges}>Complete actions to earn badges! ✨</Text>
          ) : (
            badges.map((b) => {
              const earned = b.earned_at !== null;
              const progress = b.badges
                ? Math.min(b.current_value / b.badges.requirement_threshold, 1)
                : 0;
              return (
                <View key={b.badge_id} style={[styles.badgeRow, !earned && styles.badgeRowDim]}>
                  <Text style={styles.badgeEmoji}>{b.badges?.emoji ?? '🏅'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.badgeName}>{b.badges?.name}</Text>
                    <Text style={styles.badgeDesc}>{b.badges?.description}</Text>
                    {!earned && (
                      <View style={styles.progressTrack}>
                        <View style={[styles.progressFill, { width: `${progress * 100}%` as any }]} />
                      </View>
                    )}
                  </View>
                  {earned && <Text style={styles.badgeEarned}>✓</Text>}
                </View>
              );
            })
          )}
        </View>
      </ScrollView>

      <AvatarPickerSheet
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onSelectPreset={handleSelectPreset}
        onUploadPhoto={handleUploadPhoto}
        uploading={avatarUploading}
      />
    </SafeAreaView>
  );
}
