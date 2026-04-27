import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert, StyleSheet,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../../../lib/supabase';
import { useAuthStore } from '../../../../store/authStore';
import { COLORS } from '../../../../lib/constants';
import { RoxyLinkPicker, RoxyLinkSelection } from '../../../../components/feed/RoxyLinkPicker';
import type { PostType } from '../../../../types';

type Step = 'type-picker' | 'composer';

export default function CreatePostScreen() {
  const { communityId } = useLocalSearchParams<{ communityId: string }>();
  const router = useRouter();
  const { user } = useAuthStore();

  const [step, setStep] = useState<Step>('type-picker');
  const [postType, setPostType] = useState<PostType>('standard');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showLinkPicker, setShowLinkPicker] = useState(false);
  const [roxyLink, setRoxyLink] = useState<RoxyLinkSelection | null>(null);

  const TYPE_OPTIONS: { type: PostType; icon: string; label: string; sub: string }[] = [
    { type: 'standard',  icon: '📝', label: 'Text',            sub: "Share what's on your mind" },
    { type: 'photo',     icon: '📷', label: 'Photo / Gallery', sub: 'Up to 10 photos' },
    { type: 'video',     icon: '🎬', label: 'Video',           sub: '3 min max, 720p' },
    { type: 'roxy_link', icon: '🔗', label: 'Roxy Link',       sub: 'Share a game, room, or event' },
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
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.85,
    });
    if (!result.canceled && result.assets.length > 0) {
      setStep('composer');
    }
  };

  const handleSubmit = async () => {
    if (!user?.id || !communityId || submitting) return;
    if (postType !== 'roxy_link' && !content.trim()) {
      Alert.alert('Add some text', 'Your post needs content.');
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

    const { error } = await supabase.from('posts').insert(payload);
    setSubmitting(false);

    if (error) {
      Alert.alert('Post failed', 'Could not publish. Please try again.');
      return;
    }
    router.back();
  };

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
              <Text style={styles.typeIcon}>{opt.icon}</Text>
              <View style={styles.typeInfo}>
                <Text style={styles.typeLabel}>{opt.label}</Text>
                <Text style={styles.typeSub}>{opt.sub}</Text>
              </View>
              <Text style={styles.typeChevron}>›</Text>
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

      <TextInput
        style={styles.captionInput}
        placeholder={
          postType === 'roxy_link'
            ? 'Add a caption (optional)…'
            : "What's on your mind?"
        }
        placeholderTextColor={COLORS.textMuted}
        value={content}
        onChangeText={setContent}
        multiline
        autoFocus
        maxLength={1000}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: COLORS.surface,
  },
  cancelBtn: { color: COLORS.primary, fontSize: 15 },
  headerTitle: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 16 },
  publishBtn: {
    backgroundColor: COLORS.primary, paddingHorizontal: 16,
    paddingVertical: 8, borderRadius: 20,
  },
  publishBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  typePicker: { flex: 1, padding: 16 },
  typeOption: {
    flexDirection: 'row', alignItems: 'center',
    padding: 16, marginBottom: 8,
    backgroundColor: COLORS.surface, borderRadius: 12,
  },
  typeIcon: { fontSize: 28, marginRight: 14 },
  typeInfo: { flex: 1 },
  typeLabel: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 16 },
  typeSub: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  typeChevron: { color: COLORS.textMuted, fontSize: 20 },
  linkPreview: {
    backgroundColor: COLORS.surface, margin: 16,
    padding: 12, borderRadius: 10,
  },
  linkPreviewText: { color: COLORS.primary, fontSize: 14, fontWeight: '600' },
  captionInput: {
    flex: 1, padding: 16,
    color: COLORS.textPrimary, fontSize: 16,
    lineHeight: 24, textAlignVertical: 'top',
  },
});
