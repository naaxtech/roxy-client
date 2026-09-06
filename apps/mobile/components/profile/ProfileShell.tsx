import { useState, type ReactNode } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image as ExpoImage } from 'expo-image';
import { useThemeColors } from '../../hooks/useThemeColors';
import { isPresetAvatar, presetEmoji, presetColor, avatarGradient } from '../../lib/avatars';
import { TYPE } from '../../lib/typography';
import {
  RADII, LIVE_GRADIENT, BRAND_GRADIENT, type ThemeColors,
} from '../../lib/theme';
import {
  collapseProfileTags, profileDisplayTags, RETIRED_PROFILE_CHIPS,
} from '../../lib/profileTags';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { a11yState } from '../../lib/a11yState';
import {
  visibleTabs, resolveActiveTab, profileLevel, profileXpLevel, TAB_LABELS,
  type ProfileTab, type ProfileVariant, type PopulatedTabs,
} from './profileVariant';

/**
 * One profile screen for four kinds of subject.
 *
 * A woman, an approved seller, a community and your own You tab were four
 * separate screens that drew the same thing four ways — four covers, four
 * avatars, four tab strips, four opinions about what "no posts yet" looks like.
 * 3.0 draws them once (prototype markup 434–633, behaviour 1516–1572) and lets
 * the variant decide only what genuinely differs: which tabs exist and what the
 * one primary action is.
 *
 * The shell owns LAYOUT and STATE OF THE STRIP. It owns no data: every route
 * still runs its own queries and hands the results down through `renderTab`,
 * because a community's posts and a seller's products have nothing in common
 * except the frame they sit in. That is also why `populated` is a prop rather
 * than something inferred here — only the route knows whether a tab is empty or
 * merely not fetched yet, and the difference between those two decides whether
 * a tab appears at all.
 *
 * What it folds in from `ProfileCard`, deliberately rather than reinventing:
 * the three level bands, the retired-chip filter, and the pronoun/orientation
 * tint split. Those three were each a bug fixed once already.
 *
 * src: docs/handoff/roxy-3.0/Roxy App.dc.html · markup 434–633 · 2026-09-01
 */

/** A button in the header strip over the cover. Icon-only, so always labelled. */
export type ProfileIconAction = {
  icon: keyof typeof Ionicons.glyphMap;
  /** Spoken label. Required — these controls have no visible text. */
  label: string;
  onPress: () => void;
  testID?: string;
  /** The unread dot, as on the prototype's bell. */
  badge?: boolean;
};

/**
 * A primary or secondary action.
 *
 * `onPress` is optional on purpose: "Requested" and "Friends 💜" are *states*,
 * not actions, and the old screen rendered them as chips. A pressable with no
 * handler is announced as a button and does nothing when tapped, which is worse
 * than a plain label.
 */
export type ProfileAction = {
  label: string;
  onPress?: () => void;
  accessibilityLabel?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  testID?: string;
};

export type ProfileStat = { value: string; label: string };

/** The prototype's header badge chip — earned emoji, not a tab. */
export type ProfileBadgePreview = {
  emojis: string;
  extra?: number;
  onPress: () => void;
};

/** The XP pill under Edit on the self variant. */
export type ProfileXp = {
  label: string;
  progress: number;
  onPress?: () => void;
};

/** Whether the tab content is still loading, failed, or is ready to show. */
export type ProfileBodyStatus = 'loading' | 'ready' | 'error';

export interface ProfileShellProps {
  variant: ProfileVariant;

  // — identity ————————————————————————————————————————————————
  name: string;
  /** `@handle · London` for a person, `1.2k members` for a community. */
  subtitle?: string | null;
  bio?: string | null;
  /** Rendered inline beside the name, the way the prototype prints pronouns. */
  pronouns?: string[];
  identityLabels?: string[];
  interests?: string[];
  customTags?: string[];
  /** Relationship / looking-for chip — the second tag in the prototype. */
  statusLabels?: string[];
  /** Self (and seller) header chip. Opens /badges. */
  badgePreview?: ProfileBadgePreview | null;
  /** Self-only XP pill. Opens Mini Wins. */
  xp?: ProfileXp | null;
  coverUrl?: string | null;
  avatarUrl?: string | null;
  /** `profiles.gamification_points`. Omit or null and the badge is not drawn. */
  points?: number | null;
  verified?: boolean;
  sellerApproved?: boolean;
  /** Official community grant — Claude Design community frame + OFFICIAL chip. */
  official?: boolean;
  live?: boolean;
  stats?: ProfileStat[];

