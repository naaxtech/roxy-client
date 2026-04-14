import { View, Text, Image, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../lib/constants';
import { isPresetAvatar, presetEmoji, presetColor } from '../../lib/avatars';
import { BadgeRow } from './BadgeRow';
import type { Profile, Business } from '../../types';
import type { EarnedBadge } from './BadgeRow';

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

export function ProfileCard({ profile, badges, isOwn, onEdit, onSettings, onBack, friendshipState, onAddFriend, onAcceptFriend, onMessage, savedBusinesses, onOpenBusiness }: ProfileCardProps) {
  const points = profile.gamification_points ?? 0;
  const level = getLevelInfo(points);
  const initials = (profile.display_name ?? '?').charAt(0).toUpperCase();
  const hasPreset = !!profile.avatar_url && isPresetAvatar(profile.avatar_url);
  const chips = [...(profile.pronouns ?? []), ...(profile.identity_labels ?? [])];

  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      {/* Nav row */}
      <View style={styles.navRow}>
        {onBack ? (
          <TouchableOpacity onPress={onBack} style={styles.navBtn} testID="back-btn">
            <Ionicons name="arrow-back-outline" size={24} color={COLORS.textPrimary} />
          </TouchableOpacity>
        ) : <View style={styles.navBtn} />}
        <View style={{ flex: 1 }} />
        {isOwn && onSettings && (
          <TouchableOpacity onPress={onSettings} style={styles.navBtn} testID="settings-btn">
            <Ionicons name="settings-outline" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Avatar + badge row */}
      <View style={styles.avatarSection}>
        {hasPreset ? (
          <View style={[styles.avatarCircle, { backgroundColor: presetColor(profile.avatar_url as string) }]}>
            <Text style={styles.avatarEmoji}>{presetEmoji(profile.avatar_url as string)}</Text>
          </View>
        ) : profile.avatar_url ? (
          <Image source={{ uri: profile.avatar_url }} style={styles.avatarImage} />
        ) : (
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarInitial}>{initials}</Text>
          </View>
        )}
        <BadgeRow badges={badges} />
      </View>

      {/* Name */}
      <Text style={styles.displayName}>{profile.display_name}</Text>
      <Text style={styles.username}>@{profile.username}</Text>

      {/* Identity + pronouns chips */}
      {(chips.length > 0) && (
        <View style={styles.chipRow}>
          {chips.map((tag) => (
            <View key={tag} style={styles.chip}>
              <Text style={styles.chipText}>{tag}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Bio */}
      {profile.bio ? (
        <View style={styles.bioBox}>
          <Text style={styles.bioText}>{profile.bio}</Text>
        </View>
      ) : isOwn && onEdit ? (
        <TouchableOpacity style={[styles.bioBox, styles.bioPlaceholderBox]} onPress={onEdit}>
          <Text style={styles.bioPlaceholder}>Add a bio…</Text>
        </TouchableOpacity>
      ) : null}

      {/* Level */}
      <View style={styles.levelRow}>
        <Text style={styles.levelText}>{level.emoji} {level.label} · {points} pts</Text>
      </View>

      {/* Edit button (own profile) */}
      {isOwn && onEdit && (
        <TouchableOpacity style={styles.editBtn} onPress={onEdit}>
          <Text style={styles.editBtnText}>Edit Profile</Text>
        </TouchableOpacity>
      )}

      {/* Saved Businesses (own profile only) */}
      {isOwn && savedBusinesses && (
        <View style={savedStyles.section}>
          <Text style={savedStyles.sectionTitle}>💜 Saved Businesses</Text>
          {savedBusinesses.length === 0 ? (
            <Text style={savedStyles.empty}>No saved businesses yet</Text>
          ) : (
            savedBusinesses.map((biz) => (
              <TouchableOpacity
                key={biz.id}
                style={savedStyles.bizRow}
                onPress={() => onOpenBusiness?.(biz)}
                activeOpacity={0.8}
              >
                <View style={savedStyles.bizInitial}>
                  <Text style={savedStyles.bizInitialText}>{biz.name[0].toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={savedStyles.bizName}>{biz.name}</Text>
                  {biz.category && (
                    <Text style={savedStyles.bizCategory}>{biz.category}</Text>
                  )}
                </View>
                <Text style={savedStyles.chevron}>›</Text>
              </TouchableOpacity>
            ))
          )}
        </View>
      )}

      {/* Actions (other user's profile) */}
      {!isOwn && (
        <View style={styles.actionRow}>
          {onMessage && (
            <TouchableOpacity style={styles.messageBtn} onPress={onMessage}>
              <Ionicons name="chatbubble-outline" size={16} color="#fff" />
              <Text style={styles.messageBtnText}>Message</Text>
            </TouchableOpacity>
          )}
          {friendshipState === 'none' && onAddFriend && (
            <TouchableOpacity style={styles.addFriendBtn} onPress={onAddFriend}>
              <Ionicons name="person-add-outline" size={16} color={COLORS.primary} />
              <Text style={styles.addFriendBtnText}>Add Friend</Text>
            </TouchableOpacity>
          )}
          {friendshipState === 'sent' && (
            <View style={styles.requestedChip}>
              <Text style={styles.requestedText}>Requested</Text>
            </View>
          )}
          {friendshipState === 'received' && onAcceptFriend && (
            <TouchableOpacity style={styles.addFriendBtn} onPress={onAcceptFriend}>
              <Ionicons name="checkmark-outline" size={16} color={COLORS.primary} />
              <Text style={styles.addFriendBtnText}>Accept Request</Text>
            </TouchableOpacity>
          )}
          {friendshipState === 'friends' && (
            <View style={styles.friendsChip}>
              <Text style={styles.friendsChipText}>Friends 💜</Text>
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, alignItems: 'center', gap: 12 },

  navRow: {
    flexDirection: 'row', alignItems: 'center',
    width: '100%', marginBottom: 4,
  },
  navBtn: { width: 40, height: 40, justifyContent: 'center' },

  avatarSection: { alignItems: 'center', marginTop: 4 },
  avatarCircle: {
    width: 90, height: 90, borderRadius: 45,
    backgroundColor: COLORS.roxy,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarImage: { width: 90, height: 90, borderRadius: 45 },
  avatarInitial: { color: '#fff', fontSize: 36, fontWeight: '700' },
  avatarEmoji: { fontSize: 44 },

  displayName: { color: COLORS.textPrimary, fontSize: 22, fontWeight: '700' },
  username: { color: COLORS.textMuted, fontSize: 14, marginTop: -4 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
  chip: {
    backgroundColor: COLORS.primary + '20', borderRadius: 16,
    paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: COLORS.primary + '40',
  },
  chipText: { color: COLORS.primary, fontSize: 12, fontWeight: '600' },

  bioBox: {
    backgroundColor: COLORS.surface, borderRadius: 12,
    padding: 14, width: '100%',
  },
  bioPlaceholderBox: { borderWidth: 1, borderColor: COLORS.textMuted + '40', borderStyle: 'dashed' },
  bioText: { color: COLORS.textPrimary, fontSize: 15, lineHeight: 22 },
  bioPlaceholder: { color: COLORS.textMuted, fontSize: 15, fontStyle: 'italic' },

  levelRow: {
    backgroundColor: COLORS.surface, borderRadius: 12,
    paddingHorizontal: 20, paddingVertical: 10,
  },
  levelText: { color: COLORS.textPrimary, fontWeight: '600', fontSize: 15 },

  editBtn: {
    width: '100%', backgroundColor: COLORS.roxy,
    borderRadius: 14, paddingVertical: 14, alignItems: 'center',
    marginTop: 4,
  },
  editBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },

  actionRow: { flexDirection: 'row', gap: 10, width: '100%', marginTop: 4 },
  messageBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: COLORS.primary, borderRadius: 14, paddingVertical: 13,
  },
  messageBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  addFriendBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: COLORS.primary + '20', borderRadius: 14, paddingVertical: 13,
    borderWidth: 1, borderColor: COLORS.primary + '60',
  },
  addFriendBtnText: { color: COLORS.primary, fontWeight: '700', fontSize: 15 },
  requestedChip: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.surface, borderRadius: 14, paddingVertical: 13,
  },
  requestedText: { color: COLORS.textMuted, fontWeight: '600', fontSize: 15 },
  friendsChip: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.primary + '15', borderRadius: 14, paddingVertical: 13,
  },
  friendsChipText: { color: COLORS.primary, fontWeight: '600', fontSize: 15 },
});

const savedStyles = StyleSheet.create({
  section: { paddingHorizontal: 0, paddingTop: 16, paddingBottom: 8, width: '100%' },
  sectionTitle: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 16, marginBottom: 12 },
  empty: { color: COLORS.textMuted, fontSize: 14 },
  bizRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.surface, borderRadius: 12,
    padding: 12, marginBottom: 8, gap: 12,
  },
  bizInitial: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.primary + '30',
    alignItems: 'center', justifyContent: 'center',
  },
  bizInitialText: { color: COLORS.primary, fontWeight: '700', fontSize: 15 },
  bizName: { color: COLORS.textPrimary, fontWeight: '600', fontSize: 14 },
  bizCategory: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  chevron: { color: COLORS.textMuted, fontSize: 20 },
});
