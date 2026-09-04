import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { channelLabel, type Channel } from '../../lib/channels';
import { a11yState } from '../../lib/a11yState';
import { inkOn } from '../../lib/theme';

interface Props {
  channels: Channel[];
  activeId: string | null;
  onSelect: (channel: Channel) => void;
  /** Live audio in this community, if any — the design's `🎙 stage · N`. */
  stageCount?: number | null;
  onJoinStage?: () => void;
  testID?: string;
}

const PILL_HEIGHT = 30;

/**
 * The design's channel chip row (markup 666–671).
 *
 * The ScrollView carries `flexGrow: 0, flexShrink: 0`. A horizontal ScrollView
 * has NO intrinsic height on react-native-web, so a flex sibling below it wins
 * the whole column and crushes this row — `MediaTypeChips` shipped exactly that
 * and rendered at 6px, invisible, while every unit test passed. The lesson costs
 * two properties here.
 */
export function ChannelBar({
  channels, activeId, onSelect, stageCount = null, onJoinStage, testID = 'channel-bar',
}: Props) {
  const colors = useThemeColors();

  const s = StyleSheet.create({
    scroller: { flexGrow: 0, flexShrink: 0 },
    row: {
      flexDirection: 'row',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 9,
      alignItems: 'center',
    },
    // Target and pill are separate: the pill keeps the design's 30px height
    // while the tappable area stays a full 44.
    target: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
    pill: {
      height: PILL_HEIGHT,
      justifyContent: 'center',
      borderRadius: 10,
      paddingHorizontal: 11,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
    },
    pillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    label: { ...TYPE.micro, fontWeight: '700', color: colors.textSecondary },
    labelActive: { color: inkOn(colors.primary) },
    stage: {
      height: PILL_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      borderRadius: 10,
      paddingHorizontal: 11,
      backgroundColor: colors.error,
    },
    stageDot: { width: 5, height: 5, borderRadius: 99, backgroundColor: '#FFF8FB' },
    stageText: { ...TYPE.micro, fontWeight: '700', color: '#FFF8FB' },
  });

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={s.scroller}
      contentContainerStyle={s.row}
      testID={testID}
    >
      {channels.map((channel) => {
        const active = channel.id === activeId;
        return (
          <Pressable
            key={channel.id}
            onPress={() => onSelect(channel)}
            style={s.target}
            accessible={false}
          >
            {/* The a11y identity sits on this View, not the Pressable: RNW
                strips unknown props from Pressable so `aria-*` never reaches
                the DOM, and `accessibilityState` alone is inert on 0.19. */}
            <View
              style={[s.pill, active && s.pillActive]}
              testID={`${testID}-${channel.slug}`}
              accessibilityRole="tab"
              accessibilityLabel={channelLabel(channel)}
              {...a11yState({ selected: active })}
            >
              <Text style={[s.label, active && s.labelActive]} numberOfLines={1}>
                {channelLabel(channel)}
              </Text>
            </View>
          </Pressable>
        );
      })}

      {/* Only when audio is actually live. A permanent stage button on a silent
          community advertises a room nobody is in. */}
      {stageCount !== null && stageCount > 0 && onJoinStage ? (
        <Pressable onPress={onJoinStage} style={s.target} accessible={false}>
          <View
            style={s.stage}
            testID={`${testID}-stage`}
            accessibilityRole="button"
            accessibilityLabel={`Join the live stage, ${stageCount} in the room`}
            aria-label={`Join the live stage, ${stageCount} in the room`}
          >
            <View style={s.stageDot} />
            <Text style={s.stageText}>🎙 stage · {stageCount}</Text>
          </View>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}
