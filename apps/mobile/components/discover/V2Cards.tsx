import { View, Text, StyleSheet } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { TouchableOpacity } from '../ui/PressableScale';
import { initialsOf } from '../ui/Avatar';
import { useThemeColors } from '../../hooks/useThemeColors';
import { isPresetAvatar, presetColor, presetEmoji } from '../../lib/avatars';
import { TYPE, emphasized } from '../../lib/typography';
import {
  RADII, SPACE, MARGIN, identityFor, inkOn, type ThemeColors,
} from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { Crest, CREST_RADIUS_RATIO } from './Crest';
import { LiveDot } from './LiveDot';

/**
 * Discover's v2 cards and rows (design direction v2 › Discover, board v2-05).
 *
 * The product's own objects lead: events are posters in their community's
 * identity colour, communities are rows with a crest squircle and a tonal
 * Join, Top 10 is photo-first with a plain rank number, Live is a dot plus
 * the word. No gradient art, no caps badges, no stroked numerals — those were
 * v0's `PosterCard` / `RowCard` / `HeroCard` (kept, retired, in
 * `DiscoverCards.tsx`).
 */

/** A row's height (direction › Spacing: rows 56 / 64 / 72) and its crest. */
const ROW_MIN = 72;
const CREST = 48;
/** Posters stand 3:4; member photos 4:5; shop tiles 4:3. */
const POSTER_RATIO = 4 / 3;
const PHOTO_RATIO = 5 / 4;
const TILE_RATIO = 3 / 4;
/** A Top 10 name may take two lines (and every card keeps room for two). */
const MEMBER_NAME_LINES = 2;

// — Event poster ——————————————————————————————————————————————————————

export interface EventPosterProps {
  /** Identity seed: the community's name when there is one, else the event id. */
  seed: string;
  title: string;
  /** "Sat 25 Oct" — the date, as words. */
  when: string;
  /** The community hosting it, or "Open to members". */
  host: string;
  /** Mode and price in words: "In person · Free", "In person and online · £8". */
  detail: string;
  width: number;
  onPress: () => void;
  testID?: string;
}

