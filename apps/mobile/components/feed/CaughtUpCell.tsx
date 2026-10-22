import type { ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TouchableOpacity } from '../ui/PressableScale';
import { MARGIN, RADII, SPACE } from '../../lib/theme';
import { TYPE } from '../../lib/typography';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { STAGE, STAGE_BG } from './stageColors';
import { FAB_LANE } from './feedChromeTokens';

/** The pager's last page: not a post. */
export const CAUGHT_UP_ID = '__caught_up__';

export type CaughtUpItem = { id: typeof CAUGHT_UP_ID; kind: 'caught_up' };

export function isCaughtUpItem(item: { id: string }): item is CaughtUpItem {
  return item.id === CAUGHT_UP_ID;
}

/**
 * The end of the feed (direction v2 › Feed): "You're caught up. Your
 * communities are talking in Messages." with the way there. On the stage, in
 * stage ink, clear of the Roxy AI lane. No emoji, no illustration.
 */
export function CaughtUpCell({
  width, height, onOpenMessages,
}: { width: number; height: number; onOpenMessages: () => void }): ReactElement {
  return (
    <View testID="feed-caught-up" style={[s.page, { width, height }]}>
      <View style={s.body}>
        <Text style={s.title} accessibilityRole="header">You&apos;re caught up.</Text>
        <Text style={s.line}>Your communities are talking in Messages.</Text>
        <TouchableOpacity
          testID="feed-caught-up-messages"
          style={s.button}
          onPress={onOpenMessages}
          accessibilityRole="button"
          accessibilityLabel="Open Messages"
        >
          <Text style={s.buttonText}>Open Messages</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  page: { backgroundColor: STAGE_BG, justifyContent: 'center' },
  body: {
    paddingLeft: MARGIN, paddingRight: MARGIN, paddingBottom: FAB_LANE, gap: SPACE[2],
    alignItems: 'flex-start',
  },
  title: { ...TYPE.headline, color: STAGE.ink },
  line: { ...TYPE.body, color: STAGE.ink2 },
  button: {
    marginTop: SPACE[2],
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: SPACE[4],
    borderRadius: RADII.pill,
    backgroundColor: STAGE.raised,
    justifyContent: 'center',
  },
  buttonText: { ...TYPE.button, color: STAGE.ink },
});
