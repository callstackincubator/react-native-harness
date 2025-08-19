import { describe, it, expect } from 'vitest';
import * as harnessRuntime from '../collector/index.js';

const noop = () => {
  // Noop
};

describe('test collector - test case recognition', () => {
  it('should collect basic test cases using it()', () => {
    const collectedSuite = harnessRuntime.collectTests(() => {
      harnessRuntime.describe('Sample Suite', () => {
        harnessRuntime.it('test 1', noop);
        harnessRuntime.it('test 2', noop);
      });
    });

    expect(collectedSuite.suites).toHaveLength(1);
    const sampleSuite = collectedSuite.suites[0];
    expect(sampleSuite.name).toBe('Sample Suite');
    expect(sampleSuite.tests).toHaveLength(2);
    expect(sampleSuite.tests[0].name).toBe('test 1');
    expect(sampleSuite.tests[1].name).toBe('test 2');
    expect(sampleSuite.tests[0].status).toBe('active');
    expect(sampleSuite.tests[1].status).toBe('active');
  });

  it('should collect basic test cases using test()', () => {
    const collectedSuite = harnessRuntime.collectTests(() => {
      harnessRuntime.describe('Sample Suite', () => {
        harnessRuntime.test('test 1', noop);
        harnessRuntime.test('test 2', noop);
      });
    });

    expect(collectedSuite.suites).toHaveLength(1);
    const sampleSuite = collectedSuite.suites[0];
    expect(sampleSuite.tests).toHaveLength(2);
    expect(sampleSuite.tests[0].name).toBe('test 1');
    expect(sampleSuite.tests[1].name).toBe('test 2');
  });

  it('should collect async test functions', () => {
    const collectedSuite = harnessRuntime.collectTests(() => {
      harnessRuntime.describe('Async Suite', () => {
        harnessRuntime.it('async test', async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
        });
      });
    });

    const asyncSuite = collectedSuite.suites[0];
    expect(asyncSuite.tests[0].name).toBe('async test');
    expect(typeof asyncSuite.tests[0].fn).toBe('function');
  });

  it('should collect tests at root level', () => {
    const collectedSuite = harnessRuntime.collectTests(() => {
      harnessRuntime.it('root test 1', noop);
      harnessRuntime.test('root test 2', noop);

      harnessRuntime.describe('Suite with tests', () => {
        harnessRuntime.it('suite test', noop);
      });
    });

    // Collected root suite should have the root-level tests
    expect(collectedSuite.tests).toHaveLength(2);
    expect(collectedSuite.tests[0].name).toBe('root test 1');
    expect(collectedSuite.tests[1].name).toBe('root test 2');
    expect(collectedSuite.tests[0].status).toBe('active');
    expect(collectedSuite.tests[1].status).toBe('active');

    // Should also have the describe suite
    expect(collectedSuite.suites).toHaveLength(1);
    expect(collectedSuite.suites[0].tests).toHaveLength(1);
    expect(collectedSuite.suites[0].tests[0].name).toBe('suite test');
  });

  it('should collect tests with modifiers at root level', () => {
    const collectedSuite = harnessRuntime.collectTests(() => {
      harnessRuntime.it('regular root test', noop);
      harnessRuntime.test.skip('skipped root test', noop);
      harnessRuntime.it.todo('todo root test');
      harnessRuntime.test.only('focused root test', noop);
      harnessRuntime.it('another root test', noop);
    });

    // Collected root suite should have all the tests with correct statuses
    expect(collectedSuite.tests).toHaveLength(5);
    expect(collectedSuite.tests[0].name).toBe('regular root test');
    expect(collectedSuite.tests[0].status).toBe('skipped'); // Due to .only
    expect(collectedSuite.tests[1].name).toBe('skipped root test');
    expect(collectedSuite.tests[1].status).toBe('skipped');
    expect(collectedSuite.tests[2].name).toBe('todo root test');
    expect(collectedSuite.tests[2].status).toBe('todo');
    expect(collectedSuite.tests[3].name).toBe('focused root test');
    expect(collectedSuite.tests[3].status).toBe('active'); // The .only test
    expect(collectedSuite.tests[4].name).toBe('another root test');
    expect(collectedSuite.tests[4].status).toBe('skipped'); // Due to .only
  });
});

