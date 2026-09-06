import { useCallback } from 'react';
import type { ReactElement } from 'react';
import { View } from 'react-native';
import type { ReelRow } from '../../lib/reels';
import type { PostType } from '../../types';
import type { FeedCellChromeProps } from './FeedCellChrome';
import { ReelCell } from './ReelCell';
import { PhotoCell } from './PhotoCell';
import { TextCell } from './TextCell';
import { PollCell } from './PollCell';
import { ResourceCell } from './ResourceCell';
import { parsePoll, submitPollVote } from './poll';

export interface FeedCellProps
  extends Omit<FeedCellChromeProps, 'playbackControl' | 'showCaption' | 'active'> {
  /** Positional, for the video decoder window only. */
  index: number;
  activeIndex: number;
  /** Identity, for everything that decides behaviour. */
  activeItemId: string | null;
  width: number;
  height: number;
  muted: boolean;
  onToggleMute: () => void;
  /** Records a poll vote. Defaults to the shared tally write. */
  onVote?: (postId: string, optionKey: string) => Promise<boolean>;
}

/**
 * The FlashList recycling pool this post belongs in.
 *
 * "FlashList will now use separate recycling pools based on `item.type`. That
 * means we will never recycle items of different types, making the re-render
 * faster." A constant here is the defect slice 0 fixed: with one pool FlashList
 * recycles a poll cell's view tree into a video cell and rebuilds the whole
 * subtree on every swipe. It lives beside the router because the router is what
 * decides that two post types are two different view trees.
 *
 * src: https://shopify.github.io/flash-list/docs/1.x/fundamentals/performant-components · @shopify/flash-list 1.6.4 · 2026-08-05
 */
export function feedItemType(post: Pick<ReelRow, 'post_type'>): PostType {
  return post.post_type;
}

/**
 * One post, one page — whatever kind of post it is.
 *
 * ## The one line that makes recycling safe
 *
 * FlashList does not mount a cell per post: it keeps a pool per `getItemType`
 * and re-renders the SAME component instance with the next post's data. Every
 * `useState` inside a cell therefore survives the swipe unless something clears
 * it, and because the pools are keyed on `post_type` a poll only ever recycles
 * into another poll — the case where the carry-over is invisible to the code and
 * unmistakable to the viewer. She votes on poll A, swipes, and poll B opens
 * with results showing, a tick on an option she never chose, a tally carrying a
 * phantom vote of hers, and no way to answer.
 *
 * `key={post.id}` on the body is the whole fix. Two reasons it is preferred to
 * a per-cell `useEffect` reset:
 *
 *  - A key cannot be forgotten. It sits at the router, above every cell type
 *    that exists and every one that does not exist yet, so the next cell author
 *    inherits it by writing a `case`. Four of the five cells written so far
 *    forgot the reset; only `ReelCell` remembered.
 *  - A key is not late. An effect runs AFTER the commit, so a reset-by-effect
 *    still paints one frame of the previous post's state — one frame of poll A's
 *    result over poll B's question. State that is never created cannot be shown.
 *
 * The cost is that the body subtree re-mounts on recycle rather than
 * re-rendering. FlashList's native view container is still reused and the pools
 * still keep a game cell's tree out of a video cell's, so what is paid is one
 * React mount of a small tree per swipe — against a class of defect that
 * misreports a viewer's own answer to a question like "are you out to your
 * family".
 *
 * The pager takes a render callback rather than owning its cell precisely so
 * the switch below can live in one place and hand each component the props that
 * component actually wants. Everything the viewer recognises as chrome is
 * shared underneath, so switching there changes the body and nothing else.
 *
 * ## The other thing the router owns: who is in the accessibility tree
 *
 * `drawDistance = pageH * 2` keeps about five cells mounted, and each carries
 * roughly a dozen accessible nodes — an avatar, five rail controls with counts,
 * a handle, a caption, a "more", a community line, a crest. All of them used to
 * be in the accessibility tree at once. A TalkBack user swiping right from the
 * top of the post she could see walked sixty controls: five "Open Mara's
 * profile", five "Like video, 3 likes", five "Report, block or hide", nothing to
 * say which post any of them belonged to, and no way to reach the next post —
 * the pager advances on a real scroll, and linear accessibility traversal is not
 * one.
 *
 * The gate wraps the whole cell, chrome included, for the same reason `key`
 * lives here: it is inherited by writing a `case`, so the `event` and `game`
 * cells of a later slice cannot ship without it. Putting it on five cell roots
 * would be five chances to forget — and four of the five cells written so far
 * did forget the recycling reset.
 *
 * `accessibilityElementsHidden` is the iOS half, `importantForAccessibility` the
 * Android half. Both are needed; neither covers the other platform.
 * src: https://reactnative-archive-august-2025.netlify.app/docs/0.74/accessibility · react-native 0.74.5 · 2026-08-07
 */
export function FeedCell(props: FeedCellProps): ReactElement {
  // Identity, never `index === activeIndex`: an index carries neither identity
  // nor type, and it is stale the moment a page is spliced in ahead of a cell.
  const active = props.post.id === props.activeItemId;

  return (
    <View
      testID="feed-cell-a11y"
      // The page's own size, so the gate is a frame around the cell rather than
      // a shrink-wrap that could collapse an absolutely-positioned child.
      style={{ width: props.width, height: props.height }}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? 'yes' : 'no-hide-descendants'}
    >
      {/* Keyed INSIDE the gate: the gate is the recycled instance's stable
          root, and the body is what has to be thrown away per post. */}
      <FeedCellBody key={props.post.id} {...props} active={active} />
    </View>
  );
}

/**
 * The type switch. Never rendered without the key and the gate above.
 *
 * An unrecognised type falls through to the text treatment rather than
 * rendering nothing: `event` and `game` cells are a later slice, and until they
 * exist the pager still has to be able to page past one without showing a black
 * screen.
 */
function FeedCellBody({
  post, index, activeIndex, activeItemId, width, height, active,
  muted, onToggleMute, onOpenPost, onVote,
  ...chrome
}: FeedCellProps & { active: boolean }): ReactElement {
  const body = { post, width, height, onOpenPost, active, ...chrome };

  const vote = useCallback(
    (optionKey: string) => (onVote ?? submitPollVote)(post.id, optionKey),
    [onVote, post.id],
  );

  switch (post.post_type) {
    case 'video':
      return (
        <ReelCell
          post={post}
          index={index}
          activeIndex={activeIndex}
          activeItemId={activeItemId}
          width={width}
          height={height}
          muted={muted}
          onToggleMute={onToggleMute}
          onOpenPost={onOpenPost}
          {...chrome}
        />
      );

    case 'photo':
    case 'gallery':
      return <PhotoCell {...body} />;

    case 'poll': {
      // A poll's answers live in the post body — there is no options table — so
      // a poll whose author never wrote a list is just a written post, and the
      // text treatment reads better than an empty ballot.
      const poll = parsePoll(post.content);
      return poll ? <PollCell {...body} poll={poll} onVote={vote} /> : <TextCell {...body} />;
    }

    case 'resource':
    case 'roxy_link':
      return <ResourceCell {...body} />;

    default:
      return <TextCell {...body} />;
  }
}
