import { create } from 'zustand';

/**
 * Whether the Create sheet is open.
 *
 * It used to be `useState` in the tabs layout, so every open and close
 * re-rendered the navigator (jank audit, "Create sheet": a ~0.2 s freeze before
 * the sheet moved). Only the two leaves that show it subscribe now: the bar's
 * key (+ turns into ×) and the sheet host.
 */
type CreateSheetState = {
  open: boolean;
  toggle: () => void;
  close: () => void;
};

export const useCreateSheet = create<CreateSheetState>((set) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
  close: () => set({ open: false }),
}));
