import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, StyleSheet,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../../lib/supabase';
import { useAuthStore } from '../../../../store/authStore';
import { useThemeColors } from '../../../../hooks/useThemeColors';
import { RoxyLinkPicker, RoxyLinkSelection } from '../../../../components/feed/RoxyLinkPicker';
import { showAlert } from '../../../../lib/confirm';
import { logError } from '../../../../lib/errorLogger';
import type { PostType } from '../../../../types';

const MAX_PHOTOS = 10;

type Step = 'type-picker' | 'composer';

export default function CreatePostScreen() {
  const colors = useThemeColors();
  const { communityId } = useLocalSearchParams<{ communityId: string }>();
  const router = useRouter();
  const { user } = useAuthStore();

  const [step, setStep] = useState<Step>('type-picker');
  const [postType, setPostType] = useState<PostType>('standard');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showLinkPicker, setShowLinkPicker] = useState(false);
  const [roxyLink, setRoxyLink] = useState<RoxyLinkSelection | null>(null);
  const [photos, setPhotos] = useState<ImagePicker.ImagePickerAsset[]>([]);

  const TYPE_OPTIONS: { type: PostType; icon: keyof typeof Ionicons.glyphMap; grad: readonly [string, string]; label: string; sub: string }[] = [
    { type: 'standard',  icon: 'create',   grad: ['#8E7CF7', '#C86DD7'], label: 'Text',            sub: "Share what's on your mind" },
    { type: 'photo',     icon: 'images',   grad: ['#FF6A2E', '#E81C8E'], label: 'Photo / Gallery', sub: 'Up to 10 photos' },
    { type: 'video',     icon: 'videocam', grad: ['#FF2F71', '#E81C8E'], label: 'Video',           sub: '3 min max, 720p' },
    { type: 'roxy_link', icon: 'link',     grad: ['#2BB673', '#1E9E62'], label: 'Roxy Link',       sub: 'Share a game, room, or event' },
  ];

  const handleSelectType = (type: PostType) => {
    setPostType(type);
    if (type === 'roxy_link') {
      setShowLinkPicker(true);
    } else if (type === 'photo') {
      void handlePickPhoto();
    } else {
      setStep('composer');
    }
  };

  const handleLinkSelected = (sel: RoxyLinkSelection) => {
    setRoxyLink(sel);
    setShowLinkPicker(false);
    setStep('composer');
  };

  const handlePickPhoto = async () => {
    const remaining = MAX_PHOTOS - photos.length;
    if (remaining <= 0) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.85,
    });
    if (!result.canceled && result.assets.length > 0) {
      // Keep the picked assets — the previous version discarded them, so
      // photo posts published with no media. Cap at MAX_PHOTOS.
      setPhotos((prev) => [...prev, ...result.assets].slice(0, MAX_PHOTOS));
      setStep('composer');
    }
  };

  const removePhoto = (uri: string) => setPhotos((prev) => prev.filter((p) => p.uri !== uri));

  // Upload picked photos to post-media/<userId>/... and return their public
  // URLs. Path folder MUST be the user id — the bucket RLS checks
  // auth.uid() = foldername(name)[1].
  const uploadPhotos = async (): Promise<string[]> => {
    if (!user?.id) return [];
    const urls: string[] = [];
    for (let i = 0; i < photos.length; i++) {
      const asset = photos[i];
      const ext = asset.uri.split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg';
      const path = `${user.id}/${Date.now()}-${i}.${ext}`;
      const blob = await (await fetch(asset.uri)).blob();
      const { error: upErr } = await supabase.storage
        .from('post-media')
        .upload(path, blob, { contentType: asset.mimeType ?? 'image/jpeg', upsert: false });
      if (upErr) throw upErr;
      urls.push(supabase.storage.from('post-media').getPublicUrl(path).data.publicUrl);
    }
    return urls;
  };

  const handleSubmit = async () => {
    if (!user?.id || !communityId || submitting) return;
    // Per-type validation: a photo post needs a photo (caption optional);
    // text/standard needs text; roxy_link needs a linked entity.
    if (postType === 'photo' && photos.length === 0) {
      showAlert('Add a photo', 'Pick at least one photo for a photo post.');
      return;
    }
    if (postType === 'standard' && !content.trim()) {
      showAlert('Add some text', 'Your post needs content.');
      return;
    }
    setSubmitting(true);

    const payload: Record<string, unknown> = {
      author_id: user.id,
      community_id: communityId,
      content: content.trim(),
      post_type: postType,
    };

    if (postType === 'roxy_link' && roxyLink) {
      payload.link_type = roxyLink.linkType;
      payload.link_entity_id = roxyLink.entityId;
      payload.link_community_id = roxyLink.communityId;
    }

    if (postType === 'photo') {
      try {
        payload.media_urls = await uploadPhotos();
      } catch (e) {
        logError(e, 'createPost_uploadPhotos');
        setSubmitting(false);
        showAlert('Upload failed', 'Could not upload your photos. Please try again.');
        return;
      }
    }

    const { error } = await supabase.from('posts').insert(payload);
    setSubmitting(false);

    if (error) {
      showAlert('Post failed', 'Could not publish. Please try again.');
      return;
    }
    router.back();
  };

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingVertical: 12,
      borderBottomWidth: 1, borderBottomColor: colors.surface,
    },
    cancelBtn: { color: colors.primary, fontSize: 15 },
    headerTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 16 },
    publishBtn: {
      backgroundColor: colors.primary, paddingHorizontal: 16,
      paddingVertical: 8, borderRadius: 20,
    },
    publishBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
    typePicker: { flex: 1, padding: 16 },
    typeOption: {
      flexDirection: 'row', alignItems: 'center',
      padding: 16, marginBottom: 8,
      backgroundColor: colors.surface, borderRadius: 12,
    },
    typeIconPlate: {
      width: 42, height: 42, borderRadius: 14, marginRight: 14,
      alignItems: 'center', justifyContent: 'center',
    },
    typeInfo: { flex: 1 },
    typeLabel: { color: colors.textPrimary, fontWeight: '700', fontSize: 16 },
    typeSub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    linkPreview: {
      backgroundColor: colors.surface, margin: 16,
      padding: 12, borderRadius: 10,
    },
    linkPreviewText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
    captionInput: {
      flex: 1, padding: 16,
      color: colors.textPrimary, fontSize: 16,
      lineHeight: 24, textAlignVertical: 'top',
    },
    photoStrip: { paddingHorizontal: 16, paddingTop: 14, gap: 10 },
    photoThumbWrap: { position: 'relative' },
    photoThumb: { width: 96, height: 120, borderRadius: 12, backgroundColor: colors.surface },
    photoRemove: {
      position: 'absolute', top: 6, right: 6,
      width: 22, height: 22, borderRadius: 11,
      backgroundColor: 'rgba(0,0,0,0.6)',
      alignItems: 'center', justifyContent: 'center',
    },
    photoAdd: {
      width: 96, height: 120, borderRadius: 12,
      borderWidth: 1.5, borderColor: colors.primary + '55', borderStyle: 'dashed',
      alignItems: 'center', justifyContent: 'center',
    },
  });

  if (step === 'type-picker') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
            <Text style={styles.cancelBtn}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>New Post</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView style={styles.typePicker}>
          {TYPE_OPTIONS.map(opt => (
            <TouchableOpacity
              key={opt.type}
              style={styles.typeOption}
              onPress={() => handleSelectType(opt.type)}
            >
              <LinearGradient colors={opt.grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.typeIconPlate}>
                <Ionicons name={opt.icon} size={20} color="#fff" />
              </LinearGradient>
              <View style={styles.typeInfo}>
                <Text style={styles.typeLabel}>{opt.label}</Text>
                <Text style={styles.typeSub}>{opt.sub}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          ))}
        </ScrollView>

        <RoxyLinkPicker
          visible={showLinkPicker}
          userId={user?.id ?? ''}
          onSelect={handleLinkSelected}
          onClose={() => setShowLinkPicker(false)}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => setStep('type-picker')} hitSlop={8}>
          <Text style={styles.cancelBtn}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {postType === 'roxy_link' && roxyLink ? roxyLink.entityName : 'New Post'}
        </Text>
        <TouchableOpacity
          onPress={handleSubmit}
          disabled={submitting}
          style={styles.publishBtn}
        >
          {submitting
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={styles.publishBtnText}>Publish</Text>
          }
        </TouchableOpacity>
      </View>

      {postType === 'roxy_link' && roxyLink && (
        <View style={styles.linkPreview}>
          <Text style={styles.linkPreviewText}>
            Linking to: {roxyLink.entityName}
          </Text>
        </View>
      )}

      {postType === 'photo' && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.photoStrip}
        >
          {photos.map((p) => (
            <View key={p.uri} style={styles.photoThumbWrap}>
              <ExpoImage source={{ uri: p.uri }} style={styles.photoThumb} contentFit="cover" />
              <TouchableOpacity
                style={styles.photoRemove}
                onPress={() => removePhoto(p.uri)}
                hitSlop={6}
                accessibilityLabel="Remove photo"
              >
                <Ionicons name="close" size={14} color="#fff" />
              </TouchableOpacity>
            </View>
          ))}
          {photos.length < MAX_PHOTOS && (
            <TouchableOpacity
              style={styles.photoAdd}
              onPress={handlePickPhoto}
              accessibilityLabel="Add more photos"
            >
              <Ionicons name="add" size={26} color={colors.primary} />
            </TouchableOpacity>
          )}
        </ScrollView>
      )}

      <TextInput
        style={styles.captionInput}
        placeholder={
          postType === 'roxy_link'
            ? 'Add a caption (optional)…'
            : postType === 'photo'
              ? 'Add a caption (optional)…'
              : "What's on your mind?"
        }
        placeholderTextColor={colors.textMuted}
        value={content}
        onChangeText={setContent}
        multiline
        autoFocus={postType !== 'photo'}
        maxLength={1000}
      />
    </SafeAreaView>
  );
}

