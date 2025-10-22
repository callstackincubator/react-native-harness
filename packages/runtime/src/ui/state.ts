import { create, useStore } from 'zustand/react';
import type React from 'react';
import { shallow } from 'zustand/shallow';
import { useStoreWithEqualityFn } from 'zustand/traditional';

const generateRenderKey = (): string => {
  return `render-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
};

export type RunnerState = {
  status: 'loading' | 'idle' | 'running';
  setStatus: (status: 'loading' | 'idle' | 'running') => void;
  renderedElement: React.ReactElement | null;
  setRenderedElement: (element: React.ReactElement | null) => void;
  updateRenderedElement: (element: React.ReactElement) => void;
  renderKey: string | null;
  onLayoutCallback: (() => void) | null;
  setOnLayoutCallback: (callback: (() => void) | null) => void;
  onRenderCallback: (() => void) | null;
  setOnRenderCallback: (callback: (() => void) | null) => void;
};

export const store = create<RunnerState>((set) => ({
  status: 'loading',
  setStatus: (status) => set({ status }),
  renderedElement: null,
  setRenderedElement: (element) =>
    set({
      renderedElement: element,
      renderKey: generateRenderKey(),
    }),
  updateRenderedElement: (element) =>
    set({
      renderedElement: element,
    }),
  renderKey: null,
  onLayoutCallback: null,
  setOnLayoutCallback: (callback) => set({ onLayoutCallback: callback }),
  onRenderCallback: null,
  setOnRenderCallback: (callback) => set({ onRenderCallback: callback }),
}));

export const useRunnerStatus = () => useStore(store, (state) => state.status);
export const useRenderedElement = () =>
  useStoreWithEqualityFn(
    store,
    (state) => ({
      element: state.renderedElement,
      key: state.renderKey,
    }),
    shallow
  );
