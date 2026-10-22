import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native';
import { TouchableOpacity } from '../ui/PressableScale';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image as ExpoImage } from 'expo-image';
import { useThemeColors } from '../../hooks/useThemeColors';
import { RoxyRefresh } from '../feedback';
import { isPresetAvatar, presetEmoji, presetColor } from '../../lib/avatars';
import { TYPE, FONTS } from '../../lib/typography';
import {
  RADII,
  SPACE,
  MARGIN,
  identityFor,
  inkOn,
  type ThemeColors,
  pinkFill,
} from '../../lib/theme';
import { PrimaryButton } from '../ui/PrimaryButton';
import { LiveDot } from '../discover/LiveDot';
import { initialsOf } from '../ui/Avatar';
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
  /** Pull-to-refresh (PRO-08). Omit onRefresh and the gesture is not offered. */
  refreshing?: boolean;
  onRefresh?: () => void;
  /**
   * The root list's scroll hook-ups, passed straight to its ScrollView. The
   * You tab's root list lives here, so the Roxy AI button's tuck-on-scroll
   * (lane roxy-ai: `onListScroll`, `scrollEventThrottle`) and the 88 dp lane
   * (`contentBottomInset` = `FAB_LANE`) attach through these props.
   */
  onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  scrollEventThrottle?: number;
  /** Extra space under the last item (the Roxy AI lane). */
  contentBottomInset?: number;
  testID?: string;
}

/**
 * Options that were removed from the picker but still sit in old rows. Showing
 * them makes a profile read as mislabelled by the app rather than described by
 * her, which is the opposite of what an identity chip is for.
 */
/**
 * Prototype profile header (`Roxy App.dc.html` 456–511).
 *
 * Cover is 112. Avatar is 76. The photo is pinned to the cover seam so
 * 48dp pills cannot drag it onto the body. Badges, Edit and XP sit in
 * that same 76px band — they overlap the cover with the avatar, they do
 * not start a new row under it.
 */
export const PROFILE_COVER_HEIGHT = 112;
export const PROFILE_AVATAR_SIZE = 76;
export const PROFILE_AVATAR_FRAME = 3;
export const PROFILE_AVATAR_SEAM = PROFILE_AVATAR_SIZE / 2;
/**
 * v2: without an uploaded cover the header is flat — a band on `ground` just
 * tall enough for the icon row above the avatar (no gradient cover).
 */
export const PROFILE_BAR_HEIGHT = 80;

