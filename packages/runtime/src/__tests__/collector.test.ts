import { describe, it, expect } from 'vitest';
import * as collectorFunctions from '../collector/functions.js';

const noop = () => {
  // Noop
};

describe('test collector - test case recognition', () => {
  it('should collect basic test cases using it()', async () => {
    const collectedSuite = await collectorFunctions.collectTests(() => {
      collectorFunctions.describe('Sample Suite', () => {
        collectorFunctions.it('test 1', noop);
        collectorFunctions.it('test 2', noop);
      });
    });

    expect(collectedSuite.testSuite.suites).toHaveLength(1);
    const sampleSuite = collectedSuite.testSuite.suites[0];
    expect(sampleSuite.name).toBe('Sample Suite');
    expect(sampleSuite.tests).toHaveLength(2);
    expect(sampleSuite.tests[0].name).toBe('test 1');
    expect(sampleSuite.tests[1].name).toBe('test 2');
    expect(sampleSuite.tests[0].status).toBe('active');
    expect(sampleSuite.tests[1].status).toBe('active');
  });

  it('should collect basic test cases using test()', async () => {
    const collectedSuite = await collectorFunctions.collectTests(() => {
      collectorFunctions.describe('Sample Suite', () => {
        collectorFunctions.test('test 1', noop);
        collectorFunctions.test('test 2', noop);
      });
    });

    expect(collectedSuite.testSuite.suites).toHaveLength(1);
    const sampleSuite = collectedSuite.testSuite.suites[0];
    expect(sampleSuite.tests).toHaveLength(2);
    expect(sampleSuite.tests[0].name).toBe('test 1');
    expect(sampleSuite.tests[1].name).toBe('test 2');
  });

  it('should collect async test functions', async () => {
    const collectedSuite = await collectorFunctions.collectTests(() => {
      collectorFunctions.describe('Async Suite', () => {
        collectorFunctions.it('async test', async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
        });
      });
    });

    const asyncSuite = collectedSuite.testSuite.suites[0];
    expect(asyncSuite.tests[0].name).toBe('async test');
    expect(typeof asyncSuite.tests[0].fn).toBe('function');
  });

  it('should collect tests at root level', async () => {
    const collectedSuite = await collectorFunctions.collectTests(() => {
      collectorFunctions.it('root test 1', noop);
      collectorFunctions.test('root test 2', noop);

      collectorFunctions.describe('Suite with tests', () => {
        collectorFunctions.it('suite test', noop);
      });
    });

    // Collected root suite should have the root-level tests
    expect(collectedSuite.testSuite.tests).toHaveLength(2);
    expect(collectedSuite.testSuite.tests[0].name).toBe('root test 1');
    expect(collectedSuite.testSuite.tests[1].name).toBe('root test 2');
    expect(collectedSuite.testSuite.tests[0].status).toBe('active');
    expect(collectedSuite.testSuite.tests[1].status).toBe('active');

    // Should also have the describe suite
    expect(collectedSuite.testSuite.suites).toHaveLength(1);
    expect(collectedSuite.testSuite.suites[0].tests).toHaveLength(1);
    expect(collectedSuite.testSuite.suites[0].tests[0].name).toBe('suite test');
  });

  it('should collect tests with modifiers at root level', async () => {
    const collectedSuite = await collectorFunctions.collectTests(() => {
      collectorFunctions.it('regular root test', noop);
      collectorFunctions.test.skip('skipped root test', noop);
      collectorFunctions.it.todo('todo root test');
      collectorFunctions.test.only('focused root test', noop);
      collectorFunctions.it('another root test', noop);
    });

    // Collected root suite should have all the tests with correct statuses
    expect(collectedSuite.testSuite.tests).toHaveLength(5);
    expect(collectedSuite.testSuite.tests[0].name).toBe('regular root test');
    expect(collectedSuite.testSuite.tests[0].status).toBe('skipped'); // Due to .only
    expect(collectedSuite.testSuite.tests[1].name).toBe('skipped root test');
    expect(collectedSuite.testSuite.tests[1].status).toBe('skipped');
    expect(collectedSuite.testSuite.tests[2].name).toBe('todo root test');
    expect(collectedSuite.testSuite.tests[2].status).toBe('todo');
    expect(collectedSuite.testSuite.tests[3].name).toBe('focused root test');
    expect(collectedSuite.testSuite.tests[3].status).toBe('active'); // The .only test
    expect(collectedSuite.testSuite.tests[4].name).toBe('another root test');
    expect(collectedSuite.testSuite.tests[4].status).toBe('skipped'); // Due to .only
  });
});

