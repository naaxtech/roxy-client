// apps/mobile/app/(tabs)/you/edit.tsx
import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, ScrollView,
} from 'react-native';
import { TouchableOpacity } from '../../../components/ui/PressableScale';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../../store/authStore';
import { useProfileStore } from '../../../store/profileStore';
import { supabase } from '../../../lib/supabase';
import { PRONOUNS, IDENTITY_LABELS } from '../../../lib/constants';
import { clampCustomTags, MAX_CUSTOM_TAGS } from '../../../lib/profileTags';
import { logError } from '../../../lib/errorLogger';
import { showAlert } from '../../../lib/confirm';
import { uploadImageAsset } from '../../../lib/uploads';
import {
  BIO_MAX, avatarFileError, validateDisplayName, withCacheBust,
} from '../../../lib/profileRules';
import { AvatarPickerSheet } from '../../../components/profile/AvatarPickerSheet';
import { Avatar } from '../../../components/ui/Avatar';
import { ProfilePromptsEditor } from '../../../components/profile/ProfileExtras';
import { ProfilePhotoGrid } from '../../../components/profile/ProfilePhotoGrid';
import { ProfileFavorites } from '../../../components/profile/ProfileFavorites';
import { useThemeColors } from '../../../hooks/useThemeColors';
import type { UserBadgeProgress, Badge } from '../../../types';
import { RoxyLoading, Skeleton, SkeletonGroup } from '../../../components/feedback';
import { BusySwap } from '../../../components/messages/LoadingShapes';

type EarnedBadge = UserBadgeProgress & { badges: Badge | null };

