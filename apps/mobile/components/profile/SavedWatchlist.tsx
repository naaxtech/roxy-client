import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useArchiveStore } from '../../store/archiveStore';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { RADII } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { logError } from '../../lib/errorLogger';
import { fetchArchiveEntries, formatScore, type ArchiveEntry } from '../../lib/archive';
import { ScorePill } from '../archive/ScorePill';

/**
 * Her Archive watchlist, on You › Saved.
 *
 * A pending member can keep this list before she can do anything else on Roxy —
 * it is the one thing she accumulates while she waits. Leaving it only inside
 * the Archive would make it a list she has to remember she made.
 *
 * It renders NOTHING when the list is empty, rather than an empty state. This
 * sits inside a Saved tab that already has its own sections, and a second
 * "nothing here yet" panel underneath the first is noise, not guidance.
 */
export function SavedWatchlist() {
  const router = useRouter();
  const colors = useThemeColors();
  const watchlist = useArchiveStore((s) => s.watchlist);

  const [entries, setEntries] = useState<ArchiveEntry[]>([]);
  const [failed, setFailed] = useState(false);

  // The store holds entry ids; the list needs rows. There is no `.in(id, [...])`
  // helper on `fetchArchiveEntries` and adding one for this screen would put a
  // query shape in the lib for a single caller — so it over-fetches by vote
  // count and narrows locally. The narrowing is the important half: rendering
  // the whole response would put the entire Archive in her saved tab.
  const load = useCallback(async () => {
    if (watchlist.length === 0) { setEntries([]); return; }
    setFailed(false);
    try {
      const all = await fetchArchiveEntries({ sort: 'voted', limit: 200 });
      const mine = new Set(watchlist);
      setEntries(all.filter((e) => mine.has(e.id)));
    } catch (e) {
      logError(e, 'SavedWatchlist.load');
      setFailed(true);
    }
  }, [watchlist]);

  useEffect(() => { void load(); }, [load]);

  const s = StyleSheet.create({
    wrap: { gap: 8, paddingHorizontal: 16, paddingTop: 16 },
    heading: { ...TYPE.micro, color: colors.textMuted, fontWeight: '800', letterSpacing: 0.6 },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      minHeight: MIN_TOUCH_TARGET, paddingHorizontal: 12, paddingVertical: 10,
      borderRadius: RADII.md, backgroundColor: colors.surface,
      borderWidth: 1, borderColor: colors.line,
    },
    body: { flex: 1, gap: 2 },
    title: { ...TYPE.body, color: colors.textPrimary, fontWeight: '700' },
    meta: { ...TYPE.micro, color: colors.textMuted },
    error: { ...TYPE.caption, color: colors.textSecondary },
    retry: { ...TYPE.caption, color: colors.primaryInk, fontWeight: '700', minHeight: MIN_TOUCH_TARGET },
  });

  if (watchlist.length === 0) return null;

  if (failed) {
    return (
      <View style={s.wrap} testID="watchlist-error">
        <Text style={s.heading}>WATCHLIST</Text>
        <Text style={s.error}>Could not load your watchlist.</Text>
        <Pressable onPress={() => void load()} accessibilityRole="button" accessibilityLabel="Try again">
          <Text style={s.retry}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={s.wrap} testID="saved-watchlist">
      <Text style={s.heading}>WATCHLIST · {watchlist.length}</Text>
      {entries.map((entry) => {
        // Through formatScore like every other surface — the >=10-vote gate has
        // one home, and a row doing its own division is how a one-vote entry
        // ends up showing 100%.
        const score = formatScore(entry.up_count, entry.vote_count);
        return (
          <Pressable
            key={entry.id}
            onPress={() => router.push(`/archive/${entry.slug}` as never)}
            accessible={false}
          >
            {/* a11y identity on the View: RN's Pressable drops aria-*, and
                accessibilityState is inert on react-native-web 0.19. */}
            <View
              style={s.row}
              accessibilityRole="button"
              accessibilityLabel={`${entry.title}. ${score.label}.`}
              testID={`watchlist-${entry.slug}`}
            >
              <View style={s.body}>
                <Text style={s.title} numberOfLines={1}>{entry.title}</Text>
                <Text style={s.meta} numberOfLines={1}>
                  {[entry.media_type.toUpperCase(), entry.release_year].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <ScorePill score={score} />
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