describe('test collector - suite recognition', () => {
  it('should collect nested describe blocks', () => {
    const collectedSuite = harnessRuntime.collectTests(() => {
      harnessRuntime.describe('Outer Suite', () => {
        harnessRuntime.describe('Inner Suite 1', () => {
          harnessRuntime.it('test 1', noop);
        });
        harnessRuntime.describe('Inner Suite 2', () => {
          harnessRuntime.it('test 2', noop);
        });
      });
    });

    expect(collectedSuite.suites).toHaveLength(1);
    const outerSuite = collectedSuite.suites[0];
    expect(outerSuite.name).toBe('Outer Suite');
    expect(outerSuite.suites).toHaveLength(2);
    expect(outerSuite.suites[0].name).toBe('Inner Suite 1');
    expect(outerSuite.suites[1].name).toBe('Inner Suite 2');
    expect(outerSuite.suites[0].tests[0].name).toBe('test 1');
    expect(outerSuite.suites[1].tests[0].name).toBe('test 2');
  });

  it('should collect multiple top-level describe blocks', () => {
    const collectedSuite = harnessRuntime.collectTests(() => {
      harnessRuntime.describe('Suite 1', () => {
        harnessRuntime.it('test 1', noop);
      });
      harnessRuntime.describe('Suite 2', () => {
        harnessRuntime.it('test 2', noop);
      });
    });

    expect(collectedSuite.suites).toHaveLength(2);
    expect(collectedSuite.suites[0].name).toBe('Suite 1');
    expect(collectedSuite.suites[1].name).toBe('Suite 2');
  });

  it('should collect deeply nested suites', () => {
    const collectedSuite = harnessRuntime.collectTests(() => {
      harnessRuntime.describe('Level 1', () => {
        harnessRuntime.describe('Level 2', () => {
          harnessRuntime.describe('Level 3', () => {
            harnessRuntime.it('deep test', noop);
          });
        });
      });
    });

    const level1 = collectedSuite.suites[0];
    const level2 = level1.suites[0];
    const level3 = level2.suites[0];

    expect(level1.name).toBe('Level 1');
    expect(level2.name).toBe('Level 2');
    expect(level3.name).toBe('Level 3');
    expect(level3.tests[0].name).toBe('deep test');
  });
});

describe('test collector - skip modifier recognition', () => {
  it('should collect and mark skipped tests with test.skip()', () => {
    const collectedSuite = harnessRuntime.collectTests(() => {
      harnessRuntime.describe('Skip Suite', () => {
        harnessRuntime.it('active test', noop);
        harnessRuntime.test.skip('skipped test', noop);
        harnessRuntime.it.skip('another skipped test', noop);
      });
    });

    const skipSuite = collectedSuite.suites[0];
    expect(skipSuite.tests).toHaveLength(3);
    expect(skipSuite.tests[0].status).toBe('active');
    expect(skipSuite.tests[1].status).toBe('skipped');
    expect(skipSuite.tests[2].status).toBe('skipped');
  });

  it('should collect and mark skipped suites with describe.skip()', () => {
    const collectedSuite = harnessRuntime.collectTests(() => {
      harnessRuntime.describe('Active Suite', () => {
        harnessRuntime.it('active test', noop);
      });
      harnessRuntime.describe.skip('Skipped Suite', () => {
        harnessRuntime.it('test in skipped suite', noop);
      });
    });

    expect(collectedSuite.suites).toHaveLength(2);
    expect(collectedSuite.suites[0].status).toBe('active');
    expect(collectedSuite.suites[1].status).toBe('skipped');
  });

  it('should collect nested skipped suites', () => {
    const collectedSuite = harnessRuntime.collectTests(() => {
      harnessRuntime.describe.skip('Outer Skipped', () => {
        harnessRuntime.describe('Inner Suite', () => {
          harnessRuntime.it('test', noop);
        });
      });
    });

    const outerSuite = collectedSuite.suites[0];
    expect(outerSuite.status).toBe('skipped');
    expect(outerSuite.suites[0].tests[0].name).toBe('test');
  });
});