describe('test collector - suite recognition', () => {
  it('should collect nested describe blocks', async () => {
    const collectedSuite = await collectorFunctions.collectTests(() => {
      collectorFunctions.describe('Outer Suite', () => {
        collectorFunctions.describe('Inner Suite 1', () => {
          collectorFunctions.it('test 1', noop);
        });
        collectorFunctions.describe('Inner Suite 2', () => {
          collectorFunctions.it('test 2', noop);
        });
      });
    });

    expect(collectedSuite.testSuite.suites).toHaveLength(1);
    const outerSuite = collectedSuite.testSuite.suites[0];
    expect(outerSuite.name).toBe('Outer Suite');
    expect(outerSuite.suites).toHaveLength(2);
    expect(outerSuite.suites[0].name).toBe('Inner Suite 1');
    expect(outerSuite.suites[1].name).toBe('Inner Suite 2');
    expect(outerSuite.suites[0].tests[0].name).toBe('test 1');
    expect(outerSuite.suites[1].tests[0].name).toBe('test 2');
  });

  it('should collect multiple top-level describe blocks', async () => {
    const collectedSuite = await collectorFunctions.collectTests(() => {
      collectorFunctions.describe('Suite 1', () => {
        collectorFunctions.it('test 1', noop);
      });
      collectorFunctions.describe('Suite 2', () => {
        collectorFunctions.it('test 2', noop);
      });
    });

    expect(collectedSuite.testSuite.suites).toHaveLength(2);
    expect(collectedSuite.testSuite.suites[0].name).toBe('Suite 1');
    expect(collectedSuite.testSuite.suites[1].name).toBe('Suite 2');
  });

  it('should collect deeply nested suites', async () => {
    const collectedSuite = await collectorFunctions.collectTests(() => {
      collectorFunctions.describe('Level 1', () => {
        collectorFunctions.describe('Level 2', () => {
          collectorFunctions.describe('Level 3', () => {
            collectorFunctions.it('deep test', noop);
          });
        });
      });
    });

    const level1 = collectedSuite.testSuite.suites[0];
    const level2 = level1.suites[0];
    const level3 = level2.suites[0];

    expect(level1.name).toBe('Level 1');
    expect(level2.name).toBe('Level 2');
    expect(level3.name).toBe('Level 3');
    expect(level3.tests[0].name).toBe('deep test');
  });
});

describe('test collector - skip modifier recognition', () => {
  it('should collect and mark skipped tests with test.skip()', async () => {
    const collectedSuite = await collectorFunctions.collectTests(() => {
      collectorFunctions.describe('Skip Suite', () => {
        collectorFunctions.it('active test', noop);
        collectorFunctions.test.skip('skipped test', noop);
        collectorFunctions.it.skip('another skipped test', noop);
      });
    });

    const skipSuite = collectedSuite.testSuite.suites[0];
    expect(skipSuite.tests).toHaveLength(3);
    expect(skipSuite.tests[0].status).toBe('active');
    expect(skipSuite.tests[1].status).toBe('skipped');
    expect(skipSuite.tests[2].status).toBe('skipped');
  });

  it('should collect and mark skipped suites with describe.skip()', async () => {
    const collectedSuite = await collectorFunctions.collectTests(() => {
      collectorFunctions.describe('Active Suite', () => {
        collectorFunctions.it('active test', noop);
      });
      collectorFunctions.describe.skip('Skipped Suite', () => {
        collectorFunctions.it('test in skipped suite', noop);
      });
    });

    expect(collectedSuite.testSuite.suites).toHaveLength(2);
    expect(collectedSuite.testSuite.suites[0].status).toBe('active');
    expect(collectedSuite.testSuite.suites[1].status).toBe('skipped');
  });

  it('should collect nested skipped suites', async () => {
    const collectedSuite = await collectorFunctions.collectTests(() => {
      collectorFunctions.describe.skip('Outer Skipped', () => {
        collectorFunctions.describe('Inner Suite', () => {
          collectorFunctions.it('test', noop);
        });
      });
    });

    const outerSuite = collectedSuite.testSuite.suites[0];
    expect(outerSuite.status).toBe('skipped');
    expect(outerSuite.suites[0].tests[0].name).toBe('test');
  });
});

