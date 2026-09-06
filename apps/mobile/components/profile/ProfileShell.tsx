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
  RADII, LIVE_GRADIENT, inkOn, inkOnGradient, type ThemeColors,
} from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { a11yState } from '../../lib/a11yState';
import {
  visibleTabs, resolveActiveTab, profileLevel, TAB_LABELS,
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
  coverUrl?: string | null;
  avatarUrl?: string | null;
  /** `profiles.gamification_points`. Omit or null and the badge is not drawn. */
  points?: number | null;
  verified?: boolean;
  sellerApproved?: boolean;
  live?: boolean;
  stats?: ProfileStat[];

  // — chrome and actions ——————————————————————————————————————
  onBack?: () => void;
  headerActions?: ProfileIconAction[];
  /** Exactly one per variant: Message · Join / Joined · Edit. */
  primaryAction: ProfileAction;
  secondaryAction?: ProfileAction;

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
const RETIRED_CHIPS = new Set(['any/all', 'other', 'Prefer not to say']);

const COVER_HEIGHT = 112;
const AVATAR_SIZE = 76;
const AVATAR_FRAME = 3;

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
  coverUrl,
  avatarUrl,
  points,
  verified = false,
  sellerApproved = false,
  live = false,
  stats = [],
  onBack,
  headerActions = [],
  primaryAction,
  secondaryAction,
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
  const [internalSelected, setInternalSelected] = useState<ProfileTab | null>(null);
  const selected = onSelectTab ? (selectedTab ?? null) : internalSelected;
  const setSelected = (tab: ProfileTab) => {
    if (onSelectTab) onSelectTab(tab);
    else setInternalSelected(tab);
  };
  const active = resolveActiveTab(tabs, selected);

  const isCommunity = variant === 'community';
  const level = typeof points === 'number' ? profileLevel(points) : null;
  const initial = (name || '?').charAt(0).toUpperCase();
  const hasPreset = !!avatarUrl && isPresetAvatar(avatarUrl);

  // Tinted at the source rather than string-matched: both lists are free-form,
  // so "she/her" could legitimately appear in either and no regex can tell them
  // apart. The column the value came from is the only reliable signal.
  const pronounChips = pronouns.filter((c) => !RETIRED_CHIPS.has(c));
  const identityChips = identityLabels.filter((c) => !RETIRED_CHIPS.has(c));

  const liveInk = inkOnGradient(LIVE_GRADIENT);

  const renderCover = () => {
    if (coverUrl) {
      return <ExpoImage source={{ uri: coverUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />;
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
    const iconColor = kind === 'primary' ? inkOn(colors.primary) : colors.primaryInk;

    if (!action.onPress) {
      // A state, not an action. Role `text` so a screen reader reads it as the
      // status it is rather than offering a tap that does nothing.
      return (
        <View style={[box, s.statusPill]} testID={id} accessibilityRole="text">
          <Text style={[label, s.statusPillLabel]}>{action.label}</Text>
        </View>
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
            <Ionicons name="chevron-back" size={20} color={inkOn(colors.backgroundAlt)} />
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
                <Ionicons name={action.icon} size={19} color={inkOn(colors.backgroundAlt)} />
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
                style={s.levelBadge}
                accessible
                accessibilityRole="text"
                accessibilityLabel={`Level ${level.label}, ${points} points`}
                testID="profile-level-badge"
              >
                <Text style={s.levelBadgeText}>{level.emoji} {level.label}</Text>
              </View>
            ) : null}
          </View>

          <View style={s.actionRow}>
            {secondaryAction ? renderAction(secondaryAction, 'secondary') : null}
            {renderAction(primaryAction, 'primary')}
          </View>
        </View>

        <View style={s.nameBlock}>
          <View style={s.nameRow}>
            <Text style={s.name} numberOfLines={2}>{name}</Text>
            {verified ? (
              <Ionicons
                name="shield-checkmark"
                size={16}
                color={colors.primaryInk}
                accessibilityLabel="Verified"
                testID="profile-verified"
              />
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
                <View style={[s.liveDot, { backgroundColor: liveInk }]} />
                <Text style={[s.livePillText, { color: liveInk }]}>LIVE</Text>
              </LinearGradient>
            ) : null}
          </View>

          {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}

          {pronounChips.length > 0 || identityChips.length > 0 ? (
            <View style={s.chipRow}>
              {pronounChips.map((chip) => (
                <View key={`pronoun-${chip}`} style={s.pronounChip}>
                  <Text style={s.pronounChipText}>{chip}</Text>
                </View>
              ))}
              {identityChips.map((chip) => (
                <View key={`identity-${chip}`} style={s.identityChip}>
                  <Text style={s.identityChipText}>{chip}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {bio ? <Text style={s.bio}>{bio}</Text> : null}
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
    marginTop: -30, gap: 8,
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
  levelBadge: {
    position: 'absolute', bottom: -6, right: -10,
    flexDirection: 'row', alignItems: 'center',
    borderRadius: RADII.pill, paddingHorizontal: 8, paddingVertical: 3,
    backgroundColor: colors.gold,
    borderWidth: 2, borderColor: colors.background,
  },
  levelBadgeText: { ...TYPE.micro, color: inkOn(colors.gold), fontWeight: '800' },

  // — actions ——————————————————————————————————————————————————
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 4, flexShrink: 1 },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    minHeight: MIN_TOUCH_TARGET, paddingHorizontal: 18,
    borderRadius: RADII.sm, backgroundColor: colors.primary,
  },
  primaryLabel: { ...TYPE.body, color: inkOn(colors.primary), fontWeight: '700' },
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
  bio: { ...TYPE.body, color: colors.textSecondary },

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
  retryLabel: { ...TYPE.body, color: inkOn(colors.primary), fontWeight: '700' },
});
