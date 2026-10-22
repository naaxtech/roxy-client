import { useCallback, useEffect, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { AccessibilityInfo, Share, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { NO_TRANSITION, IMAGE_CACHE } from '../../lib/imageLoading';
import * as Linking from 'expo-linking';
import { TouchableOpacity } from '../ui/PressableScale';
import { avatarGradient, isPresetAvatar, presetColor, presetEmoji } from '../../lib/avatars';
import { MARGIN, RADII, SPACE, identityFor, inkOnGradient } from '../../lib/theme';
import { TYPE, emphasized } from '../../lib/typography';
import { initialsOf } from '../ui/Avatar';
import { contentDetailPath } from '../../lib/contentNavigation';
import { MIN_INLINE_TOUCH_TARGET, MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { formatReactionCount, type PostReaction } from '../../lib/postReactions';
import type { ReelRow } from '../../lib/reels';
import type { PostType } from '../../types';
import { ShoppableProductCard } from './ShoppableProductCard';
import { a11yState } from '../../lib/a11yState';
import { STAGE } from './stageColors';
import { shortAge } from './feedTime';
import { OutlinedIcon, OutlinedText } from './RailGlyph';
import { ReactionButton } from '../reactions/ReactionButton';
import { ReactionPicker } from '../reactions/ReactionPicker';
import { useReactionPicker } from '../reactions/useReactionPicker';
import {
  AVATAR_SIZE, CAPTION_CAP, CAPTION_COLLAPSED_LINES, CAPTION_EXPANDED_CAP, CAPTION_EXPANDED_LINES,
  CHROME_BOTTOM, CHROME_SHADOW, FAB_LANE, FEED_META, INLINE_CREST,
  MEDIA_SCRIM_BODY_COLORS, MEDIA_SCRIM_FADE, MEDIA_SCRIM_FADE_COLORS, MEDIA_SCRIM_MIN_BODY,
  RAIL_END, RAIL_GAP, RAIL_GLYPH,
} from './feedChromeTokens';

/** What the rail's labels call this thing. A screen reader should not say "video" over a poll. */
const POST_NOUN: Record<PostType, string> = {
  video: 'video',
  photo: 'photo',
  gallery: 'photo',
  poll: 'poll',
  standard: 'post',
  resource: 'post',
  roxy_link: 'post',
  event: 'post',
};

export interface FeedCellChromeProps {
  post: ReelRow;
  /** Her reaction to this post (components/reactions/reactionStore), or none. */
  reaction: PostReaction | null;
  /** Every reaction on the post: tallies + legacy likes + this session's taps. */
  reactionTotal: number;
  saved: boolean;
  /** OS "Reduce Motion": springs jump, the burst and the picker's travel go. */
  reducedMotion: boolean;
  /**
   * Whether this cell is the one being looked at (the arrival announcement).
   * Defaults to false.
   */
  active?: boolean;
  /**
   * The author's real handle. `POST_WITH_AUTHOR` embeds only `display_name` and
   * `avatar_url`, so this is undefined today and the display name is shown
   * bare. An `@handle` derived from a display name would be a claim about who
   * someone is that the data does not support, and on a WLW app misidentifying
   * a poster is not a cosmetic bug.
   */
  handle?: string | null;
  /** False on a text post, whose body already IS the words. Defaults to true. */
  showCaption?: boolean;
  /** Undefined means the viewer's follow state is unknown; see `onFollowAuthor`. */
  following?: boolean;
  /** Set (an emoji), switch, or take back (`null`) her reaction. */
  onReact: (next: PostReaction | null) => void;
  onSave: () => void;
  onOpenComments: () => void;
  onOpenAuthor: () => void;
  onOpenCommunity: () => void;
  /**
   * Opens report / block / hide for this post.
   *
   * REQUIRED, unlike every other optional affordance here. The rail shipped
   * with five positive actions and no negative one — so a woman who was
   * frightened by something in the feed had nowhere to go. Safety is this
   * product's stated promise and, since a TikTok-formula feed makes Roxy
   * "primary purpose UGC", it is also Google Play policy.
   * src: https://support.google.com/googleplay/android-developer/answer/9876937 · read 2026-08-05
   */
  onOpenSafety: () => void;
  /**
   * Opens this post's own detail surface: where a caption too long for the
   * band goes (`CAPTION_EXPANDED_LINES` bounds the expansion).
   */
  onOpenPost: () => void;
  /**
   * Wire this and her name grows a Follow button. Left out, none is drawn.
   * Follow writes `follows` — a feed subscription, not a friend request.
   */
  onFollowAuthor?: () => void;
  /**
   * A video cell's transport controls. They hang above the rail rather than in
   * it: the rail's slots are the social actions every cell shares.
   */
  playbackControl?: ReactNode;
  /** The low-stakes "is this for you?" card, rendered INSIDE the scrim's band. */
  interestPrompt?: ReactNode;
  /** The reaction picker opened or closed (the Roxy AI button tucks while it is open). */
  onPickerOpenChange?: (open: boolean) => void;
}

/**
 * What a body cell is handed. Every kind of cell takes the same bag, so the
 * router hands them all one props object and adding a type later costs nothing.
 */
export interface FeedBodyCellProps
  extends Omit<FeedCellChromeProps, 'playbackControl' | 'showCaption'> {
  /** Measured page size from the pager. Never the window: a page is not a screen. */
  width: number;
  height: number;
}

/**
 * The furniture every cell in the pager carries (direction v2 › Feed, board
 * v2-04): the post is the screen.
 *
 * End rail, from the top of the Roxy AI lane upward: her reaction (or the
 * add-reaction glyph) with the total, comment with its count, save, share and
 * `⋯` (report / block / hide). 32 dp glyphs in 48 dp targets, counts in
 * `meta`, no plates: each glyph and count carries a drawn 1 dp dark outline
 * (`RailGlyph`). The column starts `FAB_LANE` above the page bottom, on the
 * Roxy AI button's centre line, so at rest nothing tappable sits in her lane.
 *
 * Bottom start, in the scrim band: avatar, "Inês R. · 2 h" (+ Follow), "in
 * Lisboa Sapphic Walks" with the community's crest, then the caption (two
 * lines), all with an end margin of `FAB_LANE`.
 *
 * Long-press the reaction button for the six-emoji picker, drawn here over
 * the whole post (`ReactionPicker`).
 *
 * ## The scrim is the identity block's own backing
 *
 * It is NOT a wash over a share of the page: the dark band is laid out
 * bottom-anchored with the identity block as its CONTENT, so every glyph in
 * the block sits at or below `MEDIA_SCRIM_TOP_ALPHA` on every page height.
 * See `feedChromeTokens` for the measurements.
 */
export function FeedCellChrome({
  post, reaction, reactionTotal, saved, reducedMotion, handle, active = false,
  showCaption = true, following, playbackControl, interestPrompt,
  onReact, onSave, onOpenComments, onOpenAuthor, onOpenCommunity, onOpenSafety, onOpenPost,
  onFollowAuthor, onPickerOpenChange,
}: FeedCellChromeProps): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const picker = useReactionPicker({ reaction, onReact, reducedMotion, onOpenChange: onPickerOpenChange });
  const shopId = post.link_type === 'product' ? post.link_entity_id : null;

  const noun = POST_NOUN[post.post_type] ?? 'post';
  const authorName = post.profiles?.display_name ?? '';
  const communityName = post.communities?.name ?? '';
  const caption = showCaption ? post.content.trim() : '';
  const age = shortAge(post.created_at);

  /**
   * What the viewer landed on, said out loud when she lands on it: the pager
   * only advances on a real scroll, and every cell she is not on is out of
   * the accessibility tree (see `FeedCell`).
   * src: https://reactnative-archive-august-2025.netlify.app/docs/0.74/accessibilityinfo#announceforaccessibility · react-native 0.74.5 · 2026-08-07
   */
  const arrival = `${noun} by ${authorName || 'a member'}${
    communityName ? ` in ${communityName}` : ''}`;
  useEffect(() => {
    if (!active) return;
    AccessibilityInfo.announceForAccessibility(arrival);
  }, [active, arrival]);

  /**
   * Three states, not two, because a bounded expansion needs somewhere to put
   * the overflow: `fits` (two lines), `expands` (six lines, "more"/"less"),
   * `overflows` ("Read more" opens the post; the caption never expands).
   */
  const captionFit = caption.length <= CAPTION_CAP
    ? 'fits'
    : (caption.length <= CAPTION_EXPANDED_CAP ? 'expands' : 'overflows');
  const captionLines = expanded && captionFit === 'expands'
    ? CAPTION_EXPANDED_LINES
    : CAPTION_COLLAPSED_LINES;

  const handleShare = useCallback(() => {
    // The link lands on this post (the path follows its type). Android's share
    // sheet reads `message` only, iOS prefers `url`, so it goes in both.
    //
    // The author's and the community's names are DELIBERATELY absent: this
    // sheet hands the payload to an arbitrary app, and naming a member or a
    // community there can out someone who never agreed to it.
    // src: https://github.com/expo/expo/blob/sdk-51/packages/expo-linking/src/createURL.ts · expo-linking 6.3.1 · 2026-08-05
    const url = Linking.createURL(contentDetailPath(post.id, post.post_type));
    void Share.share({
      message: `Something on Roxy — ${url}`,
      url,
    }).catch(() => { /* viewer dismissed the sheet */ });
  }, [post.id, post.post_type]);

  const avatarUrl = post.profiles?.avatar_url ?? null;
  const grad = avatarGradient(authorName || post.author_id);

  let avatarFace: ReactNode;
  if (avatarUrl && isPresetAvatar(avatarUrl)) {
    avatarFace = (
      <View style={[s.avatarFace, { backgroundColor: presetColor(avatarUrl) }]}>
        <Text style={s.avatarEmoji}>{presetEmoji(avatarUrl)}</Text>
      </View>
    );
  } else if (avatarUrl) {
    avatarFace = (
      <Image
        transition={NO_TRANSITION}
        cachePolicy={IMAGE_CACHE}
        source={{ uri: avatarUrl }}
        contentFit="cover"
        // Without this a recycled cell wears the previous author's face until
        // the new one decodes.
        recyclingKey={post.id}
        style={s.avatarFace}
      />
    );
  } else {
    avatarFace = (
      // Same initials and ink as components/ui/Avatar, so she has one face
      // across the feed, comments and her profile.
      <LinearGradient colors={grad} style={s.avatarFace}>
        <Text style={[s.avatarLetter, { color: inkOnGradient(grad) }]}>{initialsOf(authorName)}</Text>
      </LinearGradient>
    );
  }

  const handleLabel = handle ? `@${handle}` : authorName;
  const who = authorName || 'this author';

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Drawn first: the backdrop for the identity block. */}
      <View testID="feed-cell-scrim" style={s.bottomBlock} pointerEvents="box-none">
        <LinearGradient
          testID="feed-cell-scrim-fade"
          colors={MEDIA_SCRIM_FADE_COLORS}
          style={s.scrimFade}
          pointerEvents="none"
        />
        <LinearGradient
          testID="feed-cell-scrim-body"
          colors={MEDIA_SCRIM_BODY_COLORS}
          style={s.scrimBody}
          pointerEvents="box-none"
        >
          {interestPrompt}

          <View testID="feed-cell-identity" style={s.identity} pointerEvents="box-none">
            {shopId ? <ShoppableProductCard productId={shopId} /> : null}

            <View style={s.authorRow} pointerEvents="box-none">
              <TouchableOpacity
                testID="feed-cell-avatar"
                style={s.avatarHit}
                onPress={onOpenAuthor}
                accessibilityRole="button"
                accessibilityLabel={authorName ? `Open ${authorName}'s profile` : "Open the author's profile"}
              >
                <View style={s.avatar}>{avatarFace}</View>
              </TouchableOpacity>

              {handleLabel ? (
                <TouchableOpacity
                  testID="feed-cell-handle-hit"
                  style={s.nameHit}
                  onPress={onOpenAuthor}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${authorName || 'the author'}'s profile`}
                >
                  <Text style={s.nameLine} numberOfLines={1}>
                    <Text testID="feed-cell-handle" style={[s.handle, CHROME_SHADOW]}>
                      {handleLabel}
                    </Text>
                    {age ? ' ' : null}
                    {age ? (
                      <Text testID="feed-cell-age" style={[s.age, CHROME_SHADOW]}>{`· ${age}`}</Text>
                    ) : null}
                  </Text>
                </TouchableOpacity>
              ) : null}

              {onFollowAuthor ? (
                <TouchableOpacity
                  testID="feed-cell-follow"
                  style={s.followHit}
                  onPress={onFollowAuthor}
                  accessibilityRole="button"
                  accessibilityLabel={following ? `Unfollow ${who}` : `Follow ${who}`}
                  {...a11yState({ selected: following === true })}
                >
                  <View style={[s.followPill, following && s.followPillOn]}>
                    <Text style={[s.followText, following && s.followTextOn]}>
                      {following ? 'Following' : 'Follow'}
                    </Text>
                  </View>
                </TouchableOpacity>
              ) : null}
            </View>

            {communityName ? (
              <TouchableOpacity
                testID="feed-cell-community-hit"
                style={s.communityRow}
                onPress={onOpenCommunity}
                accessibilityRole="button"
                accessibilityLabel={`Open ${communityName}`}
              >
                <View
                  testID="feed-cell-crest"
                  style={[s.crest, { backgroundColor: identityFor(post.community_id ?? communityName) }]}
                />
                <Text testID="feed-cell-community" style={[s.community, CHROME_SHADOW]} numberOfLines={1}>
                  {`in ${communityName}`}
                </Text>
              </TouchableOpacity>
            ) : null}

            {caption ? (
              <>
                <Text
                  testID="feed-cell-caption"
                  style={[s.caption, CHROME_SHADOW]}
                  numberOfLines={captionLines}
                >
                  {caption}
                </Text>

                {captionFit === 'expands' && !expanded ? (
                  <TouchableOpacity
                    testID="feed-cell-more"
                    style={s.inlineHit}
                    onPress={() => setExpanded(true)}
                    accessibilityRole="button"
                    accessibilityLabel="Show the full caption"
                  >
                    <Text style={[s.more, CHROME_SHADOW]}>more</Text>
                  </TouchableOpacity>
                ) : null}

                {captionFit === 'expands' && expanded ? (
                  <TouchableOpacity
                    testID="feed-cell-less"
                    style={s.inlineHit}
                    onPress={() => setExpanded(false)}
                    accessibilityRole="button"
                    accessibilityLabel="Show less of the caption"
                  >
                    <Text style={[s.more, CHROME_SHADOW]}>less</Text>
                  </TouchableOpacity>
                ) : null}

                {captionFit === 'overflows' ? (
                  <TouchableOpacity
                    testID="feed-cell-read-more"
                    style={s.inlineHit}
                    onPress={onOpenPost}
                    accessibilityRole="button"
                    accessibilityLabel="Read the full post"
                  >
                    <Text style={[s.more, CHROME_SHADOW]}>Read more</Text>
                  </TouchableOpacity>
                ) : null}
              </>
            ) : null}
          </View>
        </LinearGradient>
      </View>

      {/* One column, so the video transport sits directly above the rail on
          every page size. */}
      <View
        testID="feed-rail-column"
        style={s.railColumn}
        pointerEvents="box-none"
        onLayout={picker.layoutOf('column')}
      >
        {playbackControl}

        <View testID="feed-rail" style={s.rail} onLayout={picker.layoutOf('rail')}>
          <ReactionButton
            picker={picker}
            reaction={reaction}
            total={reactionTotal}
            noun={noun}
            reducedMotion={reducedMotion}
          />

          <TouchableOpacity
            testID="rail-comment"
            style={s.railBtn}
            onPress={onOpenComments}
            accessibilityRole="button"
            accessibilityLabel={`Comment, ${post.comment_count} comments`}
          >
            <OutlinedIcon name="chatbubble-outline" size={RAIL_GLYPH} />
            <OutlinedText testID="rail-comment-count" style={s.railCount}>
              {formatReactionCount(post.comment_count)}
            </OutlinedText>
          </TouchableOpacity>

          <TouchableOpacity
            testID="rail-save"
            style={s.railBtn}
            onPress={onSave}
            accessibilityRole="button"
            accessibilityLabel={saved ? `Remove ${noun} from saved` : `Save ${noun}`}
            {...a11yState({ selected: saved })}
          >
            <OutlinedIcon name={saved ? 'bookmark' : 'bookmark-outline'} size={RAIL_GLYPH} />
            <OutlinedText testID="rail-save-label" style={s.railCount}>
              {saved ? 'Saved' : 'Save'}
            </OutlinedText>
          </TouchableOpacity>

          <TouchableOpacity
            testID="rail-share"
            style={s.railBtn}
            onPress={handleShare}
            accessibilityRole="button"
            accessibilityLabel={`Share ${noun}`}
          >
            <OutlinedIcon name="share-outline" size={RAIL_GLYPH} />
            <OutlinedText testID="rail-share-label" style={s.railCount}>Share</OutlinedText>
          </TouchableOpacity>

          {/* Last, where an overflow belongs — and named for what is behind it,
              so a screen reader user learns there is a way out without opening it. */}
          <TouchableOpacity
            testID="rail-more"
            style={s.railBtn}
            onPress={onOpenSafety}
            accessibilityRole="button"
            accessibilityLabel={`Report, block or hide this ${noun}`}
            accessibilityHint="Opens safety options for this post"
          >
            <OutlinedIcon name="ellipsis-horizontal" size={RAIL_GLYPH} />
          </TouchableOpacity>
        </View>
      </View>

      <ReactionPicker picker={picker} reaction={reaction} reducedMotion={reducedMotion} />
    </View>
  );
}

