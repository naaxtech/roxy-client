import { useEffect, useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, ScrollView, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image as ExpoImage } from 'expo-image';
import { useThemeColors } from '../../hooks/useThemeColors';
import { isPresetAvatar, presetEmoji, presetColor } from '../../lib/avatars';
import { BadgeRow } from './BadgeRow';
import { supabase } from '../../lib/supabase';
import type { Profile, Business } from '../../types';
import type { EarnedBadge } from './BadgeRow';

const SCREEN_WIDTH = Dimensions.get('window').width;
const PHOTO_SIZE = (SCREEN_WIDTH - 4) / 3;

type MediaPost = { id: string; media_urls: string[]; post_type: string };
type ProfileTab = 'photos' | 'about' | 'badges';

function getLevelInfo(points: number): { label: string; emoji: string } {
  if (points >= 500) return { label: 'Radiant', emoji: '✨' };
  if (points >= 100) return { label: 'Bloom', emoji: '🌸' };
  return { label: 'Seedling', emoji: '🌱' };
}

interface ProfileCardProps {
  profile: Profile;
  badges: EarnedBadge[];
  isOwn: boolean;
  onEdit?: () => void;
  onSettings?: () => void;
  onBack?: () => void;
  friendshipState?: 'none' | 'sent' | 'received' | 'friends';
  onAddFriend?: () => void;
  onAcceptFriend?: () => void;
  onMessage?: () => void;
  savedBusinesses?: Business[];
  onOpenBusiness?: (business: Business) => void;
}