export default function EditProfileScreen() {
  const { user } = useAuthStore();
  const { profile, updateProfile, togglePronoun: storeTogglePronoun, toggleIdentity: storeToggleIdentity } = useProfileStore();
  const router = useRouter();
  const colors = useThemeColors();

  const [localBio, setLocalBio] = useState(profile?.bio ?? '');
  const [nameDraft, setNameDraft] = useState(profile?.display_name ?? '');
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaving, setNameSaving] = useState(false);
  const [tagDraft, setTagDraft] = useState('');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [badges, setBadges] = useState<EarnedBadge[]>([]);

  useEffect(() => {
    setLocalBio(profile?.bio ?? '');
  }, [profile?.bio]);

  useEffect(() => {
    setNameDraft(profile?.display_name ?? '');
  }, [profile?.display_name]);

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
    headerEyebrow: {
      color: colors.primaryInk, fontSize: 10, fontWeight: '800',
      letterSpacing: 1, textTransform: 'uppercase',
    },
    // Bottom padding clears the fixed tab bar + Roxy FAB, same fix as profile/index.tsx.
    scroll: { padding: 16, paddingBottom: 100, gap: 14, alignItems: 'center' },

    avatarSection: { alignItems: 'center', gap: 8 },
    avatarCircle: {
      width: 90, height: 90, borderRadius: 45,
      backgroundColor: colors.roxy, alignItems: 'center', justifyContent: 'center',
    },
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
    tagAddRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
    tagInput: { flex: 1, color: colors.textPrimary, fontSize: 15, minHeight: 40 },
    tagAdd: {
      backgroundColor: colors.roxy, borderRadius: 16,
      paddingHorizontal: 14, paddingVertical: 8,
    },
    tagAddText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  });

  if (!user || !profile) {
    return (
      <SafeAreaView style={styles.container}>
        {/* F8: the editor's shape while her profile loads; F11: no spinner. */}
        <SkeletonGroup testID="edit-loading" accessibilityLabel="Loading your profile" style={{ alignItems: 'center', padding: 24, gap: 14 }}>
          <Skeleton circle={90} />
          <Skeleton width="100%" height={48} radius={12} />
          <Skeleton width="100%" height={96} radius={12} />
        </SkeletonGroup>
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
    // No size or type guard used to exist: a video or a 40 MB HEIC went
    // straight to storage (PRO-04).
    const refused = avatarFileError(result.assets[0]);
    if (refused) { showAlert('Pick another photo', refused); return; }
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
      // Same path every time, so the URL must change or every Image and the
      // CDN keep showing the old photo.
      await updateProfile({ avatar_url: withCacheBust(publicUrl) });
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

  // The store computes each change from the LATEST state and writes them in
  // tap order, so two quick taps both land (PRO-05).
  const togglePronoun = async (pronoun: string) => {
    try { await storeTogglePronoun(pronoun); }
    catch (e) { logError(e, 'editProfile_togglePronoun'); showAlert('Not saved', 'Your pronouns did not save. Check your connection and try again.'); }
  };

  // Identity is single-choice: picking one replaces the previous.
  const toggleIdentity = async (label: string) => {
    try { await storeToggleIdentity(label); }
    catch (e) { logError(e, 'editProfile_toggleIdentity'); showAlert('Not saved', 'Your identity label did not save. Check your connection and try again.'); }
  };

  const saveDisplayName = async () => {
    const { value, error } = validateDisplayName(nameDraft);
    if (error) { setNameError(error); return; }
    if (value === profile.display_name) { setNameError(null); return; }
    setNameSaving(true);
    setNameError(null);
    try {
      await updateProfile({ display_name: value });
    } catch (e) {
      logError(e, 'editProfile_saveName');
      // The 133 trigger refuses a reserved name the client list missed.
      setNameError(/reserved/i.test(e instanceof Error ? e.message : '')
        ? 'That name is reserved for the Roxy team. Pick another.'
        : 'Your name did not save. Check your connection and try again.');
    } finally {
      setNameSaving(false);
    }
  };

  const bioCount = localBio.length;


  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back-outline" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={styles.headerEyebrow}>Voxel · cute mode later</Text>
          <Text style={styles.headerTitle}>Avatar studio</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Avatar tap → picker sheet */}
        <TouchableOpacity
          style={styles.avatarSection}
          onPress={() => setPickerVisible(true)}
          disabled={avatarUploading}
          testID="edit-avatar"
          accessibilityRole="button"
          accessibilityLabel="Change your photo"
        >
          {avatarUploading ? (
            <View style={styles.avatarCircle}>
              <RoxyLoading active size="busy" accessibilityLabel="Uploading your photo" testID="edit-avatar-uploading" />
            </View>
          ) : (
            <Avatar uri={profile.avatar_url} name={profile.display_name} size={90} testID="edit-avatar-face" />
          )}
          <Text style={styles.editPhotoText}>Change Photo</Text>
        </TouchableOpacity>

        {/* Order is deliberate: picture → bio → photos → everything else. Who
            she is reads top-to-bottom before the editing chores (display name,
            pronouns, identity, badges) start. */}
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
            maxLength={BIO_MAX}
            testID="edit-bio"
            accessibilityLabel="Bio"
            onBlur={async () => {
              if (localBio === (profile.bio ?? '')) return;
              try { await updateProfile({ bio: localBio }); }
              catch (e) { logError(e, 'editProfile_saveBio'); showAlert('Not saved', 'Your bio did not save. Check your connection and try again.'); }
            }}
            numberOfLines={3}
            textAlignVertical="top"
          />
          <Text
            style={[styles.hint, { textAlign: 'right' }, bioCount >= BIO_MAX && { color: colors.error }]}
            testID="edit-bio-counter"
            accessibilityLabel={`${BIO_MAX - bioCount} characters left`}
          >
            {bioCount} / {BIO_MAX}
          </Text>
        </View>

        <ProfilePromptsEditor userId={user.id} />
        <ProfilePhotoGrid userId={user.id} editable />
        <ProfileFavorites userId={user.id} editable />

        {/* Display name. It was labelled "contact support to change" while the
            column was UPDATE-granted all along (PRO-04). Now editable, with the
            same rules the 133 CHECK + reserved-name trigger enforce. */}
        <View style={styles.section}>
          <Text style={styles.label}>Display Name</Text>
          <View style={styles.tagAddRow}>
            <TextInput
              style={[styles.tagInput, styles.readOnlyText]}
              value={nameDraft}
              onChangeText={(t) => { setNameDraft(t); setNameError(null); }}
              maxLength={50}
              testID="edit-display-name"
              accessibilityLabel="Display name"
              autoCapitalize="words"
            />
            {nameDraft.trim() !== (profile.display_name ?? '') ? (
              <TouchableOpacity
                style={styles.tagAdd}
                onPress={() => void saveDisplayName()}
                disabled={nameSaving}
                testID="edit-display-name-save"
                accessibilityRole="button"
                accessibilityLabel="Save display name"
              >
                <BusySwap busy={nameSaving} onFill label="Saving"><Text style={styles.tagAddText}>Save</Text></BusySwap>
              </TouchableOpacity>
            ) : null}
          </View>
          {nameError ? (
            <Text style={[styles.hint, { color: colors.error }]} testID="edit-display-name-error" accessibilityLiveRegion="polite">{nameError}</Text>
          ) : (
            <Text style={styles.hint}>How you appear everywhere in Roxy.</Text>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Identity — shown on your profile</Text>
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
                  onPress={() => { void togglePronoun(pronoun); }}
                  testID={`edit-pronoun-${pronoun}`}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={pronoun}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{pronoun}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Custom tags — up to {MAX_CUSTOM_TAGS}</Text>
          <View style={styles.chipRow}>
            {(profile.custom_tags ?? []).map((tag) => (
              <TouchableOpacity
                key={tag}
                style={[styles.chip, styles.chipSelected]}
                onPress={async () => {
                  const next = (profile.custom_tags ?? []).filter((t) => t !== tag);
                  try { await updateProfile({ custom_tags: next }); }
                  catch (e) { logError(e, 'editProfile_removeTag'); showAlert('Error', 'Could not save tags'); }
                }}
                accessibilityRole="button"
                accessibilityLabel={`Remove tag ${tag}`}
              >
                <Text style={[styles.chipText, styles.chipTextSelected]}>{tag} ×</Text>
              </TouchableOpacity>
            ))}
          </View>
          {(profile.custom_tags ?? []).length < MAX_CUSTOM_TAGS ? (
            <View style={styles.tagAddRow}>
              <TextInput
                style={styles.tagInput}
                placeholder="Add a tag"
                placeholderTextColor={colors.textMuted}
                value={tagDraft}
                onChangeText={setTagDraft}
                maxLength={24}
                testID="edit-custom-tag-input"
              />
              <TouchableOpacity
                style={styles.tagAdd}
                onPress={async () => {
                  const next = clampCustomTags([...(profile.custom_tags ?? []), tagDraft]);
                  if (next.length === (profile.custom_tags ?? []).length) return;
                  try {
                    await updateProfile({ custom_tags: next });
                    setTagDraft('');
                  } catch (e) {
                    logError(e, 'editProfile_addTag');
                    showAlert('Error', 'Could not save tags');
                  }
                }}
                accessibilityRole="button"
                accessibilityLabel="Add custom tag"
              >
                <Text style={styles.tagAddText}>Add</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Text style={styles.hint}>Five tags is the limit.</Text>
          )}
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
                  onPress={() => { void toggleIdentity(lbl); }}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={lbl}
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
