import {
  LogBox,
  type TurboModule,
  TurboModuleRegistry,
} from 'react-native';

type NativeLogBoxModule = TurboModule & {
  show: () => void;
  hide: () => void;
};

type HarnessLogBox = typeof LogBox & {
  addException: (error: unknown) => void;
  addLog: (log: unknown) => void;
  addConsoleLog: (level: 'warn' | 'error', ...args: unknown[]) => void;
};

let logBoxSuppressed = false;

const noop = (): undefined => undefined;

export const isLogBoxSuppressed = (): boolean => logBoxSuppressed;

/** Hide LogBox UI while keeping console.error → Metro forwarding. */
export const disableLogBoxUI = (): void => {
  const harnessLogBox = LogBox as HarnessLogBox;
  harnessLogBox.ignoreAllLogs(true);

  harnessLogBox.addException = noop;
  harnessLogBox.addLog = noop;
  harnessLogBox.addConsoleLog = noop;

  const nativeLogBox = TurboModuleRegistry.get<NativeLogBoxModule>('LogBox');
  if (nativeLogBox != null) {
    nativeLogBox.show = noop;
    nativeLogBox.hide = noop;
  }

  logBoxSuppressed = true;
};
