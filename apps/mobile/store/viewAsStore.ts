import { create } from 'zustand';
import type { AccountKind } from '../lib/features';

/**
 * Core-only overlay: preview the app as another account type.
 *
 * The signed-in row does not change. Staff, launch tags and community-owner
 * writes still go through Studio. This store only answers "what should this
 * session look like", and it is a no-op unless the real account is core.
 */
interface ViewAsState {
  preview: AccountKind | null;
  setPreview: (kind: AccountKind | null) => void;
}

export const useViewAsStore = create<ViewAsState>((set) => ({
  preview: null,
  setPreview: (kind) => set({ preview: kind }),
}));
