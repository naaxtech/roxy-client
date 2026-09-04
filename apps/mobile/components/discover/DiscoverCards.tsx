import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useThemeColors } from '../../hooks/useThemeColors';
import { avatarGradient } from '../../lib/avatars';
import { TYPE } from '../../lib/typography';
import { RADII, LIVE_GRADIENT, inkOn, type ThemeColors } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { RankNumeral } from './RankNumeral';

/**
 * A badge that names the kind of thing a card is.
 *
 * Always a word, never a colour on its own. `live` additionally carries a dot,
 * because "is this happening right now" is the one piece of state on this screen
 * a viewer acts on immediately, and SC 1.4.1 is not satisfied by a red pill.
 */
export type BadgeKind = 'live' | 'inPerson' | 'online' | 'shop' | 'game' | 'community' | 'impact';

const BADGE_TEXT: Record<BadgeKind, string> = {
  live: 'LIVE',
  inPerson: 'IN PERSON',
  online: 'ONLINE',
  shop: 'SHOP',
  game: 'GAME',
  community: 'COMMUNITY',
  impact: 'IMPACT',
};

function Badge({ kind }: { kind: BadgeKind }) {
  const colors = useThemeColors();
  const s = styles(colors);

  if (kind === 'live') {
    const ink = inkOn(LIVE_GRADIENT[1]);
    return (
      <LinearGradient
        colors={LIVE_GRADIENT}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={s.badge}
      >
        <View style={[s.dot, { backgroundColor: ink }]} />
        <Text style={[s.badgeText, { color: ink }]}>{BADGE_TEXT.live}</Text>
      </LinearGradient>
    );
  }

  // In person is pink, online is lilac — the design's pairing. The word carries
  // the meaning; the colour only makes it faster to find.
  const fill = kind === 'inPerson' ? colors.primary
    : kind === 'online' ? colors.secondary
      : colors.surfaceLight;
  const ink = kind === 'inPerson' || kind === 'online' ? inkOn(fill) : colors.textSecondary;

  return (
    <View style={[s.badge, { backgroundColor: fill }]}>
      <Text style={[s.badgeText, { color: ink }]}>{BADGE_TEXT[kind]}</Text>
    </View>
  );
}

export interface PosterCardProps {
  title: string;
  subtitle: string;
  badge?: BadgeKind;
  /** Seed for the placeholder art. Real cover images land here later. */
  artSeed: string;
  /** Renders the stroked Netflix numeral to the left of the card. */
  rank?: number;
  onPress: () => void;
  testID?: string;
}

/** The default rail card: art plate, badge, title, one line of meta. */
export function PosterCard({
  title, subtitle, badge, artSeed, rank, onPress, testID,
}: PosterCardProps) {
  const colors = useThemeColors();
  const s = styles(colors);
  const grad = avatarGradient(artSeed);

  const card = (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        rank
          ? `Number ${rank}. ${title}. ${badge ? `${BADGE_TEXT[badge]}. ` : ''}${subtitle}`
          : `${title}. ${badge ? `${BADGE_TEXT[badge]}. ` : ''}${subtitle}`
      }
      activeOpacity={0.85}
      style={s.poster}
      testID={testID}
    >
      <LinearGradient colors={grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.art}>
        {badge ? <View style={s.badgeSlot}><Badge kind={badge} /></View> : null}
      </LinearGradient>
      {/* Two lines, with the height reserved either way. One line cropped
          every real name — "The Rise and Fall of a Midwest Princess" is 39
          characters and about 25 fit — and letting the block grow only when a
          title is long made each card in the rail a different height, which is
          what made the row look broken. */}
      <Text style={s.title} numberOfLines={2}>{title}</Text>
      <Text style={s.meta} numberOfLines={1}>{subtitle}</Text>
    </TouchableOpacity>
  );

  if (!rank) return card;
  return (
    <View style={s.ranked}>
      <RankNumeral rank={rank} />
      {card}
    </View>
  );
}

export interface RowCardProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  badge?: BadgeKind;
  artSeed: string;
  onPress: () => void;
  testID?: string;
}

