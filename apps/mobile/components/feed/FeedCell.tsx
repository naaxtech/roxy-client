import { useCallback } from 'react';
import type { ReactElement } from 'react';
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
  /** Opens this post's own detail surface. */
  onOpenPost: () => void;
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
 * The pager takes a render callback rather than owning its cell precisely so
 * this switch can live in one place and hand each component the props that
 * component actually wants. Everything the viewer recognises as chrome is
 * shared underneath, so switching here changes the body and nothing else.
 *
 * An unrecognised type falls through to the text treatment rather than
 * rendering nothing: `event` and `game` cells are a later slice, and until they
 * exist the pager still has to be able to page past one without showing a black
 * screen.
 */
export function FeedCell({
  post, index, activeIndex, activeItemId, width, height,
  muted, onToggleMute, onOpenPost, onVote,
  ...chrome
}: FeedCellProps): ReactElement {
  // Identity, never `index === activeIndex`: an index carries neither identity
  // nor type, and it is stale the moment a page is spliced in ahead of a cell.
  const active = post.id === activeItemId;
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
