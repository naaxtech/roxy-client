import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { logError } from '../lib/errorLogger';
import {
  fetchArchiveEntries,
  type ArchiveEntry,
  type ArchiveMediaType,
  type ArchiveSort,
} from '../lib/archive';

/**
 * The WLW Archive: browse state, and the one write surface a PENDING member
 * gets (096_archive_rls.sql's own header calls this out by name) — voting and
 * her watchlist, direct through RLS, no edge function, because both are
 * reversible and the point is that they feel instant.
 *
 * Shape copied from marketplaceStore: a `currentUserId()` helper that reads
 * the live Supabase session rather than trusting a cached id, and every
 * mutation logs through `logError`, never console.
 *
 * Reviews, content notes, and revisions — the approved-member-only surfaces —
 * are NOT here. `agreeNote` is the one action in this store that requires
 * `is_approved_member()` (096's "Note agreements" section), which is why it
 * is the one action that can come back genuinely refused rather than merely
 * failed.
 */

export type ArchiveFilters = {
  query: string;
  mediaType: ArchiveMediaType | null;
  sort: ArchiveSort;
};

interface ArchiveState {
  entries: ArchiveEntry[];
  loading: boolean;
  error: string | null;
  filters: ArchiveFilters;

  /** Her own vote per entry. An absent key means "never voted" — never coerce it to false. */
  myVotes: Record<string, boolean>;
  /** Entry ids on her watchlist. */
  watchlist: string[];
  /** Content-note ids she has agreed with. One-way: 096 gives archive_note_agreements no DELETE policy. */
  noteAgreements: string[];

  load: () => Promise<void>;
  setFilters: (patch: Partial<ArchiveFilters>) => void;
  hydrateMine: (userId: string) => Promise<void>;
  vote: (entryId: string, value: boolean) => Promise<void>;
  toggleWatch: (entryId: string) => Promise<void>;
  agreeNote: (noteId: string) => Promise<void>;
}

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

const GENERIC_VOTE_ERROR = "We couldn't save your vote. Please try again.";
const GENERIC_WATCH_ERROR = "We couldn't update your watchlist. Please try again.";
const GENERIC_NOTE_ERROR = "We couldn't record your agreement. Please try again.";
const SIGN_IN_AGAIN = 'Please sign in again to continue.';
const APPROVED_ONLY_NOTE_ERROR = 'Only approved members can flag content notes yet.';

