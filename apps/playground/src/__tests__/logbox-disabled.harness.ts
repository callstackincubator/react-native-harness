import { describe, it, expect, isLogBoxSuppressed } from 'react-native-harness';
import {
  LogBox,
  Platform,
  type TurboModule,
  TurboModuleRegistry,
} from 'react-native';

const HANDLED_ERROR_MARKER = 'HARNESS_LOGBOX_HANDLED_NATIVE_ERROR';
const CONSOLE_PROBE_MARKER = 'HARNESS_LOGBOX_CONSOLE_PROBE';

type NativeLogBoxModule = TurboModule & {
  show: () => void;
  hide: () => void;
};

type HarnessLogBox = typeof LogBox & {
  addException: (error: unknown) => void;
};

describe('LogBox disabled for harness', () => {
  it('suppresses LogBox UI during harness runs', () => {
    expect(isLogBoxSuppressed()).toBe(true);
  });

  it('noops LogBox.addException so errors are not shown in-app', () => {
    const harnessLogBox = LogBox as HarnessLogBox;

    expect(() =>
      harnessLogBox.addException({
        message: 'LogBox probe — should not open UI',
        stack: [],
        id: 0,
        isFatal: true,
        extraData: {},
      }),
    ).not.toThrow();
  });

  it('noops the native LogBox TurboModule when linked', () => {
    const nativeLogBox =
      TurboModuleRegistry?.get<NativeLogBoxModule>('LogBox');

    if (nativeLogBox == null) {
      return;
    }

    expect(() => nativeLogBox.show()).not.toThrow();
    expect(() => nativeLogBox.hide()).not.toThrow();
  });

  it('surfaces handled native errors on the sync Turbo Module path', async (context) => {
    context.skip(
      Platform.OS === 'web',
      'PlaygroundCrash is a native-only TurboModule',
    );

    const { default: PlaygroundCrash } = await import(
      '../native/PlaygroundCrash'
    );
    const marker = `${HANDLED_ERROR_MARKER} platform=${Platform.OS}`;

    expect(() => PlaygroundCrash.crashHandled(marker)).toThrow(
      new RegExp(HANDLED_ERROR_MARKER),
    );
  });

  it('still forwards explicit console.error calls (Metro client_log path)', () => {
    const consoleErrors: unknown[][] = [];
    const originalConsoleError = console.error;

    console.error = (...args: unknown[]) => {
      consoleErrors.push(args);
      originalConsoleError.apply(console, args);
    };

    console.error(CONSOLE_PROBE_MARKER);
    console.error = originalConsoleError;

    expect(
      consoleErrors.some((args) =>
        String(args[0] ?? '').includes(CONSOLE_PROBE_MARKER),
      ),
    ).toBe(true);
  });
});