const COVER_HEIGHT = PROFILE_COVER_HEIGHT;
const AVATAR_SIZE = PROFILE_AVATAR_SIZE;
const AVATAR_FRAME = PROFILE_AVATAR_FRAME;
const BIO_COLLAPSE_LINES = 2;
/** Header icons: 24 dp outlines. */
const ICON = 24;
/** The quiet Edit pill's face; hitSlop brings the target to 48. */
const EDIT_HEIGHT = 40;

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
  refreshing = false,
  onRefresh,
  emptyMessage,
  onScroll,
  scrollEventThrottle,
  contentBottomInset = 0,
  testID = 'profile-shell',
}: ProfileShellProps) {
  const colors = useThemeColors();
  // Built once per theme, not on every render (jank audit #8).
  const s = useMemo(() => styles(colors), [colors]);

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
  // v2 bans XP bars, levels and points on her own profile: the self variant
  // never draws the level badge, whatever it is passed.
  const level = variant !== 'self' && typeof points === 'number' ? profileLevel(points) : null;
  const hasCover = !!coverUrl;
  const bandHeight = hasCover ? COVER_HEIGHT : PROFILE_BAR_HEIGHT;
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
    // v2: no gradient cover (direction › Bans: generic gradient heroes). The
    // band is flat `ground`; only an uploaded cover photo paints it.
    return null;
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
    // No photo: her initials on her identity field (flat), ink by `inkOn`.
    const field = identityFor(name);
    return (
      <View style={[s.avatarInner, shape, { backgroundColor: field }]} testID="profile-avatar-initials">
        <Text style={[s.avatarInitial, { color: inkOn(field) }]}>{initialsOf(name) || initial}</Text>
      </View>
    );
  };

  const renderAction = (action: ProfileAction, kind: 'primary' | 'secondary') => {
    const id = action.testID ?? (kind === 'primary' ? 'profile-primary-action' : 'profile-secondary-action');
    const box = kind === 'primary' ? s.primaryBtn : s.secondaryBtn;
    const label = kind === 'primary' ? s.primaryLabel : s.secondaryLabel;
    const iconColor = colors.ink;
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
      // v2 (direction › You): Edit is a quiet `raised` pill, not the pink
      // action — on her own profile there is nothing to sell her.
      return (
        <TouchableOpacity
          onPress={action.onPress}
          hitSlop={{ top: SPACE[0], bottom: SPACE[0], left: SPACE[0], right: SPACE[0] }}
          accessibilityRole="button"
          accessibilityLabel={action.accessibilityLabel ?? action.label}
          style={s.selfEditBtn}
          testID={id}
        >
          <Text style={s.selfEditLabel}>{action.label}</Text>
        </TouchableOpacity>
      );
    }

    if (kind === 'primary') {
      // The screen's one primary (Message, Join): the lipped PrimaryButton.
      return (
        <PrimaryButton
          label={action.label}
          onPress={action.onPress}
          accessibilityLabel={action.accessibilityLabel ?? action.label}
          testID={id}
        />
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
        <View style={s.skeletonGrid} testID="profile-loading" accessibilityLabel="Loading">
          {[0, 1, 2].map((i) => (
            <View key={i} style={[s.skeletonTile, { backgroundColor: colors.raised }]} />
          ))}
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

  const body = (refreshControl: ReactElement | undefined) => (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={[s.scrollContent, contentBottomInset ? { paddingBottom: s.scrollContent.paddingBottom + contentBottomInset } : null]}
      showsVerticalScrollIndicator={false}
      onScroll={onScroll}
      scrollEventThrottle={scrollEventThrottle}
      testID={testID}
      refreshControl={refreshControl}
    >
      <View style={s.headerBlock} testID="profile-header">
        <View style={[s.coverWrap, { height: bandHeight }, !hasCover && s.coverFlat]} testID="profile-cover">
          {renderCover()}
          {/* The neutral media scrim keeps the icon plates legible on a photo. */}
          {hasCover ? (
            <LinearGradient
              colors={[colors.ground + '00', colors.ground + '66']}
              style={StyleSheet.absoluteFill}
            />
          ) : null}
          {onBack ? (
            <TouchableOpacity
              style={[s.coverBtn, hasCover && s.coverBtnPlate, s.coverBtnLeft]}
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel="Back"
              testID="profile-back"
            >
              <Ionicons name="chevron-back" size={ICON} color={colors.ink} />
            </TouchableOpacity>
          ) : null}
          {headerActions.length > 0 ? (
            <View style={s.coverActions}>
              {headerActions.map((action) => (
                <TouchableOpacity
                  key={action.testID ?? action.label}
                  style={[s.coverBtn, hasCover && s.coverBtnPlate]}
                  onPress={action.onPress}
                  accessibilityRole="button"
                  accessibilityLabel={action.label}
                  testID={action.testID}
                >
                  <Ionicons name={action.icon} size={ICON} color={colors.ink} />
                  {action.badge ? <View style={s.coverBtnDot} /> : null}
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
        </View>

        <View style={[s.avatarOnSeam, { top: bandHeight - PROFILE_AVATAR_SEAM }]} testID="profile-avatar">
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
                colors={pinkFill(colors)}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={s.levelBadge}
              >
                <Text style={s.levelBadgeText}>⚡{profileXpLevel(points)}</Text>
              </LinearGradient>
            </View>
          ) : null}
        </View>

        <View style={s.identityRow} testID="profile-identity-row">
          <View style={s.actionCol}>
            <View style={s.actionRow}>
              {tertiaryAction ? renderAction(tertiaryAction, 'secondary') : null}
              {badgePreview ? (
                <TouchableOpacity
                  style={s.badgeChip}
                  onPress={badgePreview.onPress}
                  activeOpacity={0.85}
                  hitSlop={12}
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
                hitSlop={12}
                accessibilityRole={xp.onPress ? 'button' : 'text'}
                accessibilityLabel={`XP progress, ${xp.label}`}
                testID="profile-xp"
              >
                <Text style={s.xpLabel}>{xp.label}</Text>
                <View style={s.xpTrack}>
                  <LinearGradient
                    colors={pinkFill(colors)}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                    style={[s.xpFill, { width: `${Math.round(Math.min(1, Math.max(0, xp.progress)) * 100)}%` }]}
                  />
                </View>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </View>

      <View style={s.body}>
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
                <Text style={s.sellerChipText}>Official</Text>
              </View>
            ) : null}
            {sellerApproved ? (
              <View style={s.sellerChip} testID="profile-seller-chip">
                <Text style={s.sellerChipText}>Approved seller</Text>
              </View>
            ) : null}
            {live ? (
              // Never colour alone: the dot AND the word (LIVE = dot + word).
              <View style={s.livePill} testID="profile-live">
                <LiveDot />
                <Text style={s.livePillText}>LIVE</Text>
              </View>
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

  // Pull-to-refresh is Roxy's (motion spec 3.1 row 7): the web pull with the faceless O, the
  // tinted system control on native. Only offered when the screen passes onRefresh.
  return onRefresh ? (
    <RoxyRefresh refreshing={refreshing} onRefresh={onRefresh} testID="profile-refresh">{body}</RoxyRefresh>
  ) : body(undefined);
}

const styles = (colors: ThemeColors) => StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.ground },
  scrollContent: { paddingBottom: 100, overflow: 'visible' },

  // — cover ——————————————————————————————————————————————————
  headerBlock: {
    position: 'relative',
    backgroundColor: colors.ground,
    zIndex: 1,
  },
  coverWrap: {
    height: COVER_HEIGHT,
    backgroundColor: colors.raised,
    overflow: 'hidden',
  },
  coverFlat: { backgroundColor: colors.ground },
  coverBtn: {
    width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET,
    borderRadius: RADII.pill,
    alignItems: 'center', justifyContent: 'center',
  },
  /** Only over a photo: a ground plate keeps the glyph legible. */
  coverBtnPlate: { backgroundColor: colors.ground + 'CC' },
  coverBtnLeft: { position: 'absolute', top: SPACE[1], left: SPACE[1] },
  coverActions: { position: 'absolute', top: SPACE[1], right: SPACE[1], flexDirection: 'row', gap: SPACE[0] },
  coverBtnDot: {
    position: 'absolute', top: SPACE[2], right: SPACE[2],
    width: SPACE[1], height: SPACE[1], borderRadius: RADII.pill,
    backgroundColor: colors.pink,
  },

  // — identity ————————————————————————————————————————————————
  body: { paddingHorizontal: MARGIN, gap: SPACE[2] },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: -PROFILE_AVATAR_SEAM,
    minHeight: PROFILE_AVATAR_SIZE,
    overflow: 'visible',
    paddingHorizontal: 16,
    paddingLeft: 16 + AVATAR_SIZE + 8,
    zIndex: 2,
  },
  avatarOnSeam: {
    position: 'absolute',
    left: 16,
    top: COVER_HEIGHT - PROFILE_AVATAR_SEAM,
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    zIndex: 3,
  },
  avatarWrap: { width: AVATAR_SIZE, height: AVATAR_SIZE },
  avatarFrame: {
    width: AVATAR_SIZE, height: AVATAR_SIZE, padding: AVATAR_FRAME,
    backgroundColor: colors.ground,
  },
  avatarFrameRound: { borderRadius: RADII.pill },
  avatarFrameSquare: { borderRadius: Math.round(AVATAR_SIZE * 0.28) },
  avatarInner: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarRound: { borderRadius: RADII.pill },
  avatarSquare: { borderRadius: Math.round((AVATAR_SIZE - AVATAR_FRAME * 2) * 0.28) },
  avatarEmoji: { ...TYPE.display, color: colors.ink },
  avatarInitial: { ...TYPE.title, fontFamily: FONTS.display.extrabold, fontSize: TYPE.headline.fontSize, lineHeight: TYPE.headline.lineHeight },
  levelBadgeWrap: { position: 'absolute', bottom: -6, right: -10 },
  levelBadge: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: RADII.pill, paddingHorizontal: 7, paddingVertical: 2.5,
    borderWidth: 2, borderColor: colors.background,
  },
  levelBadgeText: { ...TYPE.micro, color: colors.onPink, fontWeight: '800' },

  // — actions ——————————————————————————————————————————————————
  actionCol: { flex: 1, alignItems: 'flex-end', justifyContent: 'center', gap: 6 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, flexWrap: 'wrap', justifyContent: 'flex-end' },
  badgeChip: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.raised,
    borderRadius: RADII.pill, paddingHorizontal: SPACE[2], paddingVertical: SPACE[0],
  },
  badgeChipEmojis: { fontSize: 12, letterSpacing: 1 },
  badgeChipExtra: { ...TYPE.micro, color: colors.primaryInk, fontWeight: '800', marginLeft: 2 },
  // The design's own numbers: padding 7x13 around an 11.5px label, which is a
  // pill about 28 tall. `minHeight: MIN_TOUCH_TARGET` here made it 48 tall and
  // 52 wide, and a pill radius on a near-square box is a circle — which is
  // what shipped. The 44pt target is restored with hitSlop, which grows the
  // touch area without growing the button, the same split the chips use.
  selfEditBtn: {
    minHeight: EDIT_HEIGHT, paddingHorizontal: SPACE[4],
    borderRadius: RADII.pill, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.raised,
  },
  selfEditLabel: { ...TYPE.label, color: colors.ink },
  xpPill: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
    borderRadius: RADII.pill, paddingHorizontal: 10, paddingVertical: 5,
  },
  xpLabel: { ...TYPE.micro, color: colors.textPrimary, fontWeight: '800' },
  xpTrack: {
    width: 52, height: 5, borderRadius: RADII.pill,
    backgroundColor: colors.surfaceLight, overflow: 'hidden',
  },
  xpFill: { height: '100%', borderRadius: RADII.pill },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACE[1],
    minHeight: MIN_TOUCH_TARGET, paddingHorizontal: SPACE[4],
    borderRadius: RADII.pill, backgroundColor: colors.raised,
  },
  primaryLabel: { ...TYPE.label, color: colors.ink },
  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACE[1],
    minHeight: MIN_TOUCH_TARGET, paddingHorizontal: SPACE[4],
    borderRadius: RADII.pill, backgroundColor: colors.raised,
  },
  secondaryLabel: { ...TYPE.label, color: colors.ink },
  statusPill: { backgroundColor: colors.raised },
  statusPillLabel: { color: colors.ink2 },

  // — name block ——————————————————————————————————————————————
  nameBlock: { gap: 5 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  name: { ...TYPE.headline, color: colors.ink, flexShrink: 1 },
  pronounsBeside: { ...TYPE.meta, color: colors.ink2 },
  subtitle: { ...TYPE.meta, color: colors.ink2 },
  sellerChip: {
    borderRadius: RADII.pill, paddingHorizontal: SPACE[1], paddingVertical: SPACE[0] / 2,
    backgroundColor: colors.raised,
  },
  sellerChipText: { ...TYPE.meta, color: colors.ink2 },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: SPACE[0] },
  livePillText: { ...TYPE.meta, fontFamily: FONTS.text.semibold, color: colors.ink },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE[1], marginTop: SPACE[0] / 2 },
  pronounChip: {
    borderRadius: RADII.pill, paddingHorizontal: SPACE[2], paddingVertical: SPACE[0],
    backgroundColor: colors.pinkContainer,
  },
  pronounChipText: { ...TYPE.meta, color: colors.onPinkContainer },
  identityChip: {
    borderRadius: RADII.pill, paddingHorizontal: SPACE[2], paddingVertical: SPACE[0],
    backgroundColor: colors.raised,
  },
  identityChipText: { ...TYPE.meta, color: colors.ink },
  customChip: {
    borderRadius: RADII.pill, paddingHorizontal: SPACE[2], paddingVertical: SPACE[0],
    backgroundColor: colors.raised,
  },
  customChipText: { ...TYPE.meta, color: colors.ink2 },
  moreChip: {
    borderRadius: RADII.pill, paddingHorizontal: SPACE[2], paddingVertical: SPACE[0],
    backgroundColor: colors.raised,
    minHeight: SPACE[6] - SPACE[0], justifyContent: 'center',
  },
  moreChipText: { ...TYPE.meta, color: colors.ink2 },
  bio: { ...TYPE.body, color: colors.ink2 },
  bioMore: { ...TYPE.meta, color: colors.ink, marginTop: SPACE[0] / 2 },

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
    flexDirection: 'row', gap: SPACE[0], marginTop: SPACE[1],
    borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  tab: {
    minHeight: MIN_TOUCH_TARGET, paddingHorizontal: SPACE[2],
    alignItems: 'center', justifyContent: 'center',
    borderBottomWidth: 3, borderBottomColor: 'transparent',
    marginBottom: -1,
  },
  /** The 3 dp underline, like the Feed segments. */
  tabActive: { borderBottomColor: colors.pink },
  tabLabel: { ...TYPE.label, fontFamily: FONTS.text.medium, color: colors.ink2 },
  tabLabelActive: { fontFamily: FONTS.text.semibold, color: colors.ink },
  tabContent: { paddingTop: SPACE[2] },

  // — the three states ————————————————————————————————————————
  bodyState: { paddingVertical: SPACE[7], paddingHorizontal: SPACE[2], alignItems: 'center', gap: SPACE[2] },
  bodyStateText: { ...TYPE.body, color: colors.ink2, textAlign: 'center' },
  retryBtn: {
    minHeight: MIN_TOUCH_TARGET, paddingHorizontal: SPACE[5],
    alignItems: 'center', justifyContent: 'center',
    borderRadius: RADII.pill, backgroundColor: colors.raised,
  },
  retryLabel: { ...TYPE.label, color: colors.ink },
  skeletonGrid: { flexDirection: 'row', gap: SPACE[0], paddingTop: SPACE[2] },
  skeletonTile: { flex: 1, aspectRatio: 3 / 4, borderRadius: RADII.sm },
});