export const useArchiveStore = create<ArchiveState>((set, get) => ({
  entries: [],
  loading: false,
  error: null,
  filters: { query: '', mediaType: null, sort: 'top' },
  myVotes: {},
  watchlist: [],
  noteAgreements: [],

  load: async () => {
    set({ loading: true, error: null });
    const { query, mediaType, sort } = get().filters;
    try {
      const entries = await fetchArchiveEntries({ query, mediaType, sort });
      set({ entries, loading: false });
    } catch {
      // fetchArchiveEntries (lib/archive.ts) already calls logError before
      // throwing — logging the same failure again here would double-report it.
      set({ loading: false, error: "We couldn't load the Archive. Pull to try again." });
    }
  },

  setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),

  /**
   * Loads what belongs to HER: her votes, her watchlist, her note agreements.
   * A failed sub-fetch keeps whatever this store already held for that slice
   * — same discipline as safetyStore.loadBlockedUsers: a refresh that fails
   * must never look like "you have none", because an empty watchlist and a
   * blank one that failed to load render identically to her.
   */
  hydrateMine: async (userId) => {
    const [votesRes, watchlistRes, notesRes] = await Promise.all([
      supabase.from('archive_votes').select('entry_id, value').eq('profile_id', userId),
      supabase.from('archive_watchlist').select('entry_id').eq('profile_id', userId),
      supabase.from('archive_note_agreements').select('note_id').eq('profile_id', userId),
    ]);

    set(() => {
      const next: Partial<ArchiveState> = {};

      if (votesRes.error) {
        logError(votesRes.error, 'archiveStore.hydrateMine.votes');
      } else {
        const myVotes: Record<string, boolean> = {};
        for (const row of (votesRes.data ?? []) as { entry_id: string; value: boolean }[]) {
          myVotes[row.entry_id] = row.value;
        }
        next.myVotes = myVotes;
      }

      if (watchlistRes.error) {
        logError(watchlistRes.error, 'archiveStore.hydrateMine.watchlist');
      } else {
        next.watchlist = ((watchlistRes.data ?? []) as { entry_id: string }[]).map((r) => r.entry_id);
      }

      if (notesRes.error) {
        logError(notesRes.error, 'archiveStore.hydrateMine.notes');
      } else {
        next.noteAgreements = ((notesRes.data ?? []) as { note_id: string }[]).map((r) => r.note_id);
      }

      return next;
    });
  },

  /**
   * Optimistic, direct through RLS (archive_votes_insert_own /
   * archive_votes_update_own — 096) so it feels instant; nothing this
   * reversible needs an edge function.
   *
   * A PostgREST upsert answers 200 even when its ON CONFLICT DO UPDATE path
   * touches zero rows — RLS's USING clause silently filters non-matching rows
   * rather than raising, the exact class of trap `block_user`'s dead column
   * shipped. `.select()` asks for the row back so "no error" and "it actually
   * happened" cannot come apart here.
   */
  vote: async (entryId, value) => {
    const previous = get().myVotes[entryId];
    set((s) => ({ myVotes: { ...s.myVotes, [entryId]: value } }));

    const rollback = () => {
      set((s) => {
        const next = { ...s.myVotes };
        if (previous === undefined) delete next[entryId];
        else next[entryId] = previous;
        return { myVotes: next };
      });
    };

    const userId = await currentUserId();
    if (!userId) {
      rollback();
      throw new Error(SIGN_IN_AGAIN);
    }

    const { data, error } = await supabase
      .from('archive_votes')
      .upsert({ entry_id: entryId, profile_id: userId, value }, { onConflict: 'entry_id,profile_id' })
      .select('value')
      .maybeSingle();

    if (error) {
      logError(error, 'archiveStore.vote');
      rollback();
      throw new Error(GENERIC_VOTE_ERROR);
    }
    if (!data) {
      // 200, zero rows written back — see header. Never keep an unconfirmed vote.
      rollback();
      throw new Error(GENERIC_VOTE_ERROR);
    }
  },

  /**
   * Add is upsert + ignoreDuplicates: a double-tap or state drift must not
   * 409 on the primary key. Remove is delete with an exact count, because a
   * delete's USING clause can silently match nothing and still return 200 —
   * the trap this store exists to close, not repeat.
   */
  toggleWatch: async (entryId) => {
    const wasWatched = get().watchlist.includes(entryId);
    const previous = get().watchlist;
    set({
      watchlist: wasWatched ? previous.filter((id) => id !== entryId) : [...previous, entryId],
    });

    const userId = await currentUserId();
    if (!userId) {
      set({ watchlist: previous });
      throw new Error(SIGN_IN_AGAIN);
    }

    if (wasWatched) {
      const { error, count } = await supabase
        .from('archive_watchlist')
        .delete({ count: 'exact' })
        .eq('profile_id', userId)
        .eq('entry_id', entryId);

      if (error) {
        logError(error, 'archiveStore.toggleWatch');
        set({ watchlist: previous });
        throw new Error(GENERIC_WATCH_ERROR);
      }
      if (!count) {
        // 200, zero rows deleted — nothing actually left the watchlist server-side.
        set({ watchlist: previous });
        throw new Error(GENERIC_WATCH_ERROR);
      }
    } else {
      const { error } = await supabase.from('archive_watchlist').upsert(
        { profile_id: userId, entry_id: entryId },
        { onConflict: 'profile_id,entry_id', ignoreDuplicates: true }
      );

      if (error) {
        logError(error, 'archiveStore.toggleWatch');
        set({ watchlist: previous });
        throw new Error(GENERIC_WATCH_ERROR);
      }
    }
  },

  /**
   * One-way: 096 gives archive_note_agreements no DELETE policy, so there is
   * no un-agree to write. Only approved members
   * (`is_approved_member()` — 072, 'approved' OR the grandfathered
   * 'unvetted') may agree; a pending member's insert is refused by
   * archive_note_agree_insert_approved's WITH CHECK. That refusal is a real
   * Postgres 42501, and it must reach the caller as a real, specific error —
   * never swallowed into a silent no-op.
   */
  agreeNote: async (noteId) => {
    if (get().noteAgreements.includes(noteId)) return;

    const previous = get().noteAgreements;
    set({ noteAgreements: [...previous, noteId] });

    const userId = await currentUserId();
    if (!userId) {
      set({ noteAgreements: previous });
      throw new Error(SIGN_IN_AGAIN);
    }

    const { data, error } = await supabase
      .from('archive_note_agreements')
      .insert({ note_id: noteId, profile_id: userId })
      .select('note_id')
      .maybeSingle();

    if (error) {
      logError(error, 'archiveStore.agreeNote');
      if (error.code === '23505') {
        // Already recorded server-side (state drift / double-tap) — the
        // optimistic state already matches reality. Not a failure.
        return;
      }
      set({ noteAgreements: previous });
      if (error.code === '42501') {
        throw new Error(APPROVED_ONLY_NOTE_ERROR);
      }
      throw new Error(GENERIC_NOTE_ERROR);
    }
    if (!data) {
      // 200, zero rows written back — never keep an unconfirmed agreement.
      set({ noteAgreements: previous });
      throw new Error(GENERIC_NOTE_ERROR);
    }
  },
}));
