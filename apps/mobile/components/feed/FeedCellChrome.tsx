import { useCallback, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { avatarGradient, isPresetAvatar, presetColor, presetEmoji } from '../../lib/avatars';
import { contentDetailPath } from '../../lib/contentNavigation';
import { MIN_INLINE_TOUCH_TARGET, MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import type { ReelRow } from '../../lib/reels';
import type { PostType } from '../../types';
import { CommunityCrest } from './CommunityCrest';
import {
  CHROME_BOTTOM, CHROME_SHADOW, CREST_SIZE,
  MEDIA_SCRIM_BODY_COLORS, MEDIA_SCRIM_FADE, MEDIA_SCRIM_FADE_COLORS, MEDIA_SCRIM_MIN_BODY,
  RAIL_BACKING, RAIL_GUTTER,
} from './feedChromeTokens';

/**
 * Roughly two lines at the width the identity block gets once the rail has
 * taken its gutter. `numberOfLines` truncates but tells nobody it did, so the
 * "more" affordance is offered on length rather than on measurement — the same
 * trade `StaticPostCard` already makes.
 */
const CAPTION_CAP = 80;

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
  liked: boolean;
  saved: boolean;
  /** Store-adjusted, so a tap on the rail moves the number. */
  likeCount: number;
  /** OS "Reduce Motion" — stops the crest turning. */
  reducedMotion: boolean;
  /**
   * Whether this cell is the one being looked at. Only the active cell's crest
   * rotates; see `CommunityCrest`. Defaults to false, so a cell that never
   * learns it is active never animates.
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
  onLike: () => void;
  onSave: () => void;
  onOpenComments: () => void;
  onOpenAuthor: () => void;
  onOpenCommunity: () => void;
  /**
   * Opens report / block / hide for this post.
   *
   * REQUIRED, unlike every other optional affordance here. The rail shipped
   * with five positive actions and no negative one, and neither detail route
   * carried a report or a block either — so a woman who was frightened by
   * something in the feed had nowhere to go. Safety is this product's stated
   * promise and, since a TikTok-formula feed makes Roxy "primary purpose UGC",
   * it is also Google Play policy. An optional prop is an invitation to build
   * the next surface without it.
   * src: https://support.google.com/googleplay/android-developer/answer/9876937 · read 2026-08-05
   */
  onOpenSafety: () => void;
  /**
   * Wire this and the avatar grows its follow badge. Left out, the badge is not
   * rendered at all: there is no follow graph in this schema yet — only
   * `friendships`, which is a mutual, notifying relationship and not the same
   * promise — and an affordance that silently does nothing is worse than one
   * that is honestly absent.
   */
  onFollowAuthor?: () => void;
  /**
   * A video cell's transport control. It hangs above the rail rather than in it,
   * because the rail's slots are the social actions every cell shares and a
   * control that exists on one cell type would break the muscle memory of the
   * others.
   */
  playbackControl?: ReactNode;
  /**
   * The low-stakes "is this for you?" card, when the feed decides to offer it.
   *
   * It renders INSIDE the scrim's band, above the identity block, which is why
   * the band is sized by its content rather than given a fixed height: adding
   * the card grows its own backing with it and the contrast guarantee holds
   * unchanged. See `FeedInterestCard` for why this is a separate control from
   * the `⋯` sheet.
   */
  interestPrompt?: ReactNode;
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
  /** Opens this post's own detail surface. */
  onOpenPost: () => void;
}

/**
 * The furniture every cell in the pager carries, whatever its body is.
 *
 * Written once and composed rather than copied per cell type: the rail's order,
 * the crest's slot, the caption's cap and the scrim are the things that make a
 * mixed feed read as one system, and five copies of them would drift apart
 * within a slice. A cell supplies its body; this supplies everything a viewer
 * recognises.
 *
 * Right rail, top to bottom: author avatar carrying a follow affordance, like,
 * comment, save, share, and the `⋯` that opens report / block / hide.
 * src: https://www.tamidy.com/blog/the-ui-ux-of-tiktok-first-impressions · read 2026-08-06
 *
 * ## The scrim is the identity block's own backing
 *
 * It is NOT a wash over a share of the page. The dark band below is laid out
 * bottom-anchored with the identity block as its CONTENT, so its height is the
 * block's height plus `CHROME_BOTTOM`, in dp, on every device — and every glyph
 * in the block therefore sits at or below `MEDIA_SCRIM_TOP_ALPHA` whether the
 * page is 320dp in Connect or 620dp full-screen, and whether the caption is one
 * line or expanded. The previous fraction-anchored gradient put the handle at
 * 1.86:1 on a short page. See `feedChromeTokens` for the measurements.
 */
export function FeedCellChrome({
  post, liked, saved, likeCount, reducedMotion, handle, active = false,
  showCaption = true, following, playbackControl, interestPrompt,
  onLike, onSave, onOpenComments, onOpenAuthor, onOpenCommunity, onOpenSafety, onFollowAuthor,
}: FeedCellChromeProps): ReactElement {
  const [expanded, setExpanded] = useState(false);

  const noun = POST_NOUN[post.post_type] ?? 'post';
  const authorName = post.profiles?.display_name ?? '';
  const communityName = post.communities?.name ?? '';
  const caption = showCaption ? post.content.trim() : '';

  const handleShare = useCallback(() => {
    // Every other Share.share in this app sends a bare sentence with nothing to
    // open. createURL resolves to the app's own scheme, so the link lands on
    // this post — and the path follows the post's type, because video and
    // everything else have different detail routes.
    // src: https://github.com/expo/expo/blob/sdk-51/packages/expo-linking/src/createURL.ts · expo-linking 6.3.1 · 2026-08-05
    const url = Linking.createURL(contentDetailPath(post.id, post.post_type));
    // Android's share sheet reads `message` only, iOS prefers `url` — so the
    // link goes in both or half the platforms share nothing.
    //
    // The author's display name is DELIBERATELY absent. This sheet hands the
    // payload to an arbitrary app — WhatsApp, SMS, a screenshot — and naming a
    // member there is a WLW-dating-app disclosure about a third party who never
    // agreed to it. She shared a post; she did not out a poster. The `roxy://`
    // link resolves for nobody without the app, so the name bought the sharer
    // nothing and cost someone else their privacy.
    //
    // The real fix is the in-product reshare in plan §11 — share INTO a room,
    // where the walls still apply. Until that exists, share the thing, not the
    // person.
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
      <LinearGradient colors={grad} style={s.avatarFace}>
        <Text style={s.avatarLetter}>{(authorName[0] ?? '?').toUpperCase()}</Text>
      </LinearGradient>
    );
  }

  const handleLabel = handle ? `@${handle}` : authorName;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/*
        Drawn first, because it is the backdrop: the rail's lowest control sits
        inside this band's y-range, and a band painted after the rail would
        cover it.
      */}
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
            {handleLabel ? (
              <TouchableOpacity
                testID="feed-cell-handle-hit"
                style={s.inlineHit}
                onPress={onOpenAuthor}
                accessibilityRole="button"
                accessibilityLabel={`Open ${authorName || 'the author'}'s profile`}
              >
                <Text testID="feed-cell-handle" style={[s.handle, CHROME_SHADOW]}>
                  {handleLabel}
                </Text>
              </TouchableOpacity>
            ) : null}

            {caption ? (
              <>
                <Text
                  testID="feed-cell-caption"
                  style={[s.caption, CHROME_SHADOW]}
                  numberOfLines={expanded ? undefined : 2}
                >
                  {caption}
                </Text>
                {!expanded && caption.length > CAPTION_CAP ? (
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
              </>
            ) : null}

            {communityName ? (
              <TouchableOpacity
                testID="feed-cell-community-hit"
                style={s.communityRow}
                onPress={onOpenCommunity}
                accessibilityRole="button"
                accessibilityLabel={`Open ${communityName}`}
              >
                <Ionicons name="people" size={13} color="#fff" style={CHROME_SHADOW} />
                <Text testID="feed-cell-community" style={[s.community, CHROME_SHADOW]}>
                  {communityName}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </LinearGradient>
      </View>

      {/* One column, so the video transport sits directly above the rail on
          every page size rather than at a hardcoded offset that collides with
          the rail on a short viewport. */}
      <View style={s.railColumn} pointerEvents="box-none">
        {playbackControl}

        <View testID="feed-rail" style={s.rail}>
          {/* Not `rail-*`: this is the box that CONTAINS the avatar and its
              follow badge, not a slot in the rail. The badge hangs below the
              avatar plate, and RN only descends into a child after the parent
              has been hit — so without a parent tall enough to hold it, the
              badge's lower half fell through to the avatar and followed nobody
              while opening her profile instead. `rail-` is reserved for the
              actual slots, because FeedCellChrome.test enumerates the rail by
              that prefix and a container in that list would read as an action. */}
          <View
            testID="author-slot"
            style={[s.author, onFollowAuthor ? s.authorFollowable : null]}
          >
            <TouchableOpacity
              testID="rail-avatar"
              style={s.avatarPlate}
              onPress={onOpenAuthor}
              accessibilityRole="button"
              accessibilityLabel={
                authorName ? `Open ${authorName}'s profile` : "Open the author's profile"
              }
            >
              {/* The white ring is adjacent to the plate, not to the frame:
                  ring-on-white-photo measured 1.00:1. */}
              <View style={s.avatarRing}>{avatarFace}</View>
            </TouchableOpacity>
            {onFollowAuthor ? (
              /*
                The touch box is 48dp and the pink plate inside it is still 20dp.
                Both facts matter, and the old badge had neither: it was a bare
                20dp view at `bottom: -9` inside a parent with no height of its
                own, so nine of its twenty dp sat OUTSIDE `author`'s bounds — and
                React Native only descends into a child after the parent is hit.
                A thumb on the lower half of the `+` therefore fell through to the
                avatar and opened the author's profile instead of following her,
                which is a silently wrong action rather than a dead tap. The
                `hitSlop` that was supposed to cover it could not: hitSlop does
                not cross a parent boundary either.

                The box is anchored to the bottom of a parent that is now tall
                enough to contain it, and it overlaps the 52dp avatar plate by
                exactly 4dp — leaving the avatar its own 48. See `s.author`.
              */
              <TouchableOpacity
                testID="rail-follow"
                style={s.followHit}
                onPress={onFollowAuthor}
                accessibilityRole="button"
                accessibilityLabel={
                  following
                    ? `Unfollow ${authorName || 'this author'}`
                    : `Follow ${authorName || 'this author'}`
                }
                accessibilityState={{ selected: following === true }}
              >
                <View style={s.followBadge}>
                  <Ionicons
                    name={following ? 'checkmark' : 'add'}
                    size={14}
                    color="#fff"
                  />
                </View>
              </TouchableOpacity>
            ) : null}
          </View>

          <TouchableOpacity
            testID="rail-like"
            style={s.railBtn}
            onPress={onLike}
            accessibilityRole="button"
            accessibilityLabel={
              liked ? `Unlike ${noun}, ${likeCount} likes` : `Like ${noun}, ${likeCount} likes`
            }
            accessibilityState={{ selected: liked }}
          >
            <Ionicons
              name={liked ? 'heart' : 'heart-outline'}
              size={30}
              color={liked ? '#E81C8E' : '#fff'}
              style={CHROME_SHADOW}
            />
            <Text style={[s.railCount, CHROME_SHADOW]}>{likeCount}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            testID="rail-comment"
            style={s.railBtn}
            onPress={onOpenComments}
            accessibilityRole="button"
            accessibilityLabel={`View comments, ${post.comment_count} comments`}
          >
            <Ionicons name="chatbubble-outline" size={27} color="#fff" style={CHROME_SHADOW} />
            <Text style={[s.railCount, CHROME_SHADOW]}>{post.comment_count}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            testID="rail-save"
            style={s.railBtn}
            onPress={onSave}
            accessibilityRole="button"
            accessibilityLabel={saved ? `Remove ${noun} from saved` : `Save ${noun}`}
            accessibilityState={{ selected: saved }}
          >
            <Ionicons
              name={saved ? 'bookmark' : 'bookmark-outline'}
              size={26}
              color={saved ? '#FFB020' : '#fff'}
              style={CHROME_SHADOW}
            />
          </TouchableOpacity>

          <TouchableOpacity
            testID="rail-share"
            style={s.railBtn}
            onPress={handleShare}
            accessibilityRole="button"
            accessibilityLabel={`Share ${noun}`}
          >
            <Ionicons name="arrow-redo-outline" size={27} color="#fff" style={CHROME_SHADOW} />
          </TouchableOpacity>

          {/* Last, where an overflow belongs — and named for what is behind it
              rather than "More options", so a screen reader user learns there
              is a way out without opening it first. */}
          <TouchableOpacity
            testID="rail-more"
            style={s.railBtn}
            onPress={onOpenSafety}
            accessibilityRole="button"
            accessibilityLabel={`Report, block or hide this ${noun}`}
            accessibilityHint="Opens safety options for this post"
          >
            <Ionicons name="ellipsis-horizontal" size={24} color="#fff" style={CHROME_SHADOW} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={s.crest}>
        <CommunityCrest
          name={communityName || 'Roxy'}
          imageUrl={null}
          recyclingKey={post.id}
          active={active}
          reducedMotion={reducedMotion}
          onPress={onOpenCommunity}
        />
      </View>
    </View>
  );
}

// Static: the chrome is white-on-anything on every surface it serves, so it
// never reads the theme, and rebuilding it per cell would allocate on every
// swipe of a recycled list.
const s = StyleSheet.create({
  /**
   * The scrim, bottom-anchored with an auto height.
   *
   * No `top`, no `height`, no percentage: the band's height is whatever its
   * content needs, which is the identity block (plus the interest card when one
   * is offered) plus `CHROME_BOTTOM`. That is the entire fix for the
   * page-height-dependent contrast — see `feedChromeTokens`.
   */
  bottomBlock: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  scrimFade: { height: MEDIA_SCRIM_FADE },
  scrimBody: { minHeight: MEDIA_SCRIM_MIN_BODY, justifyContent: 'flex-end' },

  railColumn: {
    position: 'absolute', right: 12, bottom: 96, gap: 14, alignItems: 'center',
  },
  rail: { gap: 14, alignItems: 'center' },
  author: { alignItems: 'center', marginBottom: 6 },
  /**
   * Room for the follow badge's 48dp box, and only when there is one to hold.
   *
   * 44 = the box's 48 minus the 4dp it is allowed to overlap the avatar plate.
   * The plate renders at 52 (46 ring + 3 padding each side), so ceding 4 leaves
   * it exactly `MIN_TOUCH_TARGET`. Applied conditionally because `onFollowAuthor`
   * is unwired today — there is no follow graph — and 44dp of empty rail for a
   * badge that is not drawn would push the rest of the column off a short page.
   */
  authorFollowable: { paddingBottom: MIN_TOUCH_TARGET - 4 },
  avatarPlate: {
    minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET,
    padding: 3, borderRadius: 26, backgroundColor: RAIL_BACKING,
  },
  avatarRing: {
    width: 46, height: 46, borderRadius: 23,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.9)',
    overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.35)',
  },
  avatarFace: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { color: '#fff', fontWeight: '800', fontSize: 17 },
  avatarEmoji: { fontSize: 20 },
  /**
   * The tappable box. Anchored to the bottom of `author`, which
   * `authorFollowable` has made tall enough to hold all 48dp of it — nothing
   * hangs outside the parent, so nothing falls through to the avatar.
   */
  followHit: {
    position: 'absolute', bottom: 0,
    width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET,
    alignItems: 'center', justifyContent: 'flex-start',
  },
  /** The visible plate, unchanged at 20dp and tucked against the plate's edge. */
  followBadge: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: '#FF2F71',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: 'rgba(26,10,46,0.9)',
  },
  /**
   * Each control carries its own plate.
   *
   * The rail's top reaches ~358dp above the page bottom; a scrim tall enough to
   * cover that would veil the whole frame, so the rail is backed per control
   * instead. The alpha is set by the liked heart — see `RAIL_BACKING`.
   */
  railBtn: {
    alignItems: 'center', justifyContent: 'center', gap: 2,
    minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET,
    paddingVertical: 6, paddingHorizontal: 6, borderRadius: 20,
    backgroundColor: RAIL_BACKING,
  },
  railCount: { color: '#fff', fontSize: 11, fontWeight: '700' },
  crest: { position: 'absolute', right: 14, bottom: CHROME_BOTTOM, width: CREST_SIZE },
  /**
   * `gap` drops from 5 to 2 because the rhythm now lives inside the targets: the
   * three text links each carry `inlineHit`'s padding, which both separates them
   * and makes them tappable. Net cost to the band's height is ~23dp rather than
   * the ~32 the padding alone would have added.
   */
  identity: {
    paddingLeft: 18, paddingRight: RAIL_GUTTER, paddingBottom: CHROME_BOTTOM, gap: 2,
  },
  /**
   * The handle, the "more" affordance and the community line.
   *
   * Padded to clear WCAG 2.2 SC 2.5.8's 24dp under its Inline exception rather
   * than sized to ATF's 48 — see `lib/touchTargets.ts` for why three 48dp boxes
   * here would veil two thirds of Connect's page. What they do NOT do any more
   * is lean on `hitSlop`, which bought them nothing measurable.
   */
  inlineHit: { justifyContent: 'center', minHeight: MIN_INLINE_TOUCH_TARGET },
  handle: { color: '#fff', fontWeight: '800', fontSize: 15, letterSpacing: -0.2 },
  caption: { color: 'rgba(255,255,255,0.95)', fontSize: 14.5, lineHeight: 20 },
  more: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '700' },
  communityRow: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    minHeight: MIN_INLINE_TOUCH_TARGET,
  },
  community: { color: 'rgba(255,255,255,0.9)', fontWeight: '700', fontSize: 12.5 },
});