  // — chrome and actions ——————————————————————————————————————
  onBack?: () => void;
  headerActions?: ProfileIconAction[];
  /** Exactly one per variant: Message · Join / Joined · Edit. */
  primaryAction: ProfileAction;
  secondaryAction?: ProfileAction;
  /** Official profiles: Follow sits here so Join/Channels keep the prototype pair. */
  tertiaryAction?: ProfileAction;

  // — body ————————————————————————————————————————————————————
  populated: PopulatedTabs;
  renderTab: (tab: ProfileTab) => ReactNode;
  /**
   * Optional controlled strip. The You tab's Saved row has to *open* Saved,
   * and the shell otherwise owns selection internally. Pass both, or neither.
   */
  selectedTab?: ProfileTab | null;
  onSelectTab?: (tab: ProfileTab) => void;
  /** Variant extras between the stats and the strip — SelfControls, the online row. */
  beforeTabs?: ReactNode;
  status?: ProfileBodyStatus;
  errorMessage?: string;
  onRetry?: () => void;
  emptyMessage?: string;
  testID?: string;
}

/**
 * Options that were removed from the picker but still sit in old rows. Showing
 * them makes a profile read as mislabelled by the app rather than described by
 * her, which is the opposite of what an identity chip is for.
 */
const COVER_HEIGHT = 120;
const AVATAR_SIZE = 76;
const AVATAR_FRAME = 3;
const ON_COLOR = '#FFFFFF';
const BIO_COLLAPSE_LINES = 2;

/** What an empty profile says, per variant. Never a bare blank column. */
const EMPTY_COPY: Record<ProfileVariant, string> = {
  self: 'Nothing to show yet. Post something, save something, and your tabs appear here.',
  user: 'She has not shared anything here yet.',
  seller: 'Nothing listed here yet.',
  community: 'This community has not posted anything yet.',
};

