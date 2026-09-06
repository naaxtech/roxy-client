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
import { useProfileStore } from '../../../../store/profileStore';
import {
  postDestination, buildPostPayload, destinationLabel, afterPublishPath,
} from '../../../../lib/postComposer';
import { useThemeColors } from '../../../../hooks/useThemeColors';
import { ShopItemPicker, type ShopItemSelection } from '../../../../components/feed/ShopItemPicker';
import { showAlert } from '../../../../lib/confirm';
import { logError } from '../../../../lib/errorLogger';
import { uploadImageAsset, assetExtension, UploadError } from '../../../../lib/uploads';
import { canTagShop } from '../../../../lib/createAccess';
import { isOfficialAccount } from '../../../../lib/officialGrant';
import { deriveSellerStatus, canSell } from '../../../../lib/sellerStatus';
import { textCardScale } from '../../../../lib/textCard';
import { BRAND_GRADIENT } from '../../../../lib/theme';
import type { PostType } from '../../../../types';
import { TYPE } from '../../../../lib/typography';

const MAX_PHOTOS = 10;
const MAX_VIDEO_SECONDS = 180;

type Step = 'type-picker' | 'media-source' | 'composer';
type MediaKind = 'photo' | 'video';

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

/**
 * Claude Design: one composer, three renderers (video / photo / text card).
 * Camera or camera roll, TikTok-style. Community accounts can also tag a shop item.
 */
