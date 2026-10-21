import type { ReactNode } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { format } from 'date-fns';
import { RADII, identityFor, inkOn } from '../../lib/theme';
import { TYPE, emphasized, type TypeStep } from '../../lib/typography';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { PressableScale } from '../ui/PressableScale';

/** Poster height floor: the board's near-square poster on a 390 dp phone. */
export const POSTER_MIN_HEIGHT = 320;

/**
 * The poster title's step, by length (direction › Typography: "poster titles"
 * at `moment`; small poster titles at `display`). A long title steps down so
 * it never runs past three lines on a 360 dp phone.
 */
export function posterTitleStep(title: string): TypeStep {
  const n = title.trim().length;
  if (n <= 16) return TYPE.moment;
  if (n <= 40) return TYPE.display;
  return TYPE.headline;
}

interface Props {
  title: string;
  /** Picks the identity field: the community, else the event itself. */
  identityKey: string;
  communityName: string | null;
  onOpenCommunity?: () => void;
  startsAt: string;
  /** The RSVP seal, positioned by the poster in its top end corner. */
  seal?: ReactNode;
  testID?: string;
}

/**
 * The event as a poster (design direction v2 › signature moment 3, board
 * v2-03): one identity field (the community's colour), the community name at
 * the top start, the title at `moment` (stepping down when long), the date at
 * the bottom start. All ink is `inkOn(field)` (`onBrandPink` on every identity
 * colour, ≥ 4.96:1).
 *
 * What is NOT on the poster, on purpose: the place. The exact meeting point
 * is only on her ticket, and a poster is what gets screenshotted and shared.
 */
export function EventPoster({
  title, identityKey, communityName, onOpenCommunity, startsAt, seal, testID,
}: Props) {
  const field = identityFor(identityKey);
  const ink = inkOn(field);
  const when = Number.isNaN(Date.parse(startsAt)) ? null : format(new Date(startsAt), 'EEE d MMM · h:mm aaa');

  const s = StyleSheet.create({
    poster: {
      minHeight: POSTER_MIN_HEIGHT,
      borderRadius: RADII.md,
      backgroundColor: field,
      padding: 20,
      justifyContent: 'space-between',
      overflow: 'visible',
    },
    top: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', alignSelf: 'flex-start', paddingRight: 96 },
    community: { ...TYPE.label, color: ink },
    title: { ...posterTitleStep(title), color: ink },
    when: { ...emphasized('label'), color: ink },
    seal: { position: 'absolute', top: -12, right: -8 },
  });

  return (
    <View style={s.poster} testID={testID}>
      {communityName ? (
        onOpenCommunity ? (
          <PressableScale
            onPress={onOpenCommunity}
            feedback="layer"
            style={s.top}
            accessibilityRole="link"
            accessibilityLabel={`Open ${communityName}`}
            testID={testID ? `${testID}-community` : undefined}
          >
            <Text style={s.community} numberOfLines={2}>{communityName}</Text>
          </PressableScale>
        ) : (
          <View style={s.top}><Text style={s.community} numberOfLines={2}>{communityName}</Text></View>
        )
      ) : <View style={s.top} />}

      <Text style={s.title} numberOfLines={4} accessibilityRole="header" testID={testID ? `${testID}-title` : undefined}>
        {title}
      </Text>

      {when ? <Text style={s.when}>{when}</Text> : null}

      {seal ? <View style={s.seal} pointerEvents="none">{seal}</View> : null}
    </View>
  );
}
