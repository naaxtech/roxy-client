import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, StyleSheet,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { supabase, callEdgeFunction } from '../../../../lib/supabase';
import { useAuthStore } from '../../../../store/authStore';
import { postDestination, buildPostPayload, destinationLabel } from '../../../../lib/postComposer';
import { useThemeColors } from '../../../../hooks/useThemeColors';
import { RoxyLinkPicker, RoxyLinkSelection } from '../../../../components/feed/RoxyLinkPicker';
import { showAlert } from '../../../../lib/confirm';
import { logError } from '../../../../lib/errorLogger';
import { uploadImageAsset, assetExtension, UploadError } from '../../../../lib/uploads';
import type { PostType } from '../../../../types';
import { TYPE } from '../../../../lib/typography';

const MAX_PHOTOS = 10;
const MAX_VIDEO_SECONDS = 180;

type Step = 'type-picker' | 'composer';

/**
 * Turn an upload failure into something worth reading, without putting a
 * storage path (which starts with the user's id) in front of the user.
 * The underlying error still goes to logError with its reason code intact.
 */
function uploadFailureMessage(e: unknown): string {
  if (e instanceof UploadError) {
    switch (e.reason) {
      case 'read_failed':
        return 'We could not read that file from your device. Pick it again and retry.';
      case 'empty_file':
        return 'That file came back empty. Pick it again, or choose a different one.';
      case 'storage_rejected':
        return 'The upload was rejected. Check your connection and try again.';
    }
  }
  return 'Could not upload your photos. Please try again.';
}

