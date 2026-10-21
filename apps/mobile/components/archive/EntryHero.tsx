import { View, Text, Share, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { archiveTypeLabel } from '../../lib/archiveTypes';
import { archiveShare } from '../../lib/archiveShare';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import type { ArchiveMediaType } from '../../lib/archive';
import { PressableScale } from '../ui/PressableScale';
import { ArchiveCover } from './ArchiveCover';
import { COVER_WIDTH } from './archiveTokens';

interface Props {
  /** Picks the type cover's identity field. */
  entryId: string;
  slug: string;
  title: string;
  mediaType: ArchiveMediaType;
  /** Year · creator · length, already joined by the screen. */
  meta: string;
  /** The uploaded cover, if any. */
  coverUrl: string | null;
  /**
   * RETIRED (v2): the seeded CSS gradient (migration 098) is no longer painted
   * — the fallback is the designed type cover. Kept so the screen and older
   * callers compile; the value is ignored. Origin: `git log -S coverGradientFor`
   * (Roxy 3.0 Archive hero, 2026-09-05).
   */
  coverGradient?: string | null;
  /** Opens Suggest an edit with the cover field focused. Shown only without a cover. */
  onAddCover?: () => void;
  testID?: string;
}

/**
 * The entry page's masthead (design direction v2 › Screen notes › Archive).
 *
 * The cover leads: uploaded covers at 2:3 with nothing written over them, or
 * the designed type cover (`ArchiveCover`) with an "Add a cover" text button
 * under it that opens Suggest an edit with the cover field focused. Title,
 * type and year sit under the cover, in sentence case — no caps eyebrow.
 *
 * v0 led with a 196 dp gradient banner and a gradient poster lifted into it;
 * v2 keeps gradients on the wordmark only, so the art is the cover itself.
 *
 * src: polish/design-direction.md · v2 › Screen notes › Archive · 2026-10-21
 */
export function EntryHero({ entryId, slug, title, mediaType, meta, coverUrl, onAddCover, testID }: Props) {
  const colors = useThemeColors();
  const typeLine = [archiveTypeLabel(mediaType), meta].filter((p) => p.length > 0).join(' · ');

  const s = StyleSheet.create({
    wrap: { paddingHorizontal: 16, gap: 12 },
    top: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
    coverCol: { gap: 4, alignItems: 'flex-start' },
    addCover: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
    addCoverText: { ...TYPE.label, color: colors.pinkInk },
    shareHit: {
      width: MIN_TOUCH_TARGET,
      height: MIN_TOUCH_TARGET,
      alignItems: 'center',
      justifyContent: 'center',
    },
    text: { gap: 4 },
    title: { ...TYPE.headline, color: colors.ink },
    meta: { ...TYPE.body, color: colors.ink2 },
  });

  return (
    <View style={s.wrap} testID={testID}>
      <View style={s.top}>
        <View style={s.coverCol}>
          <ArchiveCover
            entryId={entryId}
            title={title}
            coverUrl={coverUrl}
            width={COVER_WIDTH.hero}
            testID={testID ? `${testID}-poster` : undefined}
          />
          {!coverUrl && onAddCover ? (
            <PressableScale
              onPress={onAddCover}
              style={s.addCover}
              testID={testID ? `${testID}-add-cover` : undefined}
              accessibilityRole="button"
              accessibilityLabel="Add a cover"
              accessibilityHint="Opens Suggest an edit with the cover field ready"
            >
              <Text style={s.addCoverText}>Add a cover</Text>
            </PressableScale>
          ) : null}
        </View>

        <PressableScale
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
            accessibilityRole="button"
            accessibilityLabel={`Share ${title}`}
            aria-label={`Share ${title}`}
          >
            <Ionicons name="share-outline" size={24} color={colors.ink2} />
          </View>
        </PressableScale>
      </View>

      <View style={s.text}>
        {/* Two lines in English at 360 dp (direction › Typography). */}
        <Text style={s.title} numberOfLines={2} accessibilityRole="header">{title}</Text>
        <Text style={s.meta} numberOfLines={2}>{typeLine}</Text>
      </View>
    </View>
  );
}
