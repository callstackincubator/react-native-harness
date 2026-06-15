import type { SuiteHookFn, TestFn, TestSuite } from '@react-native-harness/bridge';
import { omitPromiseFromTracking } from '../promise-tracker.js';
import type { ActiveTestContext } from './types.js';

export type HookType = 'beforeEach' | 'afterEach' | 'beforeAll' | 'afterAll';

const collectInheritedHooks = (
  suite: TestSuite,
  hookType: 'beforeEach' | 'afterEach'
): TestFn[] => {
  const hooks: TestFn[] = [];
  const suiteChain: TestSuite[] = [];

  let current: TestSuite | undefined = suite;
  while (current) {
    suiteChain.unshift(current);
    current = current.parent;
  }

  for (const currentSuite of suiteChain) {
    hooks.push(...currentSuite[hookType]);
  }

  return hooks;
};

const collectSuiteHooks = (
  suite: TestSuite,
  hookType: 'beforeAll' | 'afterAll'
): SuiteHookFn[] => {
  const hooks: SuiteHookFn[] = [];
  const suiteChain: TestSuite[] = [];

  // Collect all suites from current to root
  let currentSuite: TestSuite | undefined = suite;
  while (currentSuite) {
    suiteChain.push(currentSuite);
    currentSuite = currentSuite.parent;
  }

  if (hookType === 'beforeAll') {
    // Run parent suite hooks before child suite hooks.
    for (let i = suiteChain.length - 1; i >= 0; i--) {
      hooks.push(...suiteChain[i].beforeAll);
    }
  } else {
    // Run child suite hooks before parent suite hooks.
    for (const suiteInChain of suiteChain) {
      hooks.push(...suiteInChain.afterAll);
    }
  }

  return hooks;
};

export const runHooks = async (
  suite: TestSuite,
  hookType: HookType,
  context?: ActiveTestContext,
  options: {
    wrapHook?: (runHook: () => Promise<void>) => Promise<void>;
  } = {},
): Promise<void> => {
  if (hookType === 'beforeAll' || hookType === 'afterAll') {
    const hooks = collectSuiteHooks(suite, hookType);

    for (const hook of hooks) {
      const runHook = async () => {
        const result = hook();
        omitPromiseFromTracking(result);
        await result;
      };
      await (options.wrapHook ? options.wrapHook(runHook) : runHook());
    }

    return;
  }

  const hooks = collectInheritedHooks(suite, hookType);

  for (const hook of hooks) {
    const runHook = async () => {
      const result = hook(context as ActiveTestContext);
      omitPromiseFromTracking(result);
      await result;
    };
    await (options.wrapHook ? options.wrapHook(runHook) : runHook());
  }
};
