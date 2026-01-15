import type { ImageSnapshotOptions } from '@react-native-harness/bridge';

export type HarnessGlobal = {
  appRegistryComponentName: string;
  webSocketPort?: number;
};

declare global {
  var RN_HARNESS: HarnessGlobal | undefined;
}

declare module '@vitest/expect' {
  interface Matchers {
    /**
     * Match the received screenshot against a stored snapshot.
     * Creates a new snapshot if one doesn't exist.
     */
    toMatchImageSnapshot(options: ImageSnapshotOptions): Promise<void>;
  }
}

export const getHarnessGlobal = (): HarnessGlobal => {
  const harnessGlobal = global.RN_HARNESS;

  if (!harnessGlobal) {
    throw new Error('RN_HARNESS global is not set');
  }

  return harnessGlobal;
};