describe('test collector - only modifier recognition', () => {
  it('should collect and mark only tests and skip others with test.only()', () => {
    const collectedSuite = harnessRuntime.collectTests(() => {
      harnessRuntime.describe('Only Suite', () => {
        harnessRuntime.it('regular test 1', noop);
        harnessRuntime.test.only('focused test', noop);
        harnessRuntime.it('regular test 2', noop);
      });
    });

    const onlySuite = collectedSuite.suites[0];
    expect(onlySuite.tests).toHaveLength(3);
    expect(onlySuite.tests[0].status).toBe('skipped');
    expect(onlySuite.tests[1].status).toBe('active');
    expect(onlySuite.tests[2].status).toBe('skipped');
    expect(onlySuite._hasFocused).toBe(true);
  });

  it('should collect multiple test.only() calls', () => {
    const collectedSuite = harnessRuntime.collectTests(() => {
      harnessRuntime.describe('Multiple Only Suite', () => {
        harnessRuntime.it('regular test', noop);
        harnessRuntime.test.only('focused test 1', noop);
        harnessRuntime.test.only('focused test 2', noop);
      });
    });

    const multipleSuite = collectedSuite.suites[0];
    expect(multipleSuite.tests[0].status).toBe('skipped');
    expect(multipleSuite.tests[1].status).toBe('active'); // First only stays active
    expect(multipleSuite.tests[2].status).toBe('active'); // Second only also active
  });

  it('should collect and mark only suites and skip others with describe.only()', () => {
    const collectedSuite = harnessRuntime.collectTests(() => {
      harnessRuntime.describe('Regular Suite 1', () => {
        harnessRuntime.it('test 1', noop);
      });
      harnessRuntime.describe.only('Focused Suite', () => {
        harnessRuntime.it('focused test', noop);
      });
      harnessRuntime.describe('Regular Suite 2', () => {
        harnessRuntime.it('test 2', noop);
      });
    });

    expect(collectedSuite.suites).toHaveLength(3);
    expect(collectedSuite.suites[0].status).toBe('skipped');
    expect(collectedSuite.suites[1].status).toBe('active');
    expect(collectedSuite.suites[2].status).toBe('skipped');
    expect(collectedSuite.suites[1]._hasFocused).toBe(true);
  });

  it('should collect nested describe.only()', () => {
    const collectedSuite = harnessRuntime.collectTests(() => {
      harnessRuntime.describe('Outer Suite', () => {
        harnessRuntime.describe('Regular Inner', () => {
          harnessRuntime.it('test 1', noop);
        });
        harnessRuntime.describe.only('Focused Inner', () => {
          harnessRuntime.it('focused test', noop);
        });
      });
    });

    const outerSuite = collectedSuite.suites[0];
    expect(outerSuite.status).toBe('active');
    expect(outerSuite._hasFocused).toBe(true);
    expect(outerSuite.suites[0].status).toBe('skipped');
    expect(outerSuite.suites[1].status).toBe('active');
  });
});

describe('test collector - todo test recognition', () => {
  it('should collect and mark todo tests with test.todo()', () => {
    const collectedSuite = harnessRuntime.collectTests(() => {
      harnessRuntime.describe('Todo Suite', () => {
        harnessRuntime.it('regular test', noop);
        harnessRuntime.test.todo('todo test');
        harnessRuntime.it.todo('another todo test');
      });
    });

    const todoSuite = collectedSuite.suites[0];
    expect(todoSuite.tests).toHaveLength(3);
    expect(todoSuite.tests[0].status).toBe('active');
    expect(todoSuite.tests[1].status).toBe('todo');
    expect(todoSuite.tests[2].status).toBe('todo');
  });

  it('should collect todo tests without function bodies', () => {
    const collectedSuite = harnessRuntime.collectTests(() => {
      harnessRuntime.describe('Todo Suite', () => {
        harnessRuntime.test.todo('implement this feature');
      });
    });

    const todoSuite = collectedSuite.suites[0];
    expect(todoSuite.tests[0].name).toBe('implement this feature');
    expect(todoSuite.tests[0].status).toBe('todo');
    expect(typeof todoSuite.tests[0].fn).toBe('function');
  });
});