/** An event as a poster in its community's identity colour. */
export function EventPoster({
  seed, title, when, host, detail, width, onPress, testID,
}: EventPosterProps) {
  const fill = identityFor(seed);
  const ink = inkOn(fill);
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${when}. ${host}. ${detail}`}
      style={[
        s.poster,
        { width, height: Math.round(width * POSTER_RATIO), backgroundColor: fill },
      ]}
      testID={testID}
    >
      <Text style={[s.posterWhen, { color: ink }]} numberOfLines={1}>{when}</Text>
      <View style={s.posterSpacer} />
      <Text style={[s.posterTitle, { color: ink }]} numberOfLines={3}>{title}</Text>
      <View style={s.posterSpacer} />
      <Text style={[s.posterHost, { color: ink }]} numberOfLines={2}>{host}</Text>
      <Text style={[s.posterDetail, { color: ink }]} numberOfLines={1}>{detail}</Text>
    </TouchableOpacity>
  );
}

// — Community row ——————————————————————————————————————————————————————

/** Where she stands with a community: a tonal Join, or a quiet state. */
export type JoinState = 'join' | 'joined' | 'requested';

export interface CommunityRowProps {
  id: string;
  name: string;
  /** "2,310 members", "Official · 880 members". */
  meta: string;
  join: JoinState;
  onJoin?: () => void;
  onPress: () => void;
  /** An uploaded crest, when the community has one. */
  crestUrl?: string | null;
  testID?: string;
}

const JOIN_WORD: Record<JoinState, string> = {
  join: 'Join',
  joined: 'Joined',
  requested: 'Requested',
};

/** A 72 dp community row: crest squircle with initials, name, count, Join. */
export function CommunityRow({
  id, name, meta, join, onJoin, onPress, crestUrl, testID,
}: CommunityRowProps) {
  const colors = useThemeColors();
  const st = rowStyles(colors);
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}. ${meta}`}
      style={st.row}
      feedback="layer"
      testID={testID}
    >
      <Crest name={name} uri={crestUrl} size={CREST} />
      <View style={st.text}>
        <Text style={st.title} numberOfLines={1}>{name}</Text>
        <Text style={st.meta} numberOfLines={1}>{meta}</Text>
      </View>
      {join === 'join' && onJoin ? (
        <TouchableOpacity
          onPress={onJoin}
          accessibilityRole="button"
          accessibilityLabel={`Join ${name}`}
          style={[st.joinPill, { backgroundColor: colors.pinkContainer }]}
          testID={`community-join-${id}`}
        >
          <Text style={[st.joinLabel, { color: colors.onPinkContainer }]}>{JOIN_WORD.join}</Text>
        </TouchableOpacity>
      ) : (
        <View
          accessibilityRole="text"
          style={[st.joinPill, { backgroundColor: colors.raised }]}
          testID={`community-join-${id}`}
        >
          <Text style={[st.joinLabel, { color: colors.ink2 }]}>{JOIN_WORD[join]}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// — Live row ——————————————————————————————————————————————————————————

export interface LiveRowProps {
  /** Identity seed for the crest: the community's name, else the room's. */
  seed: string;
  title: string;
  /** "14 listening" / "6 watching". */
  count: string;
  onPress: () => void;
  testID?: string;
}

/** A live room: crest, name, and LIVE as a dot plus the word. */
export function LiveRow({ seed, title, count, onPress, testID }: LiveRowProps) {
  const colors = useThemeColors();
  const st = rowStyles(colors);
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. Live, ${count}`}
      style={st.row}
      feedback="layer"
      testID={testID}
    >
      <Crest name={seed} size={CREST} />
      <View style={st.text}>
        <Text style={st.title} numberOfLines={1}>{title}</Text>
        <View style={st.liveLine}>
          <LiveDot testID={testID ? `${testID}-dot` : undefined} />
          <Text style={st.meta} numberOfLines={1}>{`LIVE · ${count}`}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// — List row (games, ideas) ————————————————————————————————————————————

export interface ListRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  seed: string;
  title: string;
  subtitle: string;
  onPress: () => void;
  testID?: string;
}

/** A quiet row with an identity squircle carrying a 24 dp outline icon. */
export function ListRow({ icon, seed, title, subtitle, onPress, testID }: ListRowProps) {
  const colors = useThemeColors();
  const st = rowStyles(colors);
  const fill = identityFor(seed);
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      style={st.row}
      feedback="layer"
      testID={testID}
    >
      <View style={[st.iconSquircle, { backgroundColor: fill }]}>
        <Ionicons name={icon} size={SPACE[5]} color={inkOn(fill)} />
      </View>
      <View style={st.text}>
        <Text style={st.title} numberOfLines={1}>{title}</Text>
        <Text style={st.meta} numberOfLines={2}>{subtitle}</Text>
      </View>
    </TouchableOpacity>
  );
}

// — Top 10 member card ——————————————————————————————————————————————————

export interface MemberCardProps {
  rank: number;
  name: string;
  subtitle: string;
  avatarUrl?: string | null;
  /** Identity seed for the no-photo field (her id). */
  seed: string;
  width: number;
  onPress: () => void;
  testID?: string;
}

/** Top 10: her photo first, then a plain rank number and her name. */
export function MemberCard({
  rank, name, subtitle, avatarUrl, seed, width, onPress, testID,
}: MemberCardProps) {
  const colors = useThemeColors();
  const st = rowStyles(colors);
  const height = Math.round(width * PHOTO_RATIO);
  const box = { width, height, borderRadius: RADII.md };
  const fill = identityFor(seed);

  let face;
  if (avatarUrl && isPresetAvatar(avatarUrl)) {
    face = (
      <View style={[box, st.photoFallback, { backgroundColor: presetColor(avatarUrl) }]} testID={testID ? `${testID}-preset` : undefined}>
        <Text style={st.photoEmoji}>{presetEmoji(avatarUrl)}</Text>
      </View>
    );
  } else if (avatarUrl) {
    face = (
      <ExpoImage
        source={{ uri: avatarUrl }}
        style={[st.photo, box] as never}
        contentFit="cover"
        testID={testID ? `${testID}-photo` : undefined}
        accessibilityIgnoresInvertColors
      />
    );
  } else {
    face = (
      <View style={[box, st.photoFallback, { backgroundColor: fill }]} testID={testID ? `${testID}-initials` : undefined}>
        <Text style={[st.photoInitials, { color: inkOn(fill) }]}>{initialsOf(name)}</Text>
      </View>
    );
  }

  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Number ${rank}. ${name}. ${subtitle}`}
      style={[st.card, { width }]}
      testID={testID}
    >
      {face}
      <View style={st.rankLine}>
        <Text style={st.rank} testID={testID ? `${testID}-rank` : undefined}>{rank}</Text>
        {/* Two lines, reserved on every card: a long name wraps at a word
            instead of being cut (live discover-audit, Wave 2: "Aimee Naught
            Straight" needed 156 px of a 134 px line), and the row stays even. */}
        <Text style={[st.title, st.memberName]} numberOfLines={MEMBER_NAME_LINES}>{name}</Text>
      </View>
      <Text style={st.meta} numberOfLines={1}>{subtitle}</Text>
    </TouchableOpacity>
  );
}