describe('test collector - only modifier recognition', () => {
  it('should collect and mark only tests and skip others with test.only()', async () => {
    const collectedSuite = await collectorFunctions.collectTests(() => {
      collectorFunctions.describe('Only Suite', () => {
        collectorFunctions.it('regular test 1', noop);
        collectorFunctions.test.only('focused test', noop);
        collectorFunctions.it('regular test 2', noop);
      });
    });

    const onlySuite = collectedSuite.testSuite.suites[0];
    expect(onlySuite.tests).toHaveLength(3);
    expect(onlySuite.tests[0].status).toBe('skipped');
    expect(onlySuite.tests[1].status).toBe('active');
    expect(onlySuite.tests[2].status).toBe('skipped');
    expect(onlySuite._hasFocused).toBe(true);
  });

  it('should collect multiple test.only() calls', async () => {
    const collectedSuite = await collectorFunctions.collectTests(() => {
      collectorFunctions.describe('Multiple Only Suite', () => {
        collectorFunctions.it('regular test', noop);
        collectorFunctions.test.only('focused test 1', noop);
        collectorFunctions.test.only('focused test 2', noop);
      });
    });

    const multipleSuite = collectedSuite.testSuite.suites[0];
    expect(multipleSuite.tests[0].status).toBe('skipped');
    expect(multipleSuite.tests[1].status).toBe('active'); // First only stays active
    expect(multipleSuite.tests[2].status).toBe('active'); // Second only also active
  });

  it('should collect and mark only suites and skip others with describe.only()', async () => {
    const collectedSuite = await collectorFunctions.collectTests(() => {
      collectorFunctions.describe('Regular Suite 1', () => {
        collectorFunctions.it('test 1', noop);
      });
      collectorFunctions.describe.only('Focused Suite', () => {
        collectorFunctions.it('focused test', noop);
      });
      collectorFunctions.describe('Regular Suite 2', () => {
        collectorFunctions.it('test 2', noop);
      });
    });

    expect(collectedSuite.testSuite.suites).toHaveLength(3);
    expect(collectedSuite.testSuite.suites[0].status).toBe('skipped');
    expect(collectedSuite.testSuite.suites[1].status).toBe('active');
    expect(collectedSuite.testSuite.suites[2].status).toBe('skipped');
    expect(collectedSuite.testSuite.suites[1]._hasFocused).toBe(true);
  });

  it('should collect nested describe.only()', async () => {
    const collectedSuite = await collectorFunctions.collectTests(() => {
      collectorFunctions.describe('Outer Suite', () => {
        collectorFunctions.describe('Regular Inner', () => {
          collectorFunctions.it('test 1', noop);
        });
        collectorFunctions.describe.only('Focused Inner', () => {
          collectorFunctions.it('focused test', noop);
        });
      });
    });

    const outerSuite = collectedSuite.testSuite.suites[0];
    expect(outerSuite.status).toBe('active');
    expect(outerSuite._hasFocused).toBe(true);
    expect(outerSuite.suites[0].status).toBe('skipped');
    expect(outerSuite.suites[1].status).toBe('active');
  });
});

describe('test collector - todo test recognition', () => {
  it('should collect and mark todo tests with test.todo()', async () => {
    const collectedSuite = await collectorFunctions.collectTests(() => {
      collectorFunctions.describe('Todo Suite', () => {
        collectorFunctions.it('regular test', noop);
        collectorFunctions.test.todo('todo test');
        collectorFunctions.it.todo('another todo test');
      });
    });

    const todoSuite = collectedSuite.testSuite.suites[0];
    expect(todoSuite.tests).toHaveLength(3);
    expect(todoSuite.tests[0].status).toBe('active');
    expect(todoSuite.tests[1].status).toBe('todo');
    expect(todoSuite.tests[2].status).toBe('todo');
  });

  it('should collect todo tests without function bodies', async () => {
    const collectedSuite = await collectorFunctions.collectTests(() => {
      collectorFunctions.describe('Todo Suite', () => {
        collectorFunctions.test.todo('implement this feature');
      });
    });

    const todoSuite = collectedSuite.testSuite.suites[0];
    expect(todoSuite.tests[0].name).toBe('implement this feature');
    expect(todoSuite.tests[0].status).toBe('todo');
    expect(typeof todoSuite.tests[0].fn).toBe('function');
  });
});