export function ProfileShell({
  variant,
  name,
  subtitle,
  bio,
  pronouns = [],
  identityLabels = [],
  interests = [],
  customTags = [],
  statusLabels = [],
  badgePreview = null,
  xp = null,
  coverUrl,
  avatarUrl,
  points,
  verified = false,
  sellerApproved = false,
  official = false,
  live = false,
  stats = [],
  onBack,
  headerActions = [],
  primaryAction,
  secondaryAction,
  tertiaryAction,
  populated,
  renderTab,
  selectedTab,
  onSelectTab,
  beforeTabs,
  status = 'ready',
  errorMessage = 'We could not load this yet.',
  onRetry,
  emptyMessage,
  testID = 'profile-shell',
}: ProfileShellProps) {
  const colors = useThemeColors();
  const s = styles(colors);

  const tabs = visibleTabs(variant, populated);
  const [bioExpanded, setBioExpanded] = useState(false);
  const [bioTruncated, setBioTruncated] = useState(false);
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [internalSelected, setInternalSelected] = useState<ProfileTab | null>(null);
  const selected = onSelectTab ? (selectedTab ?? null) : internalSelected;
  const setSelected = (tab: ProfileTab) => {
    if (onSelectTab) onSelectTab(tab);
    else setInternalSelected(tab);
  };
  const active = resolveActiveTab(tabs, selected);

  const isCommunity = variant === 'community' || official;
  const level = typeof points === 'number' ? profileLevel(points) : null;
  const initial = (name || '?').charAt(0).toUpperCase();
  const hasPreset = !!avatarUrl && isPresetAvatar(avatarUrl);

  // Tinted at the source rather than string-matched: both lists are free-form,
  // so "she/her" could legitimately appear in either and no regex can tell them
  // apart. The column the value came from is the only reliable signal.
  const pronounChips = pronouns.filter((c) => !RETIRED_PROFILE_CHIPS.has(c));
  const allTags = profileDisplayTags({ identityLabels, interests, customTags });
  const extraStatus = statusLabels.filter((c) => !RETIRED_PROFILE_CHIPS.has(c));
  const tagStrip = collapseProfileTags([
    ...allTags,
    ...extraStatus.map((label) => ({ kind: 'custom' as const, label })),
  ], tagsExpanded);

  const renderCover = () => {
    if (coverUrl) {
      return (
        <ExpoImage
          source={{ uri: coverUrl }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          testID="profile-cover-photo"
        />
      );
    }
    // A per-subject gradient, which is what the prototype paints (`pvCover` is
    // the subject's own ramp). Deliberately NOT `BRAND_GRADIENT`: that ramp is
    // reserved for identity chrome — the wordmark, the create button, the Roxy
    // FAB — and a full-bleed brand cover behind every profile would make it mean
    // nothing there.
    return (
      <LinearGradient
        colors={avatarGradient(name)}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    );
  };

  const renderAvatar = () => {
    const shape = isCommunity ? s.avatarSquare : s.avatarRound;
    if (hasPreset && avatarUrl) {
      return (
        <View style={[s.avatarInner, shape, { backgroundColor: presetColor(avatarUrl) }]}>
          <Text style={s.avatarEmoji}>{presetEmoji(avatarUrl)}</Text>
        </View>
      );
    }
    if (avatarUrl) {
      return (
        <ExpoImage
          source={{ uri: avatarUrl }}
          style={[s.avatarInner, shape]}
          contentFit="cover"
        />
      );
    }
    return (
      <View style={[s.avatarInner, shape, s.avatarFallback]}>
        <Text style={s.avatarInitial}>{initial}</Text>
      </View>
    );
  };

  const renderAction = (action: ProfileAction, kind: 'primary' | 'secondary') => {
    const id = action.testID ?? (kind === 'primary' ? 'profile-primary-action' : 'profile-secondary-action');
    const box = kind === 'primary' ? s.primaryBtn : s.secondaryBtn;
    const label = kind === 'primary' ? s.primaryLabel : s.secondaryLabel;
    const iconColor = kind === 'primary' ? ON_COLOR : colors.primaryInk;
    const selfEdit = variant === 'self' && kind === 'primary' && !!action.onPress;

    if (!action.onPress) {
      // A state, not an action. Role `text` so a screen reader reads it as the
      // status it is rather than offering a tap that does nothing.
      return (
        <View style={[box, s.statusPill]} testID={id} accessibilityRole="text">
          <Text style={[label, s.statusPillLabel]}>{action.label}</Text>
        </View>
      );
    }

    if (selfEdit) {
      return (
        <TouchableOpacity
          onPress={action.onPress}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={action.accessibilityLabel ?? action.label}
          testID={id}
        >
          <LinearGradient
            colors={['#F22481', '#8B5CF6']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={s.selfEditBtn}
          >
            <Text style={s.selfEditLabel}>{action.label}</Text>
          </LinearGradient>
        </TouchableOpacity>
      );
    }

    return (
      <TouchableOpacity
        style={box}
        onPress={action.onPress}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={action.accessibilityLabel ?? action.label}
        testID={id}
      >
        {action.icon ? <Ionicons name={action.icon} size={16} color={iconColor} /> : null}
        <Text style={label}>{action.label}</Text>
      </TouchableOpacity>
    );
  };

  const renderBody = () => {
    if (status === 'loading') {
      return (
        <View style={s.bodyState} testID="profile-loading">
          <ActivityIndicator color={colors.roxy} />
        </View>
      );
    }

    if (status === 'error') {
      return (
        <View style={s.bodyState} testID="profile-error">
          <Text style={s.bodyStateText}>{errorMessage}</Text>
          {onRetry ? (
            <TouchableOpacity
              style={s.retryBtn}
              onPress={onRetry}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Try loading this again"
              testID="profile-retry"
            >
              <Text style={s.retryLabel}>Try again</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      );
    }

    if (tabs.length === 0 || !active) {
      // No strip at all rather than seven tabs each holding their own apology.
      return (
        <View style={s.bodyState} testID="profile-empty">
          <Text style={s.bodyStateText}>{emptyMessage ?? EMPTY_COPY[variant]}</Text>
        </View>
      );
    }

    return (
      <>
        <View style={s.tabStrip} accessibilityRole="tablist" testID="profile-tabstrip">
          {tabs.map((tab) => {
            const isActive = tab === active;
            return (
              <TouchableOpacity
                key={tab}
                style={[s.tab, isActive && s.tabActive]}
                onPress={() => setSelected(tab)}
                activeOpacity={0.8}
                accessibilityRole="tab"
                accessibilityLabel={TAB_LABELS[tab]}
                {...a11yState({ selected: isActive })}
                testID={`profile-tab-${tab}`}
              >
                <Text style={[s.tabLabel, isActive && s.tabLabelActive]}>{TAB_LABELS[tab]}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={s.tabContent} testID="profile-tab-content">
          {renderTab(active)}
        </View>
      </>
    );
  };

  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={s.scrollContent}
      showsVerticalScrollIndicator={false}
      testID={testID}
    >
      <View style={s.coverWrap} testID="profile-cover">
        {renderCover()}
        {/* The scrim is what keeps a white icon legible on a light cover photo. */}
        <LinearGradient
          colors={[colors.backgroundAlt + '00', colors.backgroundAlt + '66']}
          style={StyleSheet.absoluteFill}
        />
        {onBack ? (
          <TouchableOpacity
            style={[s.coverBtn, s.coverBtnLeft]}
            onPress={onBack}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Back"
            testID="profile-back"
          >
            <Ionicons name="chevron-back" size={20} color={ON_COLOR} />
          </TouchableOpacity>
        ) : null}
        {headerActions.length > 0 ? (
          <View style={s.coverActions}>
            {headerActions.map((action) => (
              <TouchableOpacity
                key={action.testID ?? action.label}
                style={s.coverBtn}
                onPress={action.onPress}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                testID={action.testID}
              >
                <Ionicons name={action.icon} size={19} color={ON_COLOR} />
                {action.badge ? <View style={s.coverBtnDot} /> : null}
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
      </View>

      <View style={s.body}>
        <View style={s.identityRow}>
          <View style={s.avatarWrap} testID="profile-avatar">
            <View style={[s.avatarFrame, isCommunity ? s.avatarFrameSquare : s.avatarFrameRound]}>
              {renderAvatar()}
            </View>
            {level ? (
              <View
                style={s.levelBadgeWrap}
                accessible
                accessibilityRole="text"
                accessibilityLabel={`Level ${profileXpLevel(points)} ${level.label}, ${points} points`}
                testID="profile-level-badge"
              >
                <LinearGradient
                  colors={[...BRAND_GRADIENT]}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={s.levelBadge}
                >
                  <Text style={s.levelBadgeText}>⚡{profileXpLevel(points)}</Text>
                </LinearGradient>
              </View>
            ) : null}
          </View>

          <View style={s.actionCol}>
            <View style={s.actionRow}>
              {tertiaryAction ? renderAction(tertiaryAction, 'secondary') : null}
              {badgePreview ? (
                <TouchableOpacity
                  style={s.badgeChip}
                  onPress={badgePreview.onPress}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel={
                    badgePreview.extra
                      ? `Badges, ${badgePreview.extra} more`
                      : 'Badges'
                  }
                  testID="profile-badge-chip"
                >
                  <Text style={s.badgeChipEmojis}>{badgePreview.emojis}</Text>
                  {badgePreview.extra ? (
                    <Text style={s.badgeChipExtra}>+{badgePreview.extra}</Text>
                  ) : null}
                </TouchableOpacity>
              ) : null}
              {secondaryAction ? renderAction(secondaryAction, 'secondary') : null}
              {renderAction(primaryAction, 'primary')}
            </View>
            {xp ? (
              <TouchableOpacity
                style={s.xpPill}
                onPress={xp.onPress}
                disabled={!xp.onPress}
                activeOpacity={0.85}
                accessibilityRole={xp.onPress ? 'button' : 'text'}
                accessibilityLabel={`XP progress, ${xp.label}`}
                testID="profile-xp"
              >
                <Text style={s.xpLabel}>{xp.label}</Text>
                <View style={s.xpTrack}>
                  <LinearGradient
                    colors={['#F22481', '#8B5CF6']}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                    style={[s.xpFill, { width: `${Math.round(Math.min(1, Math.max(0, xp.progress)) * 100)}%` }]}
                  />
                </View>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        <View style={s.nameBlock}>
          <View style={s.nameRow}>
            <Text style={s.name} numberOfLines={2}>{name}</Text>
            {pronounChips.length > 0 ? (
              <Text style={s.pronounsBeside} testID="profile-pronouns">
                {pronounChips.join(' · ')}
              </Text>
            ) : null}
            {verified ? (
              <Ionicons
                name="shield-checkmark"
                size={16}
                color={colors.primaryInk}
                accessibilityLabel="Verified"
                testID="profile-verified"
              />
            ) : null}
            {official ? (
              <View style={s.sellerChip} testID="profile-official-chip">
                <Text style={s.sellerChipText}>OFFICIAL</Text>
              </View>
            ) : null}
            {sellerApproved ? (
              <View style={s.sellerChip} testID="profile-seller-chip">
                <Text style={s.sellerChipText}>APPROVED SELLER</Text>
              </View>
            ) : null}
            {live ? (
              // Never colour alone: the dot AND the word, per the 3.0 rule.
              <LinearGradient
                colors={LIVE_GRADIENT}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={s.livePill}
                testID="profile-live"
              >
                <View style={[s.liveDot, { backgroundColor: ON_COLOR }]} />
                <Text style={[s.livePillText, { color: ON_COLOR }]}>LIVE</Text>
              </LinearGradient>
            ) : null}
          </View>

          {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}

          {bio ? (
            <View testID="profile-bio">
              <Text
                style={s.bio}
                numberOfLines={bioExpanded ? undefined : BIO_COLLAPSE_LINES}
                onTextLayout={(e) => {
                  if (!bioExpanded && e.nativeEvent.lines.length >= BIO_COLLAPSE_LINES) {
                    setBioTruncated(true);
                  }
                }}
              >
                {bio}
              </Text>
              {bioTruncated ? (
                <TouchableOpacity
                  onPress={() => setBioExpanded((open) => !open)}
                  accessibilityRole="button"
                  accessibilityLabel={bioExpanded ? 'Show less bio' : 'Show more bio'}
                  testID="profile-bio-toggle"
                  hitSlop={8}
                >
                  <Text style={s.bioMore}>{bioExpanded ? 'less' : 'more'}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}

          {tagStrip.visible.length > 0 ? (
            <View style={s.chipRow} testID="profile-tags">
              {tagStrip.visible.map((tag) => (
                <View
                  key={`${tag.kind}-${tag.label}`}
                  style={tag.kind === 'identity' ? s.pronounChip : tag.kind === 'interest' ? s.identityChip : s.customChip}
                >
                  <Text style={tag.kind === 'identity' ? s.pronounChipText : tag.kind === 'interest' ? s.identityChipText : s.customChipText}>
                    {tag.label}
                  </Text>
                </View>
              ))}
              {tagStrip.hidden > 0 ? (
                <TouchableOpacity
                  style={s.moreChip}
                  onPress={() => setTagsExpanded(true)}
                  accessibilityRole="button"
                  accessibilityLabel={`Show ${tagStrip.hidden} more tags`}
                  testID="profile-tags-more"
                >
                  <Text style={s.moreChipText}>+{tagStrip.hidden}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
        </View>

        {stats.length > 0 ? (
          <View style={s.statRow} testID="profile-stats">
            {stats.map((stat, i) => (
              <View
                key={stat.label}
                style={[s.stat, i < stats.length - 1 && s.statDivider]}
              >
                <Text style={s.statValue}>{stat.value}</Text>
                <Text style={s.statLabel}>{stat.label}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {beforeTabs}

        {renderBody()}
      </View>
    </ScrollView>
  );
}

const styles = (colors: ThemeColors) => StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  scrollContent: { paddingBottom: 100 },

  // — cover ——————————————————————————————————————————————————
  coverWrap: { height: COVER_HEIGHT, backgroundColor: colors.surfaceLight, position: 'relative' },
  coverBtn: {
    width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET,
    borderRadius: RADII.pill,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.backgroundAlt + 'A6',
    borderWidth: 1, borderColor: colors.lineStrong,
  },
  coverBtnLeft: { position: 'absolute', top: 8, left: 10 },
  coverActions: { position: 'absolute', top: 8, right: 10, flexDirection: 'row', gap: 7 },
  coverBtnDot: {
    position: 'absolute', top: 12, right: 12,
    width: 7, height: 7, borderRadius: RADII.pill,
    backgroundColor: colors.primary,
  },

  // — identity ————————————————————————————————————————————————
  body: { paddingHorizontal: 16, gap: 10 },
  identityRow: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    // Half the avatar sits on the cover, half on the body — the seam.
    marginTop: -(AVATAR_SIZE / 2), gap: 8,
  },
  avatarWrap: { width: AVATAR_SIZE, height: AVATAR_SIZE },
  avatarFrame: {
    width: AVATAR_SIZE, height: AVATAR_SIZE, padding: AVATAR_FRAME,
    backgroundColor: colors.lineStrong,
    borderWidth: 2, borderColor: colors.background,
  },
  avatarFrameRound: { borderRadius: RADII.pill },
  avatarFrameSquare: { borderRadius: RADII.lg },
  avatarInner: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarRound: { borderRadius: RADII.pill },
  avatarSquare: { borderRadius: RADII.md },
  avatarFallback: { backgroundColor: colors.surfaceLight },
  avatarEmoji: { ...TYPE.display, color: colors.textPrimary },
  avatarInitial: { ...TYPE.display, color: colors.textPrimary },
  levelBadgeWrap: { position: 'absolute', bottom: -6, right: -10 },
  levelBadge: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: RADII.pill, paddingHorizontal: 7, paddingVertical: 2.5,
    borderWidth: 2, borderColor: colors.background,
  },
  levelBadgeText: { ...TYPE.micro, color: ON_COLOR, fontWeight: '800' },

  // — actions ——————————————————————————————————————————————————
  actionCol: { flex: 1, alignItems: 'flex-end', gap: 6, paddingBottom: 4 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, flexWrap: 'wrap', justifyContent: 'flex-end' },
  badgeChip: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
    borderRadius: RADII.pill, paddingHorizontal: 10, paddingVertical: 5,
    minHeight: MIN_TOUCH_TARGET,
  },
  badgeChipEmojis: { fontSize: 12, letterSpacing: 1 },
  badgeChipExtra: { ...TYPE.micro, color: colors.primaryInk, fontWeight: '800', marginLeft: 2 },
  selfEditBtn: {
    minHeight: MIN_TOUCH_TARGET, paddingHorizontal: 13,
    borderRadius: RADII.pill, alignItems: 'center', justifyContent: 'center',
  },
  selfEditLabel: { ...TYPE.caption, color: ON_COLOR, fontWeight: '700' },
  xpPill: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
    borderRadius: RADII.pill, paddingHorizontal: 10, paddingVertical: 5,
    minHeight: MIN_TOUCH_TARGET,
  },
  xpLabel: { ...TYPE.micro, color: colors.textPrimary, fontWeight: '800' },
  xpTrack: {
    width: 52, height: 5, borderRadius: RADII.pill,
    backgroundColor: colors.surfaceLight, overflow: 'hidden',
  },
  xpFill: { height: '100%', borderRadius: RADII.pill },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    minHeight: MIN_TOUCH_TARGET, paddingHorizontal: 18,
    borderRadius: RADII.sm, backgroundColor: colors.primary,
  },
  primaryLabel: { ...TYPE.body, color: ON_COLOR, fontWeight: '700' },
  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    minHeight: MIN_TOUCH_TARGET, paddingHorizontal: 14,
    borderRadius: RADII.sm, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.primary + '59',
  },
  secondaryLabel: { ...TYPE.body, color: colors.primaryInk, fontWeight: '700' },
  statusPill: { borderColor: colors.line },
  statusPillLabel: { color: colors.textSecondary },

  // — name block ——————————————————————————————————————————————
  nameBlock: { gap: 5 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  name: { ...TYPE.headline, color: colors.textPrimary, flexShrink: 1 },
  pronounsBeside: { ...TYPE.caption, color: colors.textMuted, fontWeight: '600' },
  subtitle: { ...TYPE.caption, color: colors.textMuted },
  sellerChip: {
    borderRadius: RADII.pill, paddingHorizontal: 8, paddingVertical: 3,
    backgroundColor: colors.primary + '1F',
    borderWidth: 1, borderColor: colors.primary + '4D',
  },
  sellerChipText: { ...TYPE.micro, color: colors.primaryInk, fontWeight: '800' },
  livePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: RADII.pill, paddingHorizontal: 8, paddingVertical: 3,
  },
  liveDot: { width: 5, height: 5, borderRadius: RADII.pill },
  livePillText: { ...TYPE.micro, fontWeight: '800' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  pronounChip: {
    borderRadius: RADII.pill, paddingHorizontal: 10, paddingVertical: 4,
    backgroundColor: colors.roxy + '20',
    borderWidth: 1, borderColor: colors.roxy + '45',
  },
  pronounChipText: { ...TYPE.caption, color: colors.roxy, fontWeight: '700' },
  identityChip: {
    borderRadius: RADII.pill, paddingHorizontal: 10, paddingVertical: 4,
    backgroundColor: colors.secondary + '20',
    borderWidth: 1, borderColor: colors.secondary + '45',
  },
  identityChipText: { ...TYPE.caption, color: colors.secondaryInk, fontWeight: '700' },
  customChip: {
    borderRadius: RADII.pill, paddingHorizontal: 10, paddingVertical: 4,
    backgroundColor: colors.surfaceLight,
    borderWidth: 1, borderColor: colors.line,
  },
  customChipText: { ...TYPE.caption, color: colors.textPrimary, fontWeight: '700' },
  moreChip: {
    borderRadius: RADII.pill, paddingHorizontal: 10, paddingVertical: 4,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.line,
    minHeight: 28, justifyContent: 'center',
  },
  moreChipText: { ...TYPE.caption, color: colors.textSecondary, fontWeight: '800' },
  bio: { ...TYPE.body, color: colors.textSecondary },
  bioMore: { ...TYPE.caption, color: colors.textPrimary, fontWeight: '700', marginTop: 2 },

  // — stats ——————————————————————————————————————————————————
  statRow: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.line,
    borderRadius: RADII.md, paddingVertical: 10,
  },
  stat: { flex: 1, alignItems: 'center' },
  statDivider: { borderRightWidth: 1, borderRightColor: colors.line },
  statValue: { ...TYPE.title, color: colors.textPrimary },
  statLabel: { ...TYPE.micro, color: colors.textMuted, marginTop: 1 },

  // — tabs ————————————————————————————————————————————————————
  tabStrip: {
    flexDirection: 'row', gap: 2, marginTop: 2,
    borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  tab: {
    minHeight: MIN_TOUCH_TARGET, paddingHorizontal: 12,
    alignItems: 'center', justifyContent: 'center',
    borderBottomWidth: 2, borderBottomColor: colors.background,
    marginBottom: -1,
  },
  tabActive: { borderBottomColor: colors.primary },
  tabLabel: { ...TYPE.body, color: colors.textMuted, fontWeight: '600' },
  tabLabelActive: { color: colors.textPrimary, fontWeight: '700' },
  tabContent: { paddingTop: 12 },

  // — the three states ————————————————————————————————————————
  bodyState: { paddingVertical: 40, paddingHorizontal: 12, alignItems: 'center', gap: 10 },
  bodyStateText: { ...TYPE.body, color: colors.textSecondary, textAlign: 'center' },
  retryBtn: {
    minHeight: MIN_TOUCH_TARGET, paddingHorizontal: 22,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: RADII.pill, backgroundColor: colors.primary,
  },
  retryLabel: { ...TYPE.body, color: ON_COLOR, fontWeight: '700' },
});
