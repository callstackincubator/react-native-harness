import { ReactNode } from 'react';
import { create } from 'zustand/react';
import { BridgeClient } from '@react-native-harness/bridge/client';
import { getClient } from './runtime.js';

type ComponentHarnessState = {
  node: ReactNode;
  options: unknown;
  layout: { x: number; y: number; width: number; height: number };
};

type RunnerState = {
  status: 'loading' | 'idle' | 'running';
  componentHarness: ComponentHarnessState | null;
  client: BridgeClient | null;
  setStatus: (status: 'idle' | 'running') => void;
  render: (node: ReactNode, options: unknown) => void;
  cleanup: () => void;
  bootstrap: () => Promise<void>;
  reportLayout: (x: number, y: number, width: number, height: number) => void;
};

function assertComponentHarnessReady(
  state: RunnerState
): asserts state is RunnerState & { componentHarness: ComponentHarnessState } {
  if (!state.componentHarness) {
    throw new Error('ComponentHarness is not ready');
  }
}

export const state = create<RunnerState>((set) => ({
  status: 'loading',
  componentHarness: null,
  client: null,
  setStatus: (status: 'idle' | 'running') => set({ status }),
  render: (node: ReactNode, options: unknown) =>
    set({
      componentHarness: {
        node,
        options,
        layout: { x: 0, y: 0, width: 0, height: 0 },
      },
    }),
  cleanup: () => set({ componentHarness: null }),
  bootstrap: async () => {
    const client = await getClient();
    set({ client, status: 'idle' });
    client.rpc.reportReady();
  },
  reportLayout: (x: number, y: number, width: number, height: number) => {
    set((state) => {
      assertComponentHarnessReady(state);

      return {
        componentHarness: {
          ...state.componentHarness,
          layout: { x, y, width, height },
        },
      };
    });
  },
}));
