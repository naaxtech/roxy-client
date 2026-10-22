import type { ReactElement } from 'react';
import { memo, useContext } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { TouchableOpacity } from '../ui/PressableScale';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { RADII, inkOn, THEMES } from '../../lib/theme';
import { TYPE } from '../../lib/typography';
import { DAILY_PROMPT_KICK, type DailyPrompt } from '../../lib/dailyPrompt';
import { TEXT_CARD_INK } from '../../lib/textCard';
import { CHROME_BOTTOM, RAIL_GUTTER, STAGE_TOP } from './feedChromeTokens';
import { STAGE } from './stageColors';
import { TextCardFace } from './TextCardFace';

interface Props {
  prompt: DailyPrompt;
  width: number;
  height: number;
  reducedMotion: boolean;
}

/** The composer route the answer opens. The question travels as an index, never as text. */
export function dailyPromptComposerHref(prompt: DailyPrompt) {
  return { pathname: '/community/create-post', params: { prompt: String(prompt.index) } } as const;
}

/**
 * Question of the day, as one page of For You.
 *
 * The same plum text card every text post wears, so it reads as part of the
 * feed rather than an ad for it; the kick says what it is. One tap on
 * "Answer it" opens the composer with the question already on the card. No
 * rail: there is no author to like or follow, and a swipe is the skip.
 * Memoised: a page change re-runs every mounted cell's render (jank audit #5).
 */
export const DailyPromptCell = memo(function DailyPromptCell({
  prompt, width, height,
}: Props): ReactElement {
  const router = useRouter();
  // The header's SafeAreaView adds the status bar; so does the card. Read the
  // context, not useSafeAreaInsets(): no provider (a test, a preview) means 0.
  const statusBar = useContext(SafeAreaInsetsContext)?.top ?? 0;

  const answer = () => {
    // §3.3 / P3: no haptic here (Wave 3: haptics fire only on the §3.3 events).
    router.push(dailyPromptComposerHref(prompt) as never);
  };

  return (
    <View testID="daily-prompt-cell" style={[s.page, { width, height }]}>
      {/* Below the feed header (STAGE_TOP), the same clearance as every top-anchored cell. */}
      <TextCardFace
        content={`${DAILY_PROMPT_KICK}\n${prompt.question}`}
        size="page"
        testIDPrefix="daily-prompt"
        maxWidth={width - 30 - RAIL_GUTTER}
        topInset={STAGE_TOP + statusBar}
        bottomInset={Math.round(height * 0.26)}
      />

      {/* Clear of the Roxy FAB on the right (RAIL_GUTTER), like every feed caption. */}
      <View style={s.footer} pointerEvents="box-none">
        <TouchableOpacity
          testID="daily-prompt-answer"
          style={s.answer}
          onPress={answer}
          accessibilityRole="button"
          accessibilityLabel={`Answer today's question: ${prompt.question}`}
          accessibilityHint="Opens a text card with the question on it"
          activeOpacity={0.85}
        >
          <Ionicons name="create-outline" size={18} color={inkOn(STAGE.primary)} />
          <Text style={s.answerText}>Answer it</Text>
        </TouchableOpacity>
        <Text style={s.note} testID="daily-prompt-note">
          Your answer posts to your profile as a text card. Swipe up to skip.
        </Text>
      </View>
    </View>
  );
});

const s = StyleSheet.create({
  page: { backgroundColor: THEMES.dark.stage },
  footer: {
    position: 'absolute',
    left: 30,
    right: RAIL_GUTTER,
    bottom: CHROME_BOTTOM + MIN_TOUCH_TARGET,
    gap: 10,
    alignItems: 'flex-start',
  },
  answer: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 22,
    borderRadius: RADII.pill,
    backgroundColor: STAGE.primary,
  },
  answerText: { ...TYPE.body, fontWeight: '800', color: inkOn(STAGE.primary) },
  // The card's own ink: STAGE.textSecondary measures ~3.4:1 on the ramp's pink end.
  note: { ...TYPE.caption, color: TEXT_CARD_INK },
});