describe('test collector - hook recognition', () => {
  it('should collect beforeAll hooks', () => {
    const collectedSuite = harnessRuntime.collectTests(() => {
      harnessRuntime.describe('Hook Suite', () => {
        harnessRuntime.beforeAll(() => {
          // setup
        });
        harnessRuntime.beforeAll(async () => {
          // async setup
        });
        harnessRuntime.it('test', noop);
      });
    });

    const hookSuite = collectedSuite.suites[0];
    expect(hookSuite.beforeAll).toHaveLength(2);
    expect(typeof hookSuite.beforeAll[0]).toBe('function');
    expect(typeof hookSuite.beforeAll[1]).toBe('function');
  });

  it('should collect afterAll hooks', () => {
    const collectedSuite = harnessRuntime.collectTests(() => {
      harnessRuntime.describe('Hook Suite', () => {
        harnessRuntime.afterAll(() => {
          // cleanup
        });
        harnessRuntime.it('test', noop);
      });
    });

    const hookSuite = collectedSuite.suites[0];
    expect(hookSuite.afterAll).toHaveLength(1);
    expect(typeof hookSuite.afterAll[0]).toBe('function');
  });

  it('should collect beforeEach hooks', () => {
    const collectedSuite = harnessRuntime.collectTests(() => {
      harnessRuntime.describe('Hook Suite', () => {
        harnessRuntime.beforeEach(() => {
          // setup each
        });
        harnessRuntime.beforeEach(async () => {
          // async setup each
        });
        harnessRuntime.it('test', noop);
      });
    });

    const hookSuite = collectedSuite.suites[0];
    expect(hookSuite.beforeEach).toHaveLength(2);
    expect(typeof hookSuite.beforeEach[0]).toBe('function');
    expect(typeof hookSuite.beforeEach[1]).toBe('function');
  });

  it('should collect afterEach hooks', () => {
    const collectedSuite = harnessRuntime.collectTests(() => {
      harnessRuntime.describe('Hook Suite', () => {
        harnessRuntime.afterEach(() => {
          // cleanup each
        });
        harnessRuntime.it('test', noop);
      });
    });

    const hookSuite = collectedSuite.suites[0];
    expect(hookSuite.afterEach).toHaveLength(1);
    expect(typeof hookSuite.afterEach[0]).toBe('function');
  });

  it('should collect all types of hooks together', () => {
    const collectedSuite = harnessRuntime.collectTests(() => {
      harnessRuntime.describe('All Hooks Suite', () => {
        harnessRuntime.beforeAll(noop);
        harnessRuntime.afterAll(noop);
        harnessRuntime.beforeEach(noop);
        harnessRuntime.afterEach(noop);
        harnessRuntime.it('test', noop);
      });
    });

    const allHooksSuite = collectedSuite.suites[0];
    expect(allHooksSuite.beforeAll).toHaveLength(1);
    expect(allHooksSuite.afterAll).toHaveLength(1);
    expect(allHooksSuite.beforeEach).toHaveLength(1);
    expect(allHooksSuite.afterEach).toHaveLength(1);
  });

  it('should collect hooks at root level', () => {
    const collectedSuite = harnessRuntime.collectTests(() => {
      harnessRuntime.beforeAll(() => {
        // root level setup
      });
      harnessRuntime.afterAll(() => {
        // root level cleanup
      });
      harnessRuntime.beforeEach(() => {
        // root level setup each
      });
      harnessRuntime.afterEach(() => {
        // root level cleanup each
      });

      harnessRuntime.describe('Test Suite', () => {
        harnessRuntime.it('test', noop);
      });
    });

    // Collected root suite should have the hooks
    expect(collectedSuite.beforeAll).toHaveLength(1);
    expect(collectedSuite.afterAll).toHaveLength(1);
    expect(collectedSuite.beforeEach).toHaveLength(1);
    expect(collectedSuite.afterEach).toHaveLength(1);
    expect(typeof collectedSuite.beforeAll[0]).toBe('function');
    expect(typeof collectedSuite.afterAll[0]).toBe('function');
    expect(typeof collectedSuite.beforeEach[0]).toBe('function');
    expect(typeof collectedSuite.afterEach[0]).toBe('function');
  });

  it('should collect hooks at both root and suite levels', () => {
    const collectedSuite = harnessRuntime.collectTests(() => {
      // Root level hooks
      harnessRuntime.beforeAll(() => {
        // global setup
      });
      harnessRuntime.beforeEach(() => {
        // global setup each
      });

      harnessRuntime.describe('Suite with hooks', () => {
        // Suite level hooks
        harnessRuntime.beforeAll(() => {
          // suite setup
        });
        harnessRuntime.beforeEach(() => {
          // suite setup each
        });
        harnessRuntime.it('test', noop);
      });
    });

    // Collected root suite should have its hooks
    expect(collectedSuite.beforeAll).toHaveLength(1);
    expect(collectedSuite.beforeEach).toHaveLength(1);

    // Child suite should have its own hooks
    const childSuite = collectedSuite.suites[0];
    expect(childSuite.beforeAll).toHaveLength(1);
    expect(childSuite.beforeEach).toHaveLength(1);
  });
});

