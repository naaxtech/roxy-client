import { create } from 'zustand';
import { fetchJustEarned, type EarnedBadgeCard } from '../lib/badges';

/**
 * The queue of badges waiting to be celebrated.
 *
 * A store rather than screen state, because a badge can be earned anywhere —
 * `syncMyBadges` runs on the badges screen today and will run after a vote, a
 * post, an event RSVP tomorrow. The celebration is mounted once at the root and
 * fires wherever the sync happened, so no future caller has to remember to
 * render it. That is the difference between a reward and a screen that happens
 * to have one.
 */
interface CelebrationState {
  pending: EarnedBadgeCard[];
  /** Ask the server which badges just landed, then queue them. */
  celebrate: (newlyEarned: number) => Promise<void>;
  dismiss: () => void;
}

export const useCelebrationStore = create<CelebrationState>((set) => ({
  pending: [],

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
}));