describe('test collector - hook recognition', () => {
  it('should collect beforeAll hooks', async () => {
    const collectedSuite = await collectorFunctions.collectTests(() => {
      collectorFunctions.describe('Hook Suite', () => {
        collectorFunctions.beforeAll(() => {
          // setup
        });
        collectorFunctions.beforeAll(async () => {
          // async setup
        });
        collectorFunctions.it('test', noop);
      });
    });

    const hookSuite = collectedSuite.testSuite.suites[0];
    expect(hookSuite.beforeAll).toHaveLength(2);
    expect(typeof hookSuite.beforeAll[0]).toBe('function');
    expect(typeof hookSuite.beforeAll[1]).toBe('function');
  });

  it('should collect afterAll hooks', async () => {
    const collectedSuite = await collectorFunctions.collectTests(() => {
      collectorFunctions.describe('Hook Suite', () => {
        collectorFunctions.afterAll(() => {
          // cleanup
        });
        collectorFunctions.it('test', noop);
      });
    });

    const hookSuite = collectedSuite.testSuite.suites[0];
    expect(hookSuite.afterAll).toHaveLength(1);
    expect(typeof hookSuite.afterAll[0]).toBe('function');
  });

  it('should collect beforeEach hooks', async () => {
    const collectedSuite = await collectorFunctions.collectTests(() => {
      collectorFunctions.describe('Hook Suite', () => {
        collectorFunctions.beforeEach(() => {
          // setup each
        });
        collectorFunctions.beforeEach(async () => {
          // async setup each
        });
        collectorFunctions.it('test', noop);
      });
    });

    const hookSuite = collectedSuite.testSuite.suites[0];
    expect(hookSuite.beforeEach).toHaveLength(2);
    expect(typeof hookSuite.beforeEach[0]).toBe('function');
    expect(typeof hookSuite.beforeEach[1]).toBe('function');
  });

  it('should collect afterEach hooks', async () => {
    const collectedSuite = await collectorFunctions.collectTests(() => {
      collectorFunctions.describe('Hook Suite', () => {
        collectorFunctions.afterEach(() => {
          // cleanup each
        });
        collectorFunctions.it('test', noop);
      });
    });

    const hookSuite = collectedSuite.testSuite.suites[0];
    expect(hookSuite.afterEach).toHaveLength(1);
    expect(typeof hookSuite.afterEach[0]).toBe('function');
  });

  it('should collect all types of hooks together', async () => {
    const collectedSuite = await collectorFunctions.collectTests(() => {
      collectorFunctions.describe('All Hooks Suite', () => {
        collectorFunctions.beforeAll(noop);
        collectorFunctions.afterAll(noop);
        collectorFunctions.beforeEach(noop);
        collectorFunctions.afterEach(noop);
        collectorFunctions.it('test', noop);
      });
    });

    const allHooksSuite = collectedSuite.testSuite.suites[0];
    expect(allHooksSuite.beforeAll).toHaveLength(1);
    expect(allHooksSuite.afterAll).toHaveLength(1);
    expect(allHooksSuite.beforeEach).toHaveLength(1);
    expect(allHooksSuite.afterEach).toHaveLength(1);
  });

  it('should collect hooks at root level', async () => {
    const collectedSuite = await collectorFunctions.collectTests(() => {
      collectorFunctions.beforeAll(() => {
        // root level setup
      });
      collectorFunctions.afterAll(() => {
        // root level cleanup
      });
      collectorFunctions.beforeEach(() => {
        // root level setup each
      });
      collectorFunctions.afterEach(() => {
        // root level cleanup each
      });

      collectorFunctions.describe('Test Suite', () => {
        collectorFunctions.it('test', noop);
      });
    });

    // Collected root suite should have the hooks
    expect(collectedSuite.testSuite.beforeAll).toHaveLength(1);
    expect(collectedSuite.testSuite.afterAll).toHaveLength(1);
    expect(collectedSuite.testSuite.beforeEach).toHaveLength(1);
    expect(collectedSuite.testSuite.afterEach).toHaveLength(1);
    expect(typeof collectedSuite.testSuite.beforeAll[0]).toBe('function');
    expect(typeof collectedSuite.testSuite.afterAll[0]).toBe('function');
    expect(typeof collectedSuite.testSuite.beforeEach[0]).toBe('function');
    expect(typeof collectedSuite.testSuite.afterEach[0]).toBe('function');
  });

  it('should collect hooks at both root and suite levels', async () => {
    const collectedSuite = await collectorFunctions.collectTests(() => {
      // Root level hooks
      collectorFunctions.beforeAll(() => {
        // global setup
      });
      collectorFunctions.beforeEach(() => {
        // global setup each
      });

      collectorFunctions.describe('Suite with hooks', () => {
        // Suite level hooks
        collectorFunctions.beforeAll(() => {
          // suite setup
        });
        collectorFunctions.beforeEach(() => {
          // suite setup each
        });
        collectorFunctions.it('test', noop);
      });
    });

    // Collected root suite should have its hooks
    expect(collectedSuite.testSuite.beforeAll).toHaveLength(1);
    expect(collectedSuite.testSuite.beforeEach).toHaveLength(1);

    // Child suite should have its own hooks
    const childSuite = collectedSuite.testSuite.suites[0];
    expect(childSuite.beforeAll).toHaveLength(1);
    expect(childSuite.beforeEach).toHaveLength(1);
  });
});