// — Tile card (shops, impact) ——————————————————————————————————————————

export interface TileCardProps {
  seed: string;
  title: string;
  meta: string;
  width: number;
  onPress: () => void;
  testID?: string;
}

/** A shop or project: an identity tile with its initials, then its name. */
export function TileCard({ seed, title, meta, width, onPress, testID }: TileCardProps) {
  const colors = useThemeColors();
  const st = rowStyles(colors);
  const fill = identityFor(seed);
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${meta}`}
      style={[st.card, { width }]}
      testID={testID}
    >
      <View
        style={[
          st.photoFallback,
          { width, height: Math.round(width * TILE_RATIO), borderRadius: RADII.md, backgroundColor: fill },
        ]}
      >
        <Text style={[st.tileInitials, { color: inkOn(fill) }]}>{initialsOf(title)}</Text>
      </View>
      <Text style={[st.title, st.tileTitle]} numberOfLines={2}>{title}</Text>
      <Text style={st.meta} numberOfLines={1}>{meta}</Text>
    </TouchableOpacity>
  );
}

// — Skeletons ———————————————————————————————————————————————————————————

/** Which card a loading placeholder stands in for. */
export type CardSkeletonKind = 'poster' | 'member' | 'tile' | 'row';

export interface CardSkeletonProps {
  kind: CardSkeletonKind;
  /** The card's width (posters, member and tile cards); rows fill the line. */
  width?: number;
  testID?: string;
}

/**
 * One card's loading shape at that card's FINAL geometry (budgets F8/F9).
 *
 * Built from the same ratios and style objects as the card it stands for —
 * the poster's 3:4 box, the photo's 4:5 plus the rank and meta lines at their
 * line heights, the tile's 4:3 plus two title lines, the row's 72 dp — so the
 * rail does not move when content lands. Discover used one 140 x 180 box for
 * every card and 48 dp rows for every row (jank audit #4: tab-cycle CLS 0.19).
 */
export function CardSkeleton({ kind, width = 0, testID }: CardSkeletonProps) {
  const colors = useThemeColors();
  const st = rowStyles(colors);
  const fill = { backgroundColor: colors.raised };
  const id = (part: string) => (testID ? `${testID}-${part}` : undefined);
  // The card's own Text, same style and line budget, ink invisible: the line
  // boxes come out identical whatever the font, with no guessed heights.
  const ghost = (part: string, style: object, lines?: number) => (
    <Text style={[style, sk.ghostInk]} numberOfLines={lines} testID={id(part)}>{GHOST}</Text>
  );
  const bar = (short = false) => (
    <View style={[sk.bar, fill, short && sk.barShort]} pointerEvents="none" />
  );

  if (kind === 'poster') {
    return (
      <View
        style={[s.poster, { width, height: Math.round(width * POSTER_RATIO) }, fill]}
        testID={testID}
      />
    );
  }
  if (kind === 'row') {
    return (
      <View style={st.row} testID={testID}>
        <View style={[st.iconSquircle, fill]} />
        <View style={st.text}>
          <View>{ghost('name', st.title, 1)}{bar()}</View>
          <View>{ghost('meta', st.meta, 1)}{bar(true)}</View>
        </View>
      </View>
    );
  }
  const member = kind === 'member';
  return (
    <View style={[st.card, { width }]} testID={testID}>
      <View
        style={[{ width, height: Math.round(width * (member ? PHOTO_RATIO : TILE_RATIO)), borderRadius: RADII.md }, fill]}
        testID={id('media')}
      />
      {member ? (
        <View style={st.rankLine}>
          {ghost('rank', st.rank)}
          {ghost('name', [st.title, st.memberName], MEMBER_NAME_LINES)}
          {bar()}
        </View>
      ) : (
        <View>{ghost('name', [st.title, st.tileTitle], 2)}{bar()}</View>
      )}
      <View>{ghost('meta', st.meta, 1)}{bar(true)}</View>
    </View>
  );
}

/** A no-break space: one line box of the style's own height. */
const GHOST = '\u00A0';

const sk = StyleSheet.create({
  ghostInk: { color: 'transparent' },
  bar: {
    position: 'absolute', left: 0, top: SPACE[1] / 2,
    height: SPACE[2], width: '80%', borderRadius: RADII.pill,
  },
  barShort: { width: '55%', top: SPACE[0] },
});

const s = StyleSheet.create({
  poster: { borderRadius: RADII.md, padding: SPACE[2], overflow: 'hidden' },
  posterWhen: { ...emphasized('meta') },
  posterSpacer: { flex: 1 },
  posterTitle: { ...emphasized('title') },
  posterHost: { ...emphasized('meta') },
  posterDetail: { ...TYPE.meta },
});

const rowStyles = (colors: ThemeColors) => StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[2],
    minHeight: ROW_MIN, paddingHorizontal: MARGIN, paddingVertical: SPACE[1],
  },
  text: { flex: 1, gap: SPACE[0] / 2 },
  title: { ...TYPE.label, color: colors.ink, flexShrink: 1 },
  meta: { ...TYPE.meta, color: colors.ink2 },
  liveLine: { flexDirection: 'row', alignItems: 'center', gap: SPACE[1] },
  joinPill: {
    minHeight: MIN_TOUCH_TARGET, minWidth: MIN_TOUCH_TARGET,
    paddingHorizontal: SPACE[3], borderRadius: RADII.pill,
    alignItems: 'center', justifyContent: 'center',
  },
  joinLabel: { ...TYPE.label },
  iconSquircle: {
    width: CREST, height: CREST, borderRadius: Math.round(CREST * CREST_RADIUS_RATIO),
    alignItems: 'center', justifyContent: 'center',
  },
  card: { gap: SPACE[0] },
  photo: { overflow: 'hidden' },
  photoFallback: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  photoEmoji: { ...TYPE.display },
  photoInitials: { ...TYPE.display },
  tileInitials: { ...TYPE.headline },
  tileTitle: { minHeight: TYPE.label.lineHeight * 2 },
  memberName: { minHeight: TYPE.label.lineHeight * MEMBER_NAME_LINES },
  rankLine: { flexDirection: 'row', alignItems: 'baseline', gap: SPACE[1], marginTop: SPACE[0] },
  rank: { ...TYPE.title, color: colors.ink, fontVariant: ['tabular-nums'] },
});
