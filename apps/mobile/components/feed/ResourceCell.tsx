import { useCallback, useState } from 'react';
import type { ComponentProps, ReactElement } from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { logError } from '../../lib/errorLogger';
import { THEMES } from '../../lib/theme';
import type { LinkType } from '../../types';
import { FeedCellChrome } from './FeedCellChrome';
import type { FeedBodyCellProps } from './FeedCellChrome';
import { BRAND_GRADIENT, CHROME_SHADOW, RAIL_GUTTER } from './feedChromeTokens';

/** See `PollCell` — the feed canvas is always the dark one. */
const DARK = THEMES.dark;

/**
 * Trailing `.`, `,` and `)` are almost always sentence punctuation rather than
 * part of the address, and a link that 404s because it swallowed a full stop is
 * worse than one that drops a rare trailing bracket.
 */
const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/;

type IoniconName = ComponentProps<typeof Ionicons>['name'];

const LINK_KIND: Record<LinkType, { icon: IoniconName; cta: string; meta: string }> = {
  game: { icon: 'game-controller-outline', cta: 'Join Game', meta: 'Game' },
  room: { icon: 'mic-outline', cta: 'Join Room', meta: 'Room' },
  event: { icon: 'calendar-outline', cta: 'View Event', meta: 'Event' },
};

export function extractUrl(content: string): string | null {
  const match = URL_IN_TEXT.exec(content);
  if (!match) return null;
  const url = match[0].replace(TRAILING_PUNCTUATION, '');
  return url.length > 'https://'.length ? url : null;
}

function hostOf(url: string): string {
  const match = /^https?:\/\/([^/?#]+)/.exec(url);
  if (!match) return url;
  return match[1].replace(/^www\./, '');
}

/**
 * A resource or a Roxy link, as a preview card with one clear action.
 *
 * Two destinations, one shape. A `resource` points out of the app and says so
 * by naming the host — a viewer should know she is about to leave before she
 * taps, not after. A `roxy_link` points at a game, a room or an event inside
 * Roxy and hands off to the caller, which owns routing.
 */
export function ResourceCell({
  post, width, height, onOpenPost, ...chrome
}: FeedBodyCellProps): ReactElement {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const isRoxyLink = post.post_type === 'roxy_link';
  const kind = isRoxyLink ? LINK_KIND[post.link_type ?? 'game'] : null;
  const url = isRoxyLink ? null : extractUrl(post.content);

  const lines = post.content.split('\n').map((l) => l.trim()).filter(Boolean);
  const firstLine = lines[0] ?? '';
  const titleFromText = url ? firstLine.replace(url, '').trim() : firstLine;
  const title = titleFromText || (url ? hostOf(url) : 'Untitled');
  const meta = url ? hostOf(url) : (kind?.meta ?? 'Resource');
  const cta = url ? `Open link at ${hostOf(url)}` : (kind?.cta ?? 'Open post');
  const icon: IoniconName = kind?.icon ?? 'link-outline';

  const open = useCallback(() => {
    // A Roxy link stays inside the app; the caller resolves game/room/event
    // routing because only it has the router.
    if (!url) {
      onOpenPost();
      return;
    }
    setBusy(true);
    setFailed(false);
    void Linking.openURL(url)
      .then(() => { setFailed(false); })
      .catch((err: unknown) => {
        logError(err, 'ResourceCell.open');
        setFailed(true);
      })
      .finally(() => { setBusy(false); });
  }, [url, onOpenPost]);

  return (
    <View testID="resource-cell" style={[s.page, { width, height }]}>
      <LinearGradient
        colors={[DARK.surface, DARK.background]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <View
        style={[s.composition, { paddingBottom: Math.round(height * 0.24) }]}
        pointerEvents="box-none"
      >
        <View style={s.card}>
          <View style={s.iconWell}>
            <Ionicons name={icon} size={26} color="#fff" />
          </View>

          <Text testID="resource-title" style={s.title} numberOfLines={3}>{title}</Text>
          <Text testID="resource-meta" style={s.meta} numberOfLines={1}>{meta}</Text>

          <TouchableOpacity
            testID="resource-open"
            onPress={open}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={cta}
            accessibilityState={{ busy, disabled: busy }}
            activeOpacity={0.85}
          >
            <LinearGradient
              colors={BRAND_GRADIENT}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={s.cta}
            >
              <Text style={s.ctaText}>
                {busy ? 'Opening…' : (kind?.cta ?? (url ? 'Open link' : 'Open post'))}
              </Text>
              <Ionicons name="arrow-forward" size={16} color="#fff" />
            </LinearGradient>
          </TouchableOpacity>

          {failed ? (
            <View testID="resource-error" style={s.error}>
              <Ionicons name="alert-circle-outline" size={16} color="#fff" />
              <Text style={s.errorText}>That link could not be opened. Try again.</Text>
            </View>
          ) : null}
        </View>
      </View>

      <FeedCellChrome post={post} showCaption={false} {...chrome} />
    </View>
  );
}

const s = StyleSheet.create({
  page: { backgroundColor: DARK.background },
  composition: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    paddingLeft: 24, paddingRight: RAIL_GUTTER, paddingTop: 56,
  },
  card: {
    borderRadius: 20, padding: 20, gap: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  iconWell: {
    width: 52, height: 52, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  title: {
    color: '#fff', fontSize: 24, lineHeight: 30,
    fontWeight: '800', letterSpacing: -0.4, ...CHROME_SHADOW,
  },
  meta: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '600' },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    minHeight: 46, borderRadius: 23, paddingHorizontal: 20, marginTop: 4,
  },
  ctaText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  error: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(239,68,68,0.85)',
    paddingVertical: 9, paddingHorizontal: 12, borderRadius: 12,
  },
  errorText: { color: '#fff', fontSize: 13, flex: 1 },
});