describe('test collector - complex scenarios', () => {
  it('should collect mix of tests, suites, hooks, and modifiers', async () => {
    const collectedSuite = await collectorFunctions.collectTests(() => {
      collectorFunctions.describe('Complex Suite', () => {
        collectorFunctions.beforeAll(noop);
        collectorFunctions.beforeEach(noop);

        collectorFunctions.it('regular test', noop);
        collectorFunctions.test.skip('skipped test', noop);
        collectorFunctions.test.todo('todo test');

        collectorFunctions.describe.skip('Skipped Inner Suite', () => {
          collectorFunctions.it('inner test', noop);
        });

        collectorFunctions.describe('Regular Inner Suite', () => {
          collectorFunctions.beforeEach(noop);
          collectorFunctions.it('inner test 1', noop);
          collectorFunctions.test.only('focused inner test', noop);
          collectorFunctions.it('inner test 2', noop);
          collectorFunctions.afterEach(noop);
        });

        collectorFunctions.afterAll(noop);
      });
    });

    const complexSuite = collectedSuite.testSuite.suites[0];

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

  it('should clear collector state between collectTests calls', async () => {
    const collectedSuite1 = await collectorFunctions.collectTests(() => {
      collectorFunctions.describe('Suite 1', () => {
        collectorFunctions.it('test 1', noop);
      });
    });

    const collectedSuite2 = await collectorFunctions.collectTests(() => {
      collectorFunctions.describe('Suite 2', () => {
        collectorFunctions.it('test 2', noop);
      });
    });

    expect(collectedSuite1.testSuite.suites).toHaveLength(1);
    expect(collectedSuite2.testSuite.suites).toHaveLength(1);
    expect(collectedSuite1.testSuite.suites[0].name).toBe('Suite 1');
    expect(collectedSuite2.testSuite.suites[0].name).toBe('Suite 2');
  });

  it('should collect empty describe blocks', async () => {
    const collectedSuite = await collectorFunctions.collectTests(() => {
      collectorFunctions.describe('Empty Suite', () => {
        // No tests or hooks
      });
    });

    const emptySuite = collectedSuite.testSuite.suites[0];
    expect(emptySuite.name).toBe('Empty Suite');
    expect(emptySuite.tests).toHaveLength(0);
    expect(emptySuite.suites).toHaveLength(0);
    expect(emptySuite.beforeAll).toHaveLength(0);
    expect(emptySuite.afterAll).toHaveLength(0);
    expect(emptySuite.beforeEach).toHaveLength(0);
    expect(emptySuite.afterEach).toHaveLength(0);
  });
});