// Static: the chrome is white-on-anything on every surface it serves, so it
// never reads the theme, and rebuilding it per cell would allocate on every
// swipe of a recycled list.
const s = StyleSheet.create({
  /**
   * The scrim, bottom-anchored with an auto height: the band's height is
   * whatever its content needs plus `CHROME_BOTTOM` (see `feedChromeTokens`).
   */
  bottomBlock: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  scrimFade: { height: MEDIA_SCRIM_FADE },
  scrimBody: { minHeight: MEDIA_SCRIM_MIN_BODY, justifyContent: 'flex-end' },

  railColumn: {
    position: 'absolute', right: RAIL_END, bottom: FAB_LANE, gap: RAIL_GAP, alignItems: 'center',
  },
  rail: { gap: RAIL_GAP, alignItems: 'center' },
  railBtn: {
    alignItems: 'center', justifyContent: 'center', gap: 2,
    minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET,
  },
  railCount: { ...TYPE.meta, color: STAGE.ink, textAlign: 'center' },

  identity: {
    paddingLeft: MARGIN, paddingRight: FAB_LANE, paddingBottom: CHROME_BOTTOM, gap: 2,
  },
  authorRow: { flexDirection: 'row', alignItems: 'center', minHeight: MIN_TOUCH_TARGET },
  /** 48 dp target around a 32 dp face, aligned to the margin. */
  avatarHit: {
    width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET,
    marginLeft: -(MIN_TOUCH_TARGET - AVATAR_SIZE) / 2,
    alignItems: 'center', justifyContent: 'center',
  },
  avatar: {
    width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2, overflow: 'hidden',
  },
  avatarFace: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { ...emphasized('meta') },
  avatarEmoji: { fontSize: 16 },
  nameHit: { flexShrink: 1, minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', paddingRight: SPACE[1] },
  nameLine: { ...TYPE.label },
  handle: { ...TYPE.label, color: STAGE.ink },
  age: { ...TYPE.label, color: FEED_META },
  followHit: { minHeight: MIN_TOUCH_TARGET, minWidth: MIN_TOUCH_TARGET, justifyContent: 'center', alignItems: 'center' },
  /** Outlined, not filled: the one pink on the Feed is her reaction. */
  followPill: {
    borderRadius: RADII.pill, borderWidth: 1, borderColor: STAGE.ink,
    paddingHorizontal: SPACE[2], minHeight: SPACE[6] - 4, justifyContent: 'center',
  },
  followPillOn: { borderColor: FEED_META },
  followText: { ...emphasized('meta'), color: STAGE.ink },
  followTextOn: { color: FEED_META },
  communityRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[1] + 2,
    minHeight: MIN_INLINE_TOUCH_TARGET, alignSelf: 'flex-start',
  },
  /** Crests are squircles at 28% of their size (direction › Shape). */
  crest: { width: INLINE_CREST, height: INLINE_CREST, borderRadius: Math.round(INLINE_CREST * 0.28) },
  community: { ...TYPE.meta, color: FEED_META, flexShrink: 1 },
  caption: { ...TYPE.body, color: STAGE.ink },
  /**
   * The "more" affordance: padded to clear WCAG 2.2 SC 2.5.8's 24 dp under
   * its Inline exception (see `lib/touchTargets.ts`).
   */
  inlineHit: { justifyContent: 'center', minHeight: MIN_INLINE_TOUCH_TARGET, alignSelf: 'flex-start' },
  more: { ...emphasized('meta'), color: FEED_META },
});
