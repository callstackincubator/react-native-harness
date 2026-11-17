import type { BundlerEvent } from '@react-native-harness/bundlers';
import type { Compiler, CompilerStats } from './types.js';

export type CompilerObserver = {
  isBuildInFlight: () => boolean;
  /** Stops reporting. The compiler's hooks cannot be removed. */
  dispose: () => void;
};

/**
 * Maps the compiler's `compile`, `done` and `failed` hooks to the bundler
 * events. Each compilation is one build; stats with errors are a failed one.
 */
export const observeCompiler = ({
  compiler,
  platform,
  entryFile,
  emit,
  onBuildFinished,
}: {
  compiler: Pick<Compiler, 'hooks'>;
  platform: string;
  entryFile: string;
  emit: (event: BundlerEvent) => void;
  /** Called after the event for a finished build, with whether it succeeded. */
  onBuildFinished?: (result: { ok: boolean; stats?: CompilerStats }) => void;
}): CompilerObserver => {
  let disposed = false;
  let buildCount = 0;
  let currentBuildId: string | null = null;

  const finish = (type: 'build_done' | 'build_failed', stats?: CompilerStats) => {
    if (disposed) {
      return;
    }

    const buildId = currentBuildId ?? `webpack-${buildCount}`;
    currentBuildId = null;
    emit({ type, buildId });
    onBuildFinished?.({ ok: type === 'build_done', stats });
  };

  compiler.hooks.compile.tap('ReactNativeHarnessEvents', () => {
    if (disposed) {
      return;
    }

    buildCount += 1;
    currentBuildId = `webpack-${buildCount}`;
    emit({
      type: 'build_started',
      buildId: currentBuildId,
      platform,
      entryFile,
      dev: true,
    });
  });

  compiler.hooks.done.tap('ReactNativeHarnessEvents', (stats) => {
    finish(stats.hasErrors() ? 'build_failed' : 'build_done', stats);
  });

  compiler.hooks.failed.tap('ReactNativeHarnessEvents', () => {
    finish('build_failed');
  });

  return {
    isBuildInFlight: () => currentBuildId !== null,
    dispose: () => {
      disposed = true;
    },
  };
};
