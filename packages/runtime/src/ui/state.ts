import { create, useStore } from 'zustand/react';

export type RunnerState = {
  status: 'loading' | 'idle' | 'running';
  setStatus: (status: 'loading' | 'idle' | 'running') => void;
};

export const store = create<RunnerState>((set) => ({
  status: 'loading',
  setStatus: (status) => set({ status }),
}));

export const useRunnerStatus = () => useStore(store, (state) => state.status);
