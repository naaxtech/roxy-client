import { create } from 'zustand';
import { Business, ImpactProject } from '../types';
import { supabase } from '../lib/supabase';
import { ilikePattern } from '../lib/ilikePattern';

interface BuildState {
  businesses: Business[];
  impactProjects: ImpactProject[];
  loading: boolean;
  bookmarkedBusinessIds: Set<string>;
  supportedProjectIds: Set<string>;
  searchChips: string[];

  setBusinesses: (businesses: Business[]) => void;
  setImpactProjects: (impactProjects: ImpactProject[]) => void;
  setLoading: (loading: boolean) => void;
  incrementSupporter: (projectId: string) => void;

  addSearchChip: (chip: string) => void;
  removeSearchChip: (chip: string) => void;
  setSearchChips: (chips: string[]) => void;

  loadBookmarks: (userId: string) => Promise<void>;
  loadSupports: (userId: string) => Promise<void>;

  toggleBookmark: (businessId: string, userId: string) => Promise<void>;
  supportProject: (projectId: string, userId: string) => Promise<void>;

  loadBusinesses: (chips: string[], wlwOnly: boolean, communityMemberIds?: string[]) => Promise<void>;
}

export const useBuildStore = create<BuildState>((set, get) => ({
  businesses: [],
  impactProjects: [],
  loading: false,
  bookmarkedBusinessIds: new Set(),
  supportedProjectIds: new Set(),
  searchChips: [],

  setBusinesses: (businesses) => set({ businesses }),
  setImpactProjects: (impactProjects) => set({ impactProjects }),
  setLoading: (loading) => set({ loading }),

  incrementSupporter: (projectId) =>
    set((s) => ({
      impactProjects: s.impactProjects.map((p) =>
        p.id === projectId ? { ...p, supporter_count: p.supporter_count + 1 } : p
      ),
    })),

  addSearchChip: (chip) =>
    set((s) => {
      const lower = chip.toLowerCase().trim();
      if (!lower) return s;
      const exists = s.searchChips.some((c) => c.toLowerCase() === lower);
      if (exists) return s;
      return { searchChips: [...s.searchChips, chip.trim()] };
    }),

  removeSearchChip: (chip) =>
    set((s) => ({ searchChips: s.searchChips.filter((c) => c !== chip) })),

  setSearchChips: (chips) => set({ searchChips: chips }),

  loadBookmarks: async (userId) => {
    const { data } = await supabase
      .from('user_business_bookmarks')
      .select('business_id')
      .eq('user_id', userId);
    if (data) {
      set({ bookmarkedBusinessIds: new Set(data.map((r: any) => r.business_id)) });
    }
  },

  loadSupports: async (userId) => {
    const { data } = await supabase
      .from('user_project_supports')
      .select('project_id')
      .eq('user_id', userId);
    if (data) {
      set({ supportedProjectIds: new Set(data.map((r: any) => r.project_id)) });
    }
  },

  toggleBookmark: async (businessId, userId) => {
    const isBookmarked = get().bookmarkedBusinessIds.has(businessId);

    // Optimistic update
    set((s) => {
      const next = new Set(s.bookmarkedBusinessIds);
      if (isBookmarked) {
        next.delete(businessId);
      } else {
        next.add(businessId);
      }
      return { bookmarkedBusinessIds: next };
    });

    // supabase-js returns errors, it does not throw — check explicitly, and
    // upsert so a row that already exists (state raced hydration) is a no-op
    // instead of a 409 that leaves the heart permanently out of sync.
    const { error } = isBookmarked
      ? await supabase
          .from('user_business_bookmarks')
          .delete()
          .match({ user_id: userId, business_id: businessId })
      : await supabase
          .from('user_business_bookmarks')
          .upsert(
            { user_id: userId, business_id: businessId },
            { onConflict: 'user_id,business_id', ignoreDuplicates: true },
          );

    if (error) {
      // Rollback
      set((s) => {
        const next = new Set(s.bookmarkedBusinessIds);
        if (isBookmarked) {
          next.add(businessId);
        } else {
          next.delete(businessId);
        }
        return { bookmarkedBusinessIds: next };
      });
    }
  },

  supportProject: async (projectId, userId) => {
    if (get().supportedProjectIds.has(projectId)) return;

    // Optimistic update
    set((s) => ({
      supportedProjectIds: new Set([...s.supportedProjectIds, projectId]),
      impactProjects: s.impactProjects.map((p) =>
        p.id === projectId ? { ...p, supporter_count: p.supporter_count + 1 } : p
      ),
    }));

    const { error } = await supabase
      .from('user_project_supports')
      .insert({ user_id: userId, project_id: projectId });

    if (error) {
      // Rollback
      set((s) => {
        const next = new Set(s.supportedProjectIds);
        next.delete(projectId);
        return {
          supportedProjectIds: next,
          impactProjects: s.impactProjects.map((p) =>
            p.id === projectId
              ? { ...p, supporter_count: Math.max(0, p.supporter_count - 1) }
              : p
          ),
        };
      });
    }
  },

  loadBusinesses: async (chips, wlwOnly, communityMemberIds) => {
    let query = supabase.from('businesses').select('*').eq('is_verified', true);

    if (communityMemberIds && communityMemberIds.length > 0) {
      query = query.in('owner_id', communityMemberIds);
    }

    // A chip is user input going into PostgREST's own filter grammar. Built by
    // bare interpolation, a chip containing a comma or a paren was read as
    // extra clauses and emptied the directory, and a chip containing `%` or `_`
    // — the ILIKE wildcards — matched every business on Roxy. `ilikePattern`
    // escapes both and returns null for a chip that was nothing else, because a
    // pattern of `%%` is the same as no filter at all.
    for (const chip of chips) {
      const pattern = ilikePattern(chip);
      if (!pattern) continue;
      query = query.or(
        `name.ilike.${pattern},description.ilike.${pattern},category.ilike.${pattern}`
      );
    }

    if (wlwOnly) {
      query = query.eq('is_wlw_owned', true);
    }

    const { data } = await query
      .order('is_verified', { ascending: false })
      .order('name')
      .limit(50);

    set({ businesses: (data as Business[]) ?? [] });
  },
}));
