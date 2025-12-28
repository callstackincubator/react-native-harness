export type HarnessGlobal = {
  appRegistryComponentName: string;
  webSocketPort?: number;
};

declare global {
  var RN_HARNESS: HarnessGlobal | undefined;
}

export const getHarnessGlobal = (): HarnessGlobal => {
  const harnessGlobal = global.RN_HARNESS;

  if (!harnessGlobal) {
    throw new Error('RN_HARNESS global is not set');
  }

  return harnessGlobal;
};
