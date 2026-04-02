import {
  definePlugin,
  type HarnessPlugin,
} from '@react-native-harness/plugins';
import type { Config as HarnessConfig } from '@react-native-harness/config';
import type { HarnessPlatform } from '@react-native-harness/platforms';
import { spawn } from '@react-native-harness/tools';

type ActionHookState = {
  _unused?: never;
};

const getInlineHookScript = (
  name: 'PRE_RUN_HOOK' | 'AFTER_RUN_HOOK'
): string | null => {
  const value = process.env[name]?.trim();

  return value ? value : null;
};

const runInlineHook = async (script: string): Promise<void> => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] != null
    )
  );

  await spawn('bash', ['-lc', script], {
    env,
    cwd: process.env.HARNESS_PROJECT_ROOT,
  });
};

export const createActionHooksPlugin = (): HarnessPlugin<
  ActionHookState,
  HarnessConfig,
  HarnessPlatform
> =>
  definePlugin({
    name: 'github-action-hooks',
    createState: () => ({}),
    hooks: {
      harness: {
        beforeRun: async () => {
          const script = getInlineHookScript('PRE_RUN_HOOK');

          if (!script) {
            return;
          }

          await runInlineHook(script);
        },
        afterRun: async (ctx) => {
          const script = getInlineHookScript('AFTER_RUN_HOOK');

          if (!script) {
            return;
          }

          process.env.HARNESS_EXIT_CODE = ctx.status === 'passed' ? '0' : '1';

          await runInlineHook(script);
        },
      },
    },
  });