export default function CreatePostScreen() {
  const colors = useThemeColors();
  const destination = postDestination();
  const router = useRouter();
  const { user } = useAuthStore();

  const [step, setStep] = useState<Step>('type-picker');
  const [postType, setPostType] = useState<PostType>('standard');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showLinkPicker, setShowLinkPicker] = useState(false);
  const [roxyLink, setRoxyLink] = useState<RoxyLinkSelection | null>(null);
  const [photos, setPhotos] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [video, setVideo] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);

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
    } else if (type === 'video') {
      void handlePickVideo();
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

  const handlePickVideo = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      allowsMultipleSelection: false,
      quality: 1,
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    const durationSeconds = asset.duration ? asset.duration / 1000 : 0;
    if (durationSeconds > MAX_VIDEO_SECONDS) {
      showAlert('Video too long', `Videos are capped at ${MAX_VIDEO_SECONDS / 60} minutes.`);
      return;
    }
    setVideo(asset);
    setStep('composer');
  };

  const removeVideo = () => setVideo(null);

  // Upload the picked video to Cloudflare Stream via a TUS upload session.
  // 1. Insert the post row first (need a real id — Cloudflare's upload
  //    session is tagged with it as metadata so cloudflare-video-webhook
  //    can find the right row once processing finishes).
  // 2. Get a TUS uploadURL scoped to that postId from get-video-upload-url.
  // 3. PATCH the raw video bytes to that URL per the TUS protocol (single
  //    request: Upload-Offset 0, Content-Type application/offset+octet-stream).
  const uploadVideoAndCreatePost = async (): Promise<{ error: string | null }> => {
    if (!user?.id || !video) return { error: 'Missing video' };

    setUploadStatus('Creating post…');
    const { data: newPost, error: insertErr } = await supabase
      .from('posts')
      .insert(buildPostPayload({
        authorId: user.id,
        destination,
        content,
        postType: 'video',
        postedAsCommunity: false,
      }))
      .select('id')
      .single();

    if (insertErr || !newPost) {
      // The raw Postgres text ("new row violates row-level security policy for
      // table \"posts\"") is a debugging aid, not a sentence to show a user.
      // Keep it in the log, hand back something actionable.
      logError(insertErr ?? new Error('posts insert returned no row'), 'createPost_videoInsert');
      return { error: 'Could not create the post. Please try again.' };
    }

    try {
      setUploadStatus('Preparing upload…');
      // Deliberately a Blob here, unlike the photo path: this PATCH goes
      // through React Native's own fetch, which handles Blob request bodies
      // natively. An ArrayBuffer body is base64-encoded across the bridge and
      // would materialise a 3-minute video in memory several times over. The
      // storage-js FormData trap that breaks photo uploads cannot apply — no
      // FormData is involved in this request.
      const blob = await (await fetch(video.uri)).blob();
      if (blob.size === 0) throw new Error('video read as 0 bytes');

      const { data: uploadInfo, error: urlErr } = await callEdgeFunction<{ uploadURL: string; videoId: string }>(
        'get-video-upload-url',
        { postId: newPost.id, maxDurationSeconds: MAX_VIDEO_SECONDS, fileSize: blob.size },
      );
      if (urlErr || !uploadInfo) throw new Error(urlErr ?? 'Could not get upload URL');

      setUploadStatus('Uploading video…');
      const uploadRes = await fetch(uploadInfo.uploadURL, {
        method: 'PATCH',
        headers: {
          'Tus-Resumable': '1.0.0',
          'Upload-Offset': '0',
          'Content-Type': 'application/offset+octet-stream',
        },
        body: blob,
      });
      if (!uploadRes.ok) throw new Error(`Upload failed (${uploadRes.status})`);

      return { error: null };
    } catch (e) {
      // Don't leave an orphaned post with no video attached.
      await supabase.from('posts').delete().eq('id', newPost.id);
      logError(e, 'createPost_videoUpload');
      return { error: 'Your video could not be uploaded. Check your connection and try again.' };
    } finally {
      setUploadStatus(null);
    }
  };

  // Upload picked photos to post-media/<userId>/... and return their public
  // URLs. Path folder MUST be the user id — the bucket RLS checks
  // auth.uid() = foldername(name)[1]. Bytes go through uploadImageAsset:
  // handing storage-js a Blob on React Native uploads 0 bytes on iOS and
  // throws on Android (see lib/uploads.ts).
  const uploadPhotos = async (): Promise<string[]> => {
    if (!user?.id) return [];
    const urls: string[] = [];
    for (let i = 0; i < photos.length; i++) {
      const asset = photos[i];
      urls.push(
        await uploadImageAsset({
          bucket: 'post-media',
          pathPrefix: user.id,
          fileName: `${Date.now()}-${i}.${assetExtension(asset)}`,
          asset,
          upsert: false,
        }),
      );
    }
    return urls;
  };

  const handleSubmit = async () => {
    if (!user?.id || submitting) return;
    // Per-type validation: a photo post needs a photo (caption optional);
    // a video post needs a video; text/standard needs text; roxy_link needs
    // a linked entity.
    if (postType === 'photo' && photos.length === 0) {
      showAlert('Add a photo', 'Pick at least one photo for a photo post.');
      return;
    }
    if (postType === 'video' && !video) {
      showAlert('Add a video', 'Pick a video for a video post.');
      return;
    }
    if (postType === 'standard' && !content.trim()) {
      showAlert('Add some text', 'Your post needs content.');
      return;
    }
    setSubmitting(true);

    // Video posts go through Cloudflare Stream (insert-first, then upload)
    // rather than the shared payload-insert path below — the video isn't
    // ready to attach at insert time, it arrives later via
    // cloudflare-video-webhook once processing finishes.
    if (postType === 'video') {
      const { error } = await uploadVideoAndCreatePost();
      setSubmitting(false);
      if (error) {
        showAlert('Upload failed', error);
        return;
      }
      router.back();
      return;
    }

    const payload = buildPostPayload({
      authorId: user.id,
      destination,
      content,
      postType,
      postedAsCommunity: false,
      roxyLink: postType === 'roxy_link' ? roxyLink : null,
    });

    if (postType === 'photo') {
      try {
        payload.media_urls = await uploadPhotos();
      } catch (e) {
        logError(e, 'createPost_uploadPhotos');
        setSubmitting(false);
        showAlert('Upload failed', uploadFailureMessage(e));
        return;
      }
    }

    const { error } = await supabase.from('posts').insert(payload);
    setSubmitting(false);

    if (error) {
      logError(error, 'createPost_insert');
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
    destination: {
      ...TYPE.caption,
      color: colors.textMuted,
      paddingHorizontal: 16,
      paddingTop: 12,
    },
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
    videoPreview: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      margin: 16, padding: 12, borderRadius: 12, backgroundColor: colors.surface,
    },
    videoPreviewText: { color: colors.textPrimary, fontSize: 14, flex: 1 },
    uploadStatus: { color: colors.textMuted, fontSize: 13, textAlign: 'center', marginTop: 8 },
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

      {postType === 'video' && video && (
        <View style={styles.videoPreview}>
          <Ionicons name="videocam" size={24} color={colors.primary} />
          <Text style={styles.videoPreviewText} numberOfLines={1}>
            {video.fileName ?? 'Video selected'}
            {video.duration ? ` · ${Math.round(video.duration / 1000)}s` : ''}
          </Text>
          <TouchableOpacity onPress={removeVideo} hitSlop={6} accessibilityLabel="Remove video">
            <Ionicons name="close" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      )}

      <TextInput
        style={styles.captionInput}
        placeholder={
          postType === 'roxy_link'
            ? 'Add a caption (optional)…'
            : postType === 'photo' || postType === 'video'
              ? 'Add a caption (optional)…'
              : "What's on your mind?"
        }
        placeholderTextColor={colors.textMuted}
        value={content}
        onChangeText={setContent}
        multiline
        autoFocus={postType !== 'photo' && postType !== 'video'}
        maxLength={1000}
      />

      <Text style={styles.destination} testID="create-post-destination">
        Posting to {destinationLabel(destination)}
      </Text>

      {uploadStatus && <Text style={styles.uploadStatus}>{uploadStatus}</Text>}
    </SafeAreaView>
  );
}

