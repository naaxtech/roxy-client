import { useCallback, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { avatarGradient, isPresetAvatar, presetColor, presetEmoji } from '../../lib/avatars';
import { contentDetailPath } from '../../lib/contentNavigation';
import type { ReelRow } from '../../lib/reels';
import type { PostType } from '../../types';
import { CommunityCrest } from './CommunityCrest';
import {
  CHROME_BOTTOM, CHROME_SHADOW, MEDIA_SCRIM, MEDIA_SCRIM_LOCATIONS, RAIL_GUTTER,
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
   * Wire this and the avatar grows its follow badge. Left out, the badge is not
   * rendered at all: there is no follow graph in this schema yet — only
   * `friendships`, which is a mutual, notifying relationship and not the same
   * promise — and an affordance that silently does nothing is worse than one
   * that is honestly absent.
   */
  onFollowAuthor?: () => void;
  /**
   * A video cell's transport control. It hangs above the rail rather than in it,
   * because the rail's five slots are the social actions every cell shares and a
   * control that exists on one cell type would break the muscle memory of the
   * other four.
   */
  playbackControl?: ReactNode;
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
 * comment, save, share.
 * src: https://www.tamidy.com/blog/the-ui-ux-of-tiktok-first-impressions · read 2026-08-06
 */
export function FeedCellChrome({
  post, liked, saved, likeCount, reducedMotion, handle, active = false,
  showCaption = true, following, playbackControl,
  onLike, onSave, onOpenComments, onOpenAuthor, onOpenCommunity, onFollowAuthor,
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
    void Share.share({
      message: authorName
        ? `${authorName} posted this on Roxy — ${url}`
        : `Check this out on Roxy — ${url}`,
      url,
    }).catch(() => { /* viewer dismissed the sheet */ });
  }, [post.id, post.post_type, authorName]);

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
      <LinearGradient
        testID="feed-cell-scrim"
        colors={MEDIA_SCRIM}
        locations={MEDIA_SCRIM_LOCATIONS}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {/* One column, so the video transport sits directly above the rail on
          every page size rather than at a hardcoded offset that collides with
          the rail on a short viewport. */}
      <View style={s.railColumn} pointerEvents="box-none">
        {playbackControl}

        <View testID="feed-rail" style={s.rail}>
          <View style={s.author}>
            <TouchableOpacity
              testID="rail-avatar"
              style={s.avatar}
              onPress={onOpenAuthor}
              accessibilityRole="button"
              accessibilityLabel={
                authorName ? `Open ${authorName}'s profile` : "Open the author's profile"
              }
              hitSlop={6}
            >
              {avatarFace}
            </TouchableOpacity>
            {onFollowAuthor ? (
              <TouchableOpacity
                testID="rail-follow"
                style={s.followBadge}
                onPress={onFollowAuthor}
                accessibilityRole="button"
                accessibilityLabel={
                  following
                    ? `Unfollow ${authorName || 'this author'}`
                    : `Follow ${authorName || 'this author'}`
                }
                accessibilityState={{ selected: following === true }}
                hitSlop={8}
              >
                <Ionicons
                  name={following ? 'checkmark' : 'add'}
                  size={14}
                  color="#fff"
                />
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
            hitSlop={6}
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
            hitSlop={6}
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
            hitSlop={6}
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
            hitSlop={6}
          >
            <Ionicons name="arrow-redo-outline" size={27} color="#fff" style={CHROME_SHADOW} />
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

      <View testID="feed-cell-identity" style={s.identity} pointerEvents="box-none">
        {handleLabel ? (
          <TouchableOpacity
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
                onPress={() => setExpanded(true)}
                accessibilityRole="button"
                accessibilityLabel="Show the full caption"
                hitSlop={6}
              >
                <Text style={[s.more, CHROME_SHADOW]}>more</Text>
              </TouchableOpacity>
            ) : null}
          </>
        ) : null}

        {communityName ? (
          <TouchableOpacity
            style={s.communityRow}
            onPress={onOpenCommunity}
            accessibilityRole="button"
            accessibilityLabel={`Open ${communityName}`}
            hitSlop={6}
          >
            <Ionicons name="people" size={13} color="#fff" style={CHROME_SHADOW} />
            <Text testID="feed-cell-community" style={[s.community, CHROME_SHADOW]}>
              {communityName}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

// Static: the chrome is white-on-anything on every surface it serves, so it
// never reads the theme, and rebuilding it per cell would allocate on every
// swipe of a recycled list.
const s = StyleSheet.create({
  railColumn: {
    position: 'absolute', right: 12, bottom: 96, gap: 18, alignItems: 'center',
  },
  rail: { gap: 18, alignItems: 'center' },
  author: { alignItems: 'center', marginBottom: 6 },
  avatar: {
    width: 46, height: 46, borderRadius: 23,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.9)',
    overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.35)',
  },
  avatarFace: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { color: '#fff', fontWeight: '800', fontSize: 17 },
  avatarEmoji: { fontSize: 20 },
  followBadge: {
    position: 'absolute', bottom: -9,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: '#FF2F71',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: 'rgba(26,10,46,0.9)',
  },
  railBtn: { alignItems: 'center', gap: 3, minWidth: 44 },
  railCount: { color: '#fff', fontSize: 11, fontWeight: '700' },
  crest: { position: 'absolute', right: 14, bottom: CHROME_BOTTOM },
  identity: {
    position: 'absolute', left: 0, bottom: CHROME_BOTTOM, right: RAIL_GUTTER,
    paddingLeft: 18, gap: 5,
  },
  handle: { color: '#fff', fontWeight: '800', fontSize: 15, letterSpacing: -0.2 },
  caption: { color: 'rgba(255,255,255,0.95)', fontSize: 14.5, lineHeight: 20 },
  more: { color: 'rgba(255,255,255,0.72)', fontSize: 13, fontWeight: '700' },
  communityRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  community: { color: 'rgba(255,255,255,0.9)', fontWeight: '700', fontSize: 12.5 },
});
