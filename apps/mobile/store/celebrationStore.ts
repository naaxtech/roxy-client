import { create } from 'zustand';
import { fetchJustEarned, type EarnedBadgeCard } from '../lib/badges';
import { claimFirstPostCelebration } from '../lib/firstPost';
import type { PostType } from '../types';

/**
 * The queue of badges waiting to be celebrated.
 *
 * A store rather than screen state, because a badge can be earned anywhere —
 * `syncMyBadges` runs on the badges screen today and will run after a vote, a
 * post, an event RSVP tomorrow. The celebration is mounted once at the root and
 * fires wherever the sync happened, so no future caller has to remember to
 * render it. That is the difference between a reward and a screen that happens
 * to have one.
 *
 * The same goes for "Your first post is live": the composer `replace`s itself
 * with her profile the moment the write lands, so the moment has to live above
 * both screens or it would unmount with the composer.
 */
export type FirstPostMoment = { postType: PostType };

interface CelebrationState {
  pending: EarnedBadgeCard[];
  /** Set once, after her first post ever goes live. Null otherwise. */
  firstPost: FirstPostMoment | null;
  /** Ask the server which badges just landed, then queue them. */
  celebrate: (newlyEarned: number) => Promise<void>;
  dismiss: () => void;
  /** Call after a successful publish; shows the moment only for her first post. */
  celebrateFirstPost: (userId: string, postType: PostType) => Promise<void>;
  dismissFirstPost: () => void;
}

export const useCelebrationStore = create<CelebrationState>((set) => ({
  pending: [],
  firstPost: null,

  celebrate: async (newlyEarned) => {
    if (newlyEarned <= 0) return;
    const badges = await fetchJustEarned(newlyEarned);
    // Never announce a celebration with nothing in it: `fetchJustEarned`
    // returns [] on a failed read, and an empty overlay is worse than a missed
    // one — she taps through a blank card and learns the reward means nothing.
    if (badges.length === 0) return;
    set({ pending: badges });
  },

  dismiss: () => set({ pending: [] }),

  celebrateFirstPost: async (userId, postType) => {
    // The claim never throws and is true at most once per member.
    const first = await claimFirstPostCelebration(userId);
    if (first) set({ firstPost: { postType } });
  },

  dismissFirstPost: () => set({ firstPost: null }),
}));
