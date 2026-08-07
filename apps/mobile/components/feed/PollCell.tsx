import { useCallback, useState } from 'react';
import type { ReactElement } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { THEMES } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { FeedCellChrome } from './FeedCellChrome';
import type { FeedBodyCellProps } from './FeedCellChrome';
import { BRAND_GRADIENT, CHROME_SHADOW, RAIL_GUTTER } from './feedChromeTokens';
import { pollShare, pollVoteTotal } from './poll';
import type { ParsedPoll } from './poll';

/**
 * The feed canvas is dark on every surface it serves, whatever the app theme
 * is: the chrome over it is white, and a light canvas would make the rail
 * invisible. So the tokens come from `THEMES.dark` explicitly rather than from
 * `useThemeColors()` — same source of truth, deliberately not theme-reactive.
 */
const DARK = THEMES.dark;

interface PollCellProps extends FeedBodyCellProps {
  /** Parsed by the router, so this cell never renders a poll with no answers. */
  poll: ParsedPoll;
  /** Resolves false when the vote did not land; the cell then rolls back. */
  onVote: (optionKey: string) => Promise<boolean>;
}

function votesLabel(n: number): string {
  return `${n} vote${n === 1 ? '' : 's'}`;
}

/**
 * A poll, full-bleed, answerable without leaving the feed.
 *
 * Results stay hidden until the viewer has answered. Showing the tally first
 * turns a question into a bandwagon, and the whole reason a poll is worth a
 * page of its own is that it asks something.
 *
 * The vote is optimistic because a poll that waits for a round trip before it
 * moves feels broken, and it rolls all the way back on failure — not merely
 * un-highlighted, but back to a poll that has not been voted in, because
 * leaving the results up after a failed write tells the viewer a lie about what
 * the community thinks.
 */
export function PollCell({
  post, poll, width, height, onOpenPost, onVote, ...chrome
}: PollCellProps): ReactElement {
  const [votedKey, setVotedKey] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const locked = pendingKey !== null || votedKey !== null;

  const vote = useCallback(async (optionKey: string) => {
    if (pendingKey !== null || votedKey !== null) return;
    setFailed(false);
    setPendingKey(optionKey);
    setVotedKey(optionKey);

    let ok = false;
    try {
      ok = await onVote(optionKey);
    } catch {
      ok = false;
    }

    setPendingKey(null);
    if (!ok) {
      setVotedKey(null);
      setFailed(true);
    }
  }, [onVote, pendingKey, votedKey]);

  // The viewer's own vote is folded into the tally the moment she casts it, so
  // the bars she sees include her.
  const counts: Record<string, number> = votedKey
    ? { ...post.reaction_counts, [votedKey]: (post.reaction_counts[votedKey] ?? 0) + 1 }
    : post.reaction_counts;
  const total = pollVoteTotal(counts, poll.options);
  const showResults = votedKey !== null;

  return (
    <View testID="poll-cell" style={[s.page, { width, height }]}>
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
        <View style={s.kicker}>
          <Ionicons name="bar-chart-outline" size={14} color="rgba(255,255,255,0.75)" />
          <Text style={s.kickerText}>POLL</Text>
        </View>

        <Text testID="poll-question" style={s.question} numberOfLines={5}>
          {poll.question}
        </Text>

        <View testID="poll-options" style={s.options} accessibilityRole="radiogroup">
          {poll.options.map((option, i) => {
            const chosen = votedKey === option.key;
            const share = showResults ? pollShare(counts, option, total) : 0;
            const percent = Math.round(share * 100);
            const optionVotes = counts[option.key] ?? 0;

            return (
              <TouchableOpacity
                key={option.key}
                testID={`poll-option-${i}`}
                style={[s.option, chosen && s.optionChosen]}
                onPress={() => { void vote(option.key); }}
                disabled={locked}
                accessibilityRole="radio"
                accessibilityState={{ checked: chosen, disabled: locked }}
                accessibilityLabel={
                  showResults
                    ? [
                      option.label,
                      chosen ? 'your vote' : null,
                      `${percent} percent`,
                      votesLabel(optionVotes),
                    ].filter(Boolean).join(', ')
                    : option.label
                }
                activeOpacity={0.85}
              >
                {showResults ? (
                  <LinearGradient
                    testID={`poll-fill-${i}`}
                    colors={BRAND_GRADIENT}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    // Held at 0.55 over the track: a solid brand fill puts white
                    // at 3.56:1 on the pink stop and 2.86:1 on the orange, both
                    // of which fail 4.5:1 at label size. Composited at 0.55 over
                    // the track the fill lands at (161,38,97) → 7.08:1.
                    style={[s.fill, { width: `${percent}%` as `${number}%`, opacity: 0.55 }]}
                    pointerEvents="none"
                  />
                ) : null}

                <Text style={s.optionLabel} numberOfLines={2}>{option.label}</Text>

                {chosen ? (
                  // The chosen option is marked with a glyph as well as a
                  // brighter bar: colour alone is not an indicator.
                  <Ionicons name="checkmark-circle" size={18} color="#fff" />
                ) : null}

                {showResults ? (
                  <Text testID={`poll-share-${i}`} style={s.share}>{`${percent}%`}</Text>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>

        {showResults ? (
          <Text testID="poll-total" style={s.total}>{votesLabel(total)}</Text>
        ) : (
          <Text style={s.total}>Tap to vote</Text>
        )}

        {failed ? (
          // Announced, not merely drawn. She taps, the optimistic tick rolls
          // back, and without this the only signal that her answer was lost is
          // one she cannot see. Same pattern as `FeedSafetySheet`.
          <View testID="poll-error" style={s.error} accessibilityLiveRegion="assertive">
            <Ionicons name="alert-circle-outline" size={16} color="#fff" />
            <Text style={s.errorText}>Your vote did not save. Tap an option to try again.</Text>
          </View>
        ) : null}

        <TouchableOpacity
          testID="poll-open"
          style={s.open}
          onPress={onOpenPost}
          accessibilityRole="button"
          accessibilityLabel="Open post"
        >
          <Text style={s.openText}>See the discussion</Text>
        </TouchableOpacity>
      </View>

      <FeedCellChrome post={post} showCaption={false} onOpenPost={onOpenPost} {...chrome} />
    </View>
  );
}

const s = StyleSheet.create({
  page: { backgroundColor: DARK.background },
  composition: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    paddingLeft: 24, paddingRight: RAIL_GUTTER, paddingTop: 56, gap: 14,
  },
  kicker: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kickerText: {
    color: 'rgba(255,255,255,0.75)', fontSize: 11,
    fontWeight: '800', letterSpacing: 1.4,
  },
  question: {
    color: '#fff', fontSize: 26, lineHeight: 33,
    fontWeight: '800', letterSpacing: -0.4, marginBottom: 4, ...CHROME_SHADOW,
  },
  options: { gap: 10 },
  open: {
    minHeight: MIN_TOUCH_TARGET, minWidth: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  option: {
    minHeight: 52, borderRadius: 14, overflow: 'hidden',
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  optionChosen: { borderColor: 'rgba(255,255,255,0.75)' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  optionLabel: { color: '#fff', fontSize: 16, fontWeight: '600', flex: 1 },
  share: { color: '#fff', fontSize: 14, fontWeight: '800' },
  total: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '600' },
  error: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(239,68,68,0.85)',
    paddingVertical: 9, paddingHorizontal: 12, borderRadius: 12,
  },
  errorText: { color: '#fff', fontSize: 13, flex: 1 },
  openText: { color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: '700' },
});
