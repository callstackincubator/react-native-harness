import type { TestSuite } from '@react-native-harness/bridge';

export type HookType = 'beforeEach' | 'afterEach' | 'beforeAll' | 'afterAll';

const collectInheritedHooks = (
  suite: TestSuite,
  hookType: HookType
): (() => void | Promise<void>)[] => {
  const hooks: (() => void | Promise<void>)[] = [];
  const suiteChain: TestSuite[] = [];

  // Collect all suites from current to root
  let currentSuite: TestSuite | undefined = suite;
  while (currentSuite) {
    suiteChain.push(currentSuite);
    currentSuite = currentSuite.parent;
  }

  if (hookType === 'beforeEach' || hookType === 'beforeAll') {
    // For beforeEach/beforeAll: run parent hooks first (reverse the chain)
    for (let i = suiteChain.length - 1; i >= 0; i--) {
      if (hookType === 'beforeEach') {
        hooks.push(...suiteChain[i].beforeEach);
      } else {
        hooks.push(...suiteChain[i].beforeAll);
      }
    }
  } else {
    // For afterEach/afterAll: run child hooks first (use chain as-is)
    for (const suiteInChain of suiteChain) {
      if (hookType === 'afterEach') {
        hooks.push(...suiteInChain.afterEach);
      } else {
        hooks.push(...suiteInChain.afterAll);
      }
    }
  }

  return hooks;
};

export const runHooks = async (
  suite: TestSuite,
  hookType: HookType
): Promise<void> => {
  const hooks = collectInheritedHooks(suite, hookType);

  for (const hook of hooks) {
    await hook();
  }
};