export default function CreatePostScreen() {
  const colors = useThemeColors();
  const destination = postDestination();
  const router = useRouter();
  const { user } = useAuthStore();
  const profile = useProfileStore((s) => s.profile);

  const [step, setStep] = useState<Step>('type-picker');
  const [postType, setPostType] = useState<PostType>('standard');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [photos, setPhotos] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [video, setVideo] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [shopItem, setShopItem] = useState<ShopItemSelection | null>(null);
  const [showShopPicker, setShowShopPicker] = useState(false);
  const [sellerApproved, setSellerApproved] = useState(false);

  React.useEffect(() => {
    if (!user?.id) return;
    void supabase
      .from('businesses')
      .select('is_verified, can_sell, stripe_account_id')
      .eq('owner_id', user.id)
      .then(({ data, error }) => {
        if (error) logError(error, 'createPost.seller');
        else setSellerApproved(canSell(deriveSellerStatus(data)));
      });
  }, [user?.id]);

  const shopAllowed = canTagShop({
    official: isOfficialAccount(profile),
    sellerApproved,
  });

  const shopLink = shopItem
    ? { linkType: 'product', entityId: shopItem.productId }
    : null;

  const TYPE_OPTIONS: { type: PostType; icon: keyof typeof Ionicons.glyphMap; grad: readonly [string, string]; label: string; sub: string }[] = [
    { type: 'standard', icon: 'create', grad: ['#8E7CF7', '#C86DD7'], label: 'Text card', sub: 'Full-bleed words on the brand gradient' },
    { type: 'photo', icon: 'images', grad: ['#FF6A2E', '#E81C8E'], label: 'Photo', sub: 'Capture or upload — up to 10' },
    { type: 'video', icon: 'videocam', grad: ['#FF2F71', '#E81C8E'], label: 'Video', sub: 'Capture or upload — 3 min max' },
  ];

  const handleSelectType = (type: PostType) => {
    setPostType(type);
    if (type === 'photo' || type === 'video') {
      setStep('media-source');
    } else {
      setStep('composer');
    }
  };

  const acceptPhotos = (assets: ImagePicker.ImagePickerAsset[]) => {
    if (assets.length === 0) return;
    setPhotos((prev) => [...prev, ...assets].slice(0, MAX_PHOTOS));
    setStep('composer');
  };

  const acceptVideo = (asset: ImagePicker.ImagePickerAsset) => {
    const durationSeconds = asset.duration ? asset.duration / 1000 : 0;
    if (durationSeconds > MAX_VIDEO_SECONDS) {
      showAlert('Video too long', `Videos are capped at ${MAX_VIDEO_SECONDS / 60} minutes.`);
      return;
    }
    setVideo(asset);
    setStep('composer');
  };

  const captureMedia = async (kind: MediaKind) => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      showAlert('Camera needed', 'Allow camera access to capture a photo or video.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: kind === 'photo'
        ? ImagePicker.MediaTypeOptions.Images
        : ImagePicker.MediaTypeOptions.Videos,
      quality: kind === 'photo' ? 0.85 : 1,
      videoMaxDuration: MAX_VIDEO_SECONDS,
    });
    if (result.canceled || result.assets.length === 0) return;
    if (kind === 'photo') acceptPhotos(result.assets);
    else acceptVideo(result.assets[0]);
  };

  const uploadMedia = async (kind: MediaKind) => {
    const remaining = kind === 'photo' ? MAX_PHOTOS - photos.length : 1;
    if (remaining <= 0) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: kind === 'photo'
        ? ImagePicker.MediaTypeOptions.Images
        : ImagePicker.MediaTypeOptions.Videos,
      allowsMultipleSelection: kind === 'photo',
      selectionLimit: remaining,
      quality: kind === 'photo' ? 0.85 : 1,
    });
    if (result.canceled || result.assets.length === 0) return;
    if (kind === 'photo') acceptPhotos(result.assets);
    else acceptVideo(result.assets[0]);
  };

  const removePhoto = (uri: string) => setPhotos((prev) => prev.filter((p) => p.uri !== uri));
  const removeVideo = () => setVideo(null);

  const resolveAuthorId = async (): Promise<string | null> => {
    if (user?.id) return user.id;
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  };

  const uploadVideoAndCreatePost = async (authorId: string): Promise<{ error: string | null }> => {
    if (!video) return { error: 'Missing video' };

    setUploadStatus('Creating post…');
    const { data: newPost, error: insertErr } = await supabase
      .from('posts')
      .insert(buildPostPayload({
        authorId,
        destination,
        content,
        postType: 'video',
        postedAsCommunity: false,
        roxyLink: shopLink,
      }))
      .select('id')
      .single();

    if (insertErr || !newPost) {
      logError(insertErr ?? new Error('posts insert returned no row'), 'createPost_videoInsert');
      return { error: 'Could not create the post. Please try again.' };
    }

    try {
      setUploadStatus('Preparing upload…');
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
      await supabase.from('posts').delete().eq('id', newPost.id);
      logError(e, 'createPost_videoUpload');
      return { error: 'Your video could not be uploaded. Check your connection and try again.' };
    } finally {
      setUploadStatus(null);
    }
  };

  const uploadPhotos = async (authorId: string): Promise<string[]> => {
    const urls: string[] = [];
    for (let i = 0; i < photos.length; i++) {
      const asset = photos[i];
      urls.push(
        await uploadImageAsset({
          bucket: 'post-media',
          pathPrefix: authorId,
          fileName: `${Date.now()}-${i}.${assetExtension(asset)}`,
          asset,
          upsert: false,
        }),
      );
    }
    return urls;
  };

  const handleSubmit = async () => {
    if (submitting) return;
    const authorId = await resolveAuthorId();
    if (!authorId) {
      showAlert('Sign in to post', 'Your session expired. Open the app again and retry.');
      return;
    }
    if (postType === 'photo' && photos.length === 0) {
      showAlert('Add a photo', 'Capture or upload at least one photo.');
      return;
    }
    if (postType === 'video' && !video) {
      showAlert('Add a video', 'Capture or upload a video.');
      return;
    }
    if (postType === 'standard' && !content.trim()) {
      showAlert('Add some text', 'A text card needs words.');
      return;
    }
    setSubmitting(true);

    if (postType === 'video') {
      const { error } = await uploadVideoAndCreatePost(authorId);
      setSubmitting(false);
      if (error) {
        showAlert('Upload failed', error);
        return;
      }
      router.replace(afterPublishPath());
      return;
    }

    const payload = buildPostPayload({
      authorId,
      destination,
      content,
      postType,
      postedAsCommunity: false,
      roxyLink: shopLink,
    });

    if (postType === 'photo') {
      try {
        payload.media_urls = await uploadPhotos(authorId);
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
    router.replace(afterPublishPath());
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
      paddingBottom: 16,
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
    sourceBody: { flex: 1, padding: 16, gap: 10 },
    sourceBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 14,
      padding: 18, backgroundColor: colors.surface, borderRadius: 14,
    },
    sourceTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 16 },
    sourceSub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    cardPreview: {
      margin: 16, borderRadius: 18, overflow: 'hidden', minHeight: 220,
      paddingHorizontal: 22, paddingVertical: 28, justifyContent: 'center', gap: 12,
    },
    cardKick: {
      alignSelf: 'flex-start',
      fontSize: 10.5, fontWeight: '800', letterSpacing: 1.6,
      color: 'rgba(255,249,251,0.85)',
      borderWidth: 1, borderColor: 'rgba(255,249,251,0.4)',
      borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5,
    },
    cardWords: { color: '#FFF8FB', fontFamily: 'Outfit' },
    cardFlower: { fontSize: 44, lineHeight: 44, color: 'rgba(255,249,251,0.16)' },
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
    shopRow: {
      marginHorizontal: 16, marginTop: 8, padding: 12, borderRadius: 12,
      backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 10,
    },
    shopText: { flex: 1, color: colors.textPrimary, fontWeight: '600', fontSize: 14 },
    uploadStatus: { color: colors.textMuted, fontSize: 13, textAlign: 'center', marginTop: 8 },
  });

  const header = (
    left: string,
    onLeft: () => void,
    title: string,
    right?: React.ReactNode,
  ) => (
    <View style={styles.header}>
      <TouchableOpacity onPress={onLeft} hitSlop={8}>
        <Text style={styles.cancelBtn}>{left}</Text>
      </TouchableOpacity>
      <Text style={styles.headerTitle}>{title}</Text>
      {right ?? <View style={{ width: 60 }} />}
    </View>
  );

  if (step === 'type-picker') {
    return (
      <SafeAreaView style={styles.container} testID="create-post">
        {header('Cancel', () => router.back(), 'New Post')}
        <ScrollView style={styles.typePicker}>
          {TYPE_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.type}
              style={styles.typeOption}
              testID={`create-type-${opt.type}`}
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
      </SafeAreaView>
    );
  }

  if (step === 'media-source') {
    const kind: MediaKind = postType === 'video' ? 'video' : 'photo';
    return (
      <SafeAreaView style={styles.container} testID="create-media-source">
        {header('Back', () => setStep('type-picker'), kind === 'video' ? 'Video' : 'Photo')}
        <View style={styles.sourceBody}>
          <TouchableOpacity
            style={styles.sourceBtn}
            testID="create-capture"
            onPress={() => void captureMedia(kind)}
            accessibilityRole="button"
            accessibilityLabel={kind === 'video' ? 'Record a video' : 'Take a photo'}
          >
            <LinearGradient colors={['#FF6A2E', '#E81C8E']} style={styles.typeIconPlate}>
              <Ionicons name={kind === 'video' ? 'videocam' : 'camera'} size={20} color="#fff" />
            </LinearGradient>
            <View style={styles.typeInfo}>
              <Text style={styles.sourceTitle}>{kind === 'video' ? 'Record' : 'Take photo'}</Text>
              <Text style={styles.sourceSub}>Use your camera, like TikTok</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.sourceBtn}
            testID="create-upload"
            onPress={() => void uploadMedia(kind)}
            accessibilityRole="button"
            accessibilityLabel={kind === 'video' ? 'Upload a video' : 'Upload photos'}
          >
            <LinearGradient colors={['#8E7CF7', '#C86DD7']} style={styles.typeIconPlate}>
              <Ionicons name="images" size={20} color="#fff" />
            </LinearGradient>
            <View style={styles.typeInfo}>
              <Text style={styles.sourceTitle}>Upload</Text>
              <Text style={styles.sourceSub}>Choose from your camera roll</Text>
            </View>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const words = content.trim();
  const cardStep = textCardScale(words.length || 12);

  return (
    <SafeAreaView style={styles.container}>
      {header(
        'Back',
        () => setStep(postType === 'standard' ? 'type-picker' : 'media-source'),
        'New Post',
        <TouchableOpacity
          onPress={() => void handleSubmit()}
          disabled={submitting}
          style={styles.publishBtn}
          testID="create-publish"
        >
          {submitting
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={styles.publishBtnText}>Publish</Text>}
        </TouchableOpacity>,
      )}

      {postType === 'standard' && (
        <LinearGradient
          colors={BRAND_GRADIENT}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.cardPreview}
          testID="text-card-preview"
        >
          <Text style={styles.cardKick}>TEXT CARD</Text>
          <Text style={[styles.cardWords, cardStep]} numberOfLines={6}>
            {words || "What's on your mind?"}
          </Text>
          <Text style={styles.cardFlower}>✿</Text>
        </LinearGradient>
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
              onPress={() => setStep('media-source')}
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

      {shopAllowed && (
        <TouchableOpacity
          style={styles.shopRow}
          onPress={() => setShowShopPicker(true)}
          testID="create-tag-shop"
        >
          <Ionicons name="bag-handle-outline" size={18} color={colors.primary} />
          <Text style={styles.shopText}>
            {shopItem ? `${shopItem.label} · Shop →` : 'Tag a shop item'}
          </Text>
          {shopItem ? (
            <TouchableOpacity onPress={() => setShopItem(null)} hitSlop={8} accessibilityLabel="Remove shop tag">
              <Ionicons name="close" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          ) : (
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          )}
        </TouchableOpacity>
      )}

      <TextInput
        style={styles.captionInput}
        placeholder={
          postType === 'standard'
            ? 'Write the card…'
            : 'Add a caption (optional)…'
        }
        placeholderTextColor={colors.textMuted}
        value={content}
        onChangeText={setContent}
        multiline
        autoFocus={postType === 'standard'}
        maxLength={1000}
        testID="create-caption"
      />

      <Text style={styles.destination} testID="create-post-destination">
        Posting to {destinationLabel(destination)}
      </Text>

      {uploadStatus && <Text style={styles.uploadStatus}>{uploadStatus}</Text>}

      <ShopItemPicker
        visible={showShopPicker}
        userId={user?.id ?? ''}
        onSelect={(sel) => {
          setShopItem(sel);
          setShowShopPicker(false);
        }}
        onClose={() => setShowShopPicker(false)}
      />
    </SafeAreaView>
  );
}
