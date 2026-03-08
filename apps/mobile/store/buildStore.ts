import { create } from "zustand";
import { Business, ImpactProject } from "../types";

interface BuildState {
  businesses: Business[];
  impactProjects: ImpactProject[];
  loading: boolean;
  setBusinesses: (businesses: Business[]) => void;
  setImpactProjects: (impactProjects: ImpactProject[]) => void;
  setLoading: (loading: boolean) => void;
  incrementSupporter: (projectId: string) => void;
}

export const useBuildStore = create<BuildState>((set) => ({
  businesses: [],
  impactProjects: [],
  loading: false,

  setBusinesses: (businesses) => set({ businesses }),

  setImpactProjects: (impactProjects) => set({ impactProjects }),

  setLoading: (loading) => set({ loading }),

  incrementSupporter: (projectId) =>
    set((s) => ({
      impactProjects: s.impactProjects.map((p) =>
        p.id === projectId
          ? { ...p, supporter_count: p.supporter_count + 1 }
          : p
      ),
    })),
}));
