import { create } from 'zustand';

interface LayoutComputeStore {
  isComputing: boolean;
  setComputing: (value: boolean) => void;
}

export const useLayoutComputeStore = create<LayoutComputeStore>((set) => ({
  isComputing: false,
  setComputing: (value: boolean) => set({ isComputing: value }),
}));
