import { View, Text, Pressable, Share, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { RADII } from '../../lib/theme';
import { coverGradientFor } from '../../lib/coverGradient';
import { archiveTypeLabel } from '../../lib/archiveTypes';
import { archiveShare } from '../../lib/archiveShare';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import type { ArchiveMediaType } from '../../lib/archive';

interface Props {
  slug: string;
  title: string;
  mediaType: ArchiveMediaType;
  meta: string;
  coverGradient: string | null;
  testID?: string;
}

/** The design's own numbers: a 196px banner, a poster lifted 42px into it. */
const BANNER_HEIGHT = 196;
const POSTER_WIDTH = 84;
const POSTER_HEIGHT = 118;
const POSTER_LIFT = -42;

/**
 * The entry page's masthead.
 *
 * The design gives an Archive entry a 196px gradient banner with a poster
 * overlapping its lower edge, and that colour is most of what makes the screen
 * feel like a catalogue rather than a form. The live page had neither: a bare
 * score ring on a flat background, which read as a settings row.
 *
 * The scrim is the part that makes it work. A gradient banner running straight
 * into the page background produces a hard seam, so the design lays a
 * background-coloured wash over it — transparent at the top, opaque at the
 * bottom — and the banner appears to dissolve into the page. The poster then
 * sits across that boundary with a 2px border in the background colour, which
 * is what separates it from the banner behind it.
 *
 * src: docs/handoff/roxy-3.0/Roxy App.dc.html · markup 1015–1022 · 2026-09-05
 */
export function EntryHero({ slug, title, mediaType, meta, coverGradient, testID }: Props) {
  const colors = useThemeColors();
  const art = coverGradientFor(coverGradient, slug);

  const s = StyleSheet.create({
    banner: { height: BANNER_HEIGHT },
    scrim: { ...StyleSheet.absoluteFillObject },
    // Pulled up into the banner so the poster crosses the seam, exactly as the
    // design has it. `zIndex` because on web the banner paints after otherwise.
    body: {
      paddingHorizontal: 16,
      marginTop: POSTER_LIFT,
      flexDirection: 'row',
      gap: 12,
      alignItems: 'flex-end',
      zIndex: 1,
    },
    poster: {
      width: POSTER_WIDTH,
      height: POSTER_HEIGHT,
      borderRadius: RADII.md,
      borderWidth: 2,
      // The border is the page's own background, which is what lifts the poster
      // off the banner rather than letting the two colours meet.
      borderColor: colors.background,
      overflow: 'hidden',
    },
    posterFill: { flex: 1 },
    // The design floats this in the banner's top-right corner. A hit target of
    // 44 with a 32px visual is the same target/pill split the chips use.
    shareHit: {
      position: 'absolute',
      top: 10,
      right: 10,
      width: MIN_TOUCH_TARGET,
      height: MIN_TOUCH_TARGET,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 2,
    },
    shareGlass: {
      width: 32,
      height: 32,
      borderRadius: 99,
      alignItems: 'center',
      justifyContent: 'center',
      // The design's own glass: a dark wash over the art with a hairline edge,
      // which is what keeps the icon legible on a banner of unknown colour.
      backgroundColor: 'rgba(13,5,32,0.5)',
      borderWidth: 1,
      borderColor: 'rgba(255,249,251,0.25)',
    },
    shareGlyph: { color: '#FFF8FB', fontSize: 15, lineHeight: 17 },
    text: { flex: 1, paddingBottom: 4, gap: 2 },
    eyebrow: {
      ...TYPE.micro,
      color: colors.primaryInk,
      fontWeight: '800',
      letterSpacing: 1.2,
    },
    title: { ...TYPE.headline, color: colors.textPrimary },
    meta: { ...TYPE.caption, color: colors.textSecondary },
  });

  return (
    <View testID={testID}>
      <LinearGradient
        colors={art as [string, string, ...string[]]}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.85, y: 1 }}
        style={s.banner}
        testID={testID ? `${testID}-banner` : undefined}
      >
        {/* Transparent at the top, the page's background at the bottom, so the
            banner dissolves instead of ending in a seam. */}
        <LinearGradient
          colors={['transparent', colors.background]}
          locations={[0.35, 1]}
          style={s.scrim}
        />
      </LinearGradient>

      <Pressable
        onPress={() => {
          const payload = archiveShare(slug, title);
          void Share.share(payload).catch(() => { /* viewer dismissed the sheet */ });
        }}
        style={s.shareHit}
        testID={testID ? `${testID}-share` : undefined}
        accessible={false}
      >
        {/* On a View, not the Pressable: RNW strips unknown props from Pressable,
            so a11y identity placed there never reaches the DOM. */}
        <View
          style={s.shareGlass}
          accessibilityRole="button"
          accessibilityLabel={`Share ${title}`}
          aria-label={`Share ${title}`}
        >
          <Text style={s.shareGlyph}>➦</Text>
        </View>
      </Pressable>

      <View style={s.body}>
        <View style={s.poster} testID={testID ? `${testID}-poster` : undefined}>
          <LinearGradient
            colors={art as [string, string, ...string[]]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={s.posterFill}
          />
        </View>

        <View style={s.text}>
          <Text style={s.eyebrow}>{archiveTypeLabel(mediaType).toUpperCase()}</Text>
          {/* Two lines. A 39-character title on one line is the crop this
              codebase already fixed in the rails. */}
          <Text style={s.title} numberOfLines={2}>{title}</Text>
          <Text style={s.meta} numberOfLines={2}>{meta}</Text>
        </View>
      </View>
    </View>
  );
}