export function ProfileCard({
  profile, badges, isOwn, onEdit, onSettings, onBack,
  friendshipState, onAddFriend, onAcceptFriend, onMessage,
  savedBusinesses, onOpenBusiness,
}: ProfileCardProps) {
  const colors = useThemeColors();
  const [tab, setTab] = useState<ProfileTab>('photos');
  const [photos, setPhotos] = useState<MediaPost[]>([]);

  useEffect(() => {
    supabase
      .from('posts')
      .select('id, media_urls, post_type')
      .eq('user_id', profile.id)
      .in('post_type', ['photo', 'video'])
      .order('created_at', { ascending: false })
      .limit(30)
      .then(({ data }) => {
        if (data) setPhotos((data as MediaPost[]).filter((p) => p.media_urls?.length > 0));
      });
  }, [profile.id]);

  const points = profile.gamification_points ?? 0;
  const level = getLevelInfo(points);
  const initials = (profile.display_name ?? '?').charAt(0).toUpperCase();
  const hasPreset = !!profile.avatar_url && isPresetAvatar(profile.avatar_url);
  // Retired options linger in old profile rows — never display them.
  const RETIRED_CHIPS = new Set(['any/all', 'other', 'Prefer not to say']);
  const chips = [...(profile.pronouns ?? []), ...(profile.identity_labels ?? [])]
    .filter((c) => !RETIRED_CHIPS.has(c));

  const s = StyleSheet.create({
    scroll: { flex: 1 },

    // Header bar
    headerBar: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 14, paddingTop: 8, paddingBottom: 4,
    },
    navBtn: { width: 38, height: 38, justifyContent: 'center' },
    headerFlex: { flex: 1 },

    // Cover + avatar
    cover: { height: 130, backgroundColor: colors.surfaceLight, position: 'relative' },
    coverGrad: { ...StyleSheet.absoluteFillObject },
    avatarWrap: {
      position: 'absolute', bottom: -40, left: 18,
      width: 80, height: 80, borderRadius: 24,
      borderWidth: 3, borderColor: colors.background,
      overflow: 'hidden',
      shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.18, shadowRadius: 10, elevation: 8,
    },
    avatarCircle: {
      width: '100%', height: '100%', borderRadius: 21,
      backgroundColor: colors.roxy,
      alignItems: 'center', justifyContent: 'center',
    },
    avatarEmoji: { fontSize: 36 },
    avatarInitial: { color: '#fff', fontSize: 32, fontWeight: '700' },

    // Info section
    infoSection: { paddingHorizontal: 18, paddingTop: 48, paddingBottom: 12 },
    displayName: { color: colors.textPrimary, fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
    username: { color: colors.textMuted, fontSize: 13, marginTop: 2 },

    // Chips
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
    chip: {
      backgroundColor: colors.primary + '18', borderRadius: 20,
      paddingHorizontal: 10, paddingVertical: 4,
      borderWidth: 1, borderColor: colors.primary + '35',
    },
    chipText: { color: colors.primary, fontSize: 12, fontWeight: '600' },

    // Action row
    actionRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 18, marginBottom: 8 },
    msgBtn: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      backgroundColor: colors.roxy, borderRadius: 14, paddingVertical: 11,
    },
    msgBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
    addBtn: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      borderRadius: 14, paddingVertical: 11,
      backgroundColor: colors.primary + '18',
      borderWidth: 1, borderColor: colors.primary + '50',
    },
    addBtnText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
    statusChip: {
      flex: 1, alignItems: 'center', justifyContent: 'center',
      borderRadius: 14, paddingVertical: 11,
      backgroundColor: colors.surface,
    },
    statusText: { color: colors.textMuted, fontWeight: '600', fontSize: 14 },

    editBtn: {
      marginHorizontal: 18, marginBottom: 8,
      backgroundColor: colors.roxy, borderRadius: 14,
      paddingVertical: 12, alignItems: 'center',
    },
    editBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

    // Sub-tabs
    tabRow: {
      flexDirection: 'row',
      borderBottomWidth: 1, borderBottomColor: colors.surfaceLight,
      marginHorizontal: 0,
    },
    tabItem: {
      flex: 1, paddingVertical: 10, alignItems: 'center',
      borderBottomWidth: 2, borderBottomColor: 'transparent',
    },
    tabItemActive: { borderBottomColor: colors.roxy },
    tabText: { color: colors.textMuted, fontWeight: '600', fontSize: 13 },
    tabTextActive: { color: colors.roxy, fontWeight: '700' },

    // Photos grid
    photoGrid: { flexDirection: 'row', flexWrap: 'wrap' },
    photoCell: {
      width: PHOTO_SIZE, height: PHOTO_SIZE,
      margin: 1, backgroundColor: colors.surfaceLight,
    },
    photoImg: { width: '100%', height: '100%' },
    noPhotos: { alignItems: 'center', padding: 48, gap: 8 },
    noPhotosText: { color: colors.textMuted, fontSize: 15, textAlign: 'center' },

    // About tab
    aboutBox: { padding: 18, gap: 14 },
    bioBox: { backgroundColor: colors.surface, borderRadius: 14, padding: 14 },
    bioText: { color: colors.textPrimary, fontSize: 15, lineHeight: 22 },
    bioPlaceholder: { color: colors.textMuted, fontSize: 15, fontStyle: 'italic' },
    levelRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: colors.surface, borderRadius: 14, padding: 14,
    },
    levelText: { color: colors.textPrimary, fontWeight: '600', fontSize: 15, flex: 1 },

    // Saved businesses (own profile)
    bizSection: { padding: 18, gap: 10 },
    bizSectionTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 15, marginBottom: 4 },
    bizRow: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: colors.surface, borderRadius: 12,
      padding: 12, gap: 12,
    },
    bizInitial: {
      width: 36, height: 36, borderRadius: 18,
      backgroundColor: colors.primary + '30',
      alignItems: 'center', justifyContent: 'center',
    },
    bizInitialText: { color: colors.primary, fontWeight: '700', fontSize: 15 },
    bizName: { color: colors.textPrimary, fontWeight: '600', fontSize: 14 },
    bizCategory: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  });

  const TABS: { id: ProfileTab; label: string }[] = [
    { id: 'photos', label: 'Photos' },
    { id: 'about', label: 'About' },
    { id: 'badges', label: 'Badges' },
  ];

  const renderCover = () => {
    const firstUrl = photos[0]?.media_urls?.[0];
    if (photos.length > 0 && firstUrl) {
      return (
        <View style={s.cover}>
          <ExpoImage
            source={{ uri: firstUrl }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
          />
          <LinearGradient
            colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.4)']}
            style={s.coverGrad}
          />
        </View>
      );
    }
    return (
      <LinearGradient
        colors={['#FF6A2E', '#FF2F71', '#E81C8E']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={s.cover}
      />
    );
  };

  const renderAvatar = () => (
    <View style={s.avatarWrap}>
      {hasPreset ? (
        <View style={[s.avatarCircle, { backgroundColor: presetColor(profile.avatar_url as string) }]}>
          <Text style={s.avatarEmoji}>{presetEmoji(profile.avatar_url as string)}</Text>
        </View>
      ) : profile.avatar_url ? (
        <Image source={{ uri: profile.avatar_url }} style={{ width: '100%', height: '100%' }} />
      ) : (
        <View style={s.avatarCircle}>
          <Text style={s.avatarInitial}>{initials}</Text>
        </View>
      )}
    </View>
  );

  return (
    <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
      {/* Nav */}
      <View style={s.headerBar}>
        {onBack ? (
          <TouchableOpacity onPress={onBack} style={s.navBtn} testID="back-btn">
            <Ionicons name="arrow-back-outline" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
        ) : <View style={s.navBtn} />}
        <View style={s.headerFlex} />
        {isOwn && onSettings && (
          <TouchableOpacity onPress={onSettings} style={s.navBtn}>
            <Ionicons name="settings-outline" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Cover + Avatar */}
      {renderCover()}
      {renderAvatar()}

      {/* Info */}
      <View style={s.infoSection}>
        <Text style={s.displayName}>{profile.display_name}</Text>
        <Text style={s.username}>@{profile.username}</Text>
        {chips.length > 0 && (
          <View style={s.chipRow}>
            {chips.map((tag) => (
              <View key={tag} style={s.chip}>
                <Text style={s.chipText}>{tag}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Actions */}
      {isOwn && onEdit ? (
        <TouchableOpacity style={s.editBtn} onPress={onEdit}>
          <Text style={s.editBtnText}>Edit Profile</Text>
        </TouchableOpacity>
      ) : !isOwn && (
        <View style={s.actionRow}>
          {onMessage && (
            <TouchableOpacity style={s.msgBtn} onPress={onMessage}>
              <Ionicons name="chatbubble-outline" size={16} color="#fff" />
              <Text style={s.msgBtnText}>Message</Text>
            </TouchableOpacity>
          )}
          {friendshipState === 'none' && onAddFriend && (
            <TouchableOpacity style={s.addBtn} onPress={onAddFriend}>
              <Ionicons name="person-add-outline" size={16} color={colors.primary} />
              <Text style={s.addBtnText}>Add Friend</Text>
            </TouchableOpacity>
          )}
          {friendshipState === 'sent' && (
            <View style={s.statusChip}><Text style={s.statusText}>Requested</Text></View>
          )}
          {friendshipState === 'received' && onAcceptFriend && (
            <TouchableOpacity style={s.addBtn} onPress={onAcceptFriend}>
              <Ionicons name="checkmark-outline" size={16} color={colors.primary} />
              <Text style={s.addBtnText}>Accept Request</Text>
            </TouchableOpacity>
          )}
          {friendshipState === 'friends' && (
            <View style={[s.statusChip, { backgroundColor: colors.primary + '15' }]}>
              <Text style={[s.statusText, { color: colors.primary }]}>Friends 💜</Text>
            </View>
          )}
        </View>
      )}

      {/* Sub-tabs */}
      <View style={s.tabRow}>
        {TABS.map((t) => (
          <TouchableOpacity
            key={t.id}
            style={[s.tabItem, tab === t.id && s.tabItemActive]}
            onPress={() => setTab(t.id)}
          >
            <Text style={[s.tabText, tab === t.id && s.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Photos tab */}
      {tab === 'photos' && (
        photos.length === 0 ? (
          <View style={s.noPhotos}>
            <Text style={{ fontSize: 40 }}>📷</Text>
            <Text style={s.noPhotosText}>
              {isOwn ? 'Share your first photo to fill this up.' : 'No photos yet.'}
            </Text>
          </View>
        ) : (
          <View style={s.photoGrid}>
            {photos.flatMap((p) => p.media_urls.map((url, i) => (
              <View key={`${p.id}-${i}`} style={s.photoCell}>
                <ExpoImage
                  source={{ uri: url }}
                  style={s.photoImg}
                  contentFit="cover"
                />
              </View>
            )))}
          </View>
        )
      )}

      {/* About tab */}
      {tab === 'about' && (
        <View style={s.aboutBox}>
          {profile.bio ? (
            <View style={s.bioBox}>
              <Text style={s.bioText}>{profile.bio}</Text>
            </View>
          ) : isOwn && onEdit ? (
            <TouchableOpacity style={[s.bioBox, { borderWidth: 1, borderStyle: 'dashed', borderColor: colors.textMuted + '40' }]} onPress={onEdit}>
              <Text style={s.bioPlaceholder}>Add a bio…</Text>
            </TouchableOpacity>
          ) : (
            <View style={s.bioBox}>
              <Text style={s.bioPlaceholder}>No bio yet.</Text>
            </View>
          )}
          <View style={s.levelRow}>
            <Ionicons name="star" size={18} color={colors.roxy} />
            <Text style={s.levelText}>{level.emoji} {level.label} · {points} pts</Text>
          </View>

          {/* Saved businesses (own profile) */}
          {isOwn && savedBusinesses && savedBusinesses.length > 0 && (
            <View style={{ gap: 8 }}>
              <Text style={s.bizSectionTitle}>💜 Saved Businesses</Text>
              {savedBusinesses.map((biz) => (
                <TouchableOpacity
                  key={biz.id}
                  style={s.bizRow}
                  onPress={() => onOpenBusiness?.(biz)}
                  activeOpacity={0.8}
                >
                  <View style={s.bizInitial}>
                    <Text style={s.bizInitialText}>{biz.name[0].toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.bizName}>{biz.name}</Text>
                    {biz.category && <Text style={s.bizCategory}>{biz.category}</Text>}
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      )}

      {/* Badges tab */}
      {tab === 'badges' && (
        <View style={{ padding: 18 }}>
          <BadgeRow badges={badges} expanded />
        </View>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}