/** The wider card used by Live now and Games — an icon plate, not cover art. */
export function RowCard({ icon, title, subtitle, badge, artSeed, onPress, testID }: RowCardProps) {
  const colors = useThemeColors();
  const s = styles(colors);
  const grad = avatarGradient(artSeed);

  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${badge ? `${BADGE_TEXT[badge]}. ` : ''}${subtitle}`}
      activeOpacity={0.85}
      style={s.row}
      testID={testID}
    >
      <LinearGradient colors={grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.plate}>
        <Ionicons name={icon} size={20} color={inkOn(grad[1])} />
      </LinearGradient>
      <View style={s.rowText}>
        {badge ? <View style={s.badgeInline}><Badge kind={badge} /></View> : null}
        <Text style={s.title} numberOfLines={1}>{title}</Text>
        {/* Two lines. Found by a browser audit rather than a unit test: Speed
            Dating's short_description is 51 characters into a 168px box, so
            one line cut it mid-sentence. The row is fixed rather than the row's
            copy, because the next long description would break identically. */}
        <Text style={s.rowMeta} numberOfLines={2}>{subtitle}</Text>
      </View>
    </TouchableOpacity>
  );
}

export interface HeroCardProps {
  /**
   * Optional because `BadgeKind` has no value for a hybrid event, and the hero
   * is the loudest card on the board — a required pill there forced a both-ways
   * event to advertise itself as one or the other. A caller with no truthful
   * pill to show omits it and says the mode in `meta` instead.
   */
  badge?: BadgeKind;
  title: string;
  meta: string;
  body: string;
  cta: string;
  artSeed: string;
  onPress: () => void;
}

/** The one full-width card at the top of Discover. */
export function HeroCard({ badge, title, meta, body, cta, artSeed, onPress }: HeroCardProps) {
  const colors = useThemeColors();
  const s = styles(colors);
  const grad = avatarGradient(artSeed);

  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      // Without a pill the mode still has to reach a screen reader, and it does:
      // callers that omit `badge` put the word in `meta`, which is already here.
      accessibilityLabel={
        badge
          ? `${title}. ${BADGE_TEXT[badge]}. ${meta}. ${cta}`
          : `${title}. ${meta}. ${cta}`
      }
      activeOpacity={0.9}
      style={s.hero}
      testID="discover-hero"
    >
      <LinearGradient colors={grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.heroArt} />
      <View style={s.heroBody}>
        {badge ? <View style={s.badgeInline}><Badge kind={badge} /></View> : null}
        <Text style={s.heroTitle} numberOfLines={2}>{title}</Text>
        <Text style={s.meta} numberOfLines={1}>{meta}</Text>
        <Text style={s.heroText} numberOfLines={2}>{body}</Text>
        <View style={s.heroCta}>
          <Text style={s.heroCtaText}>{cta}</Text>
          <Ionicons name="arrow-forward" size={15} color={inkOn(colors.primary)} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = (colors: ThemeColors) => StyleSheet.create({
  poster: { width: 164, gap: 5 },
  art: { height: 96, borderRadius: RADII.md, padding: 8, justifyContent: 'flex-start' },
  badgeSlot: { alignSelf: 'flex-start' },
  badgeInline: { alignSelf: 'flex-start' },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADII.pill,
    alignSelf: 'flex-start',
  },
  badgeText: { ...TYPE.micro, fontWeight: '800' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  title: {
    ...TYPE.caption,
    color: colors.textPrimary,
    fontWeight: '700',
    // Two lines of caption leading, reserved whether or not the title needs
    // them, so every card in a rail bottoms out level.
    minHeight: TYPE.caption.lineHeight * 2,
  },
  meta: { ...TYPE.micro, color: colors.textSecondary },
  ranked: { flexDirection: 'row', alignItems: 'flex-end' },

  row: {
    width: 252, minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 10, borderRadius: RADII.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
  },
  plate: { width: 40, height: 40, borderRadius: RADII.sm, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: 2 },
  // Two lines of micro leading, reserved either way, so a rail of row cards
  // bottoms out level whether a subtitle needs one line or two.
  rowMeta: { ...TYPE.micro, color: colors.textSecondary, minHeight: TYPE.micro.lineHeight * 2 },

  hero: {
    marginHorizontal: 16, borderRadius: RADII.lg, overflow: 'hidden',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
  },
  heroArt: { height: 116 },
  heroBody: { padding: 14, gap: 5 },
  heroTitle: { ...TYPE.headline, color: colors.textPrimary },
  heroText: { ...TYPE.caption, color: colors.textSecondary, lineHeight: 18 },
  heroCta: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    marginTop: 6, minHeight: MIN_TOUCH_TARGET, paddingHorizontal: 16,
    borderRadius: RADII.pill, backgroundColor: colors.primary,
  },
  heroCtaText: { ...TYPE.bodyLg, fontWeight: '700', color: inkOn(colors.primary) },
});