describe('test collector - complex scenarios', () => {
  it('should collect mix of tests, suites, hooks, and modifiers', () => {
    const collectedSuite = harnessRuntime.collectTests(() => {
      harnessRuntime.describe('Complex Suite', () => {
        harnessRuntime.beforeAll(noop);
        harnessRuntime.beforeEach(noop);

        harnessRuntime.it('regular test', noop);
        harnessRuntime.test.skip('skipped test', noop);
        harnessRuntime.test.todo('todo test');

        harnessRuntime.describe.skip('Skipped Inner Suite', () => {
          harnessRuntime.it('inner test', noop);
        });

        harnessRuntime.describe('Regular Inner Suite', () => {
          harnessRuntime.beforeEach(noop);
          harnessRuntime.it('inner test 1', noop);
          harnessRuntime.test.only('focused inner test', noop);
          harnessRuntime.it('inner test 2', noop);
          harnessRuntime.afterEach(noop);
        });

        harnessRuntime.afterAll(noop);
      });
    });

    const complexSuite = collectedSuite.suites[0];

    // Check hooks
    expect(complexSuite.beforeAll).toHaveLength(1);
    expect(complexSuite.afterAll).toHaveLength(1);
    expect(complexSuite.beforeEach).toHaveLength(1);

    // Check tests
    expect(complexSuite.tests).toHaveLength(3);
    expect(complexSuite.tests[0].status).toBe('active');
    expect(complexSuite.tests[1].status).toBe('skipped');
    expect(complexSuite.tests[2].status).toBe('todo');

    // Check nested suites
    expect(complexSuite.suites).toHaveLength(2);
    expect(complexSuite.suites[0].status).toBe('skipped');

    const innerSuite = complexSuite.suites[1];
    expect(innerSuite.beforeEach).toHaveLength(1);
    expect(innerSuite.afterEach).toHaveLength(1);
    expect(innerSuite.tests).toHaveLength(3);
    expect(innerSuite.tests[0].status).toBe('skipped'); // Due to .only
    expect(innerSuite.tests[1].status).toBe('active'); // The .only test
    expect(innerSuite.tests[2].status).toBe('skipped'); // Due to .only
  });

  it('should clear collector state between collectTests calls', () => {
    const collectedSuite1 = harnessRuntime.collectTests(() => {
      harnessRuntime.describe('Suite 1', () => {
        harnessRuntime.it('test 1', noop);
      });
    });

    const collectedSuite2 = harnessRuntime.collectTests(() => {
      harnessRuntime.describe('Suite 2', () => {
        harnessRuntime.it('test 2', noop);
      });
    });

    expect(collectedSuite1.suites).toHaveLength(1);
    expect(collectedSuite2.suites).toHaveLength(1);
    expect(collectedSuite1.suites[0].name).toBe('Suite 1');
    expect(collectedSuite2.suites[0].name).toBe('Suite 2');
  });

  it('should collect empty describe blocks', () => {
    const collectedSuite = harnessRuntime.collectTests(() => {
      harnessRuntime.describe('Empty Suite', () => {
        // No tests or hooks
      });
    });

    const emptySuite = collectedSuite.suites[0];
    expect(emptySuite.name).toBe('Empty Suite');
    expect(emptySuite.tests).toHaveLength(0);
    expect(emptySuite.suites).toHaveLength(0);
    expect(emptySuite.beforeAll).toHaveLength(0);
    expect(emptySuite.afterAll).toHaveLength(0);
    expect(emptySuite.beforeEach).toHaveLength(0);
    expect(emptySuite.afterEach).toHaveLength(0);
  });
});
