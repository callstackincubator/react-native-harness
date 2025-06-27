import { describe, it, expect } from 'vitest';
import * as harnessRuntime from '../rntl/describe.js';

describe('test case recognition', () => {
    it('should collect basic test cases using it()', () => {
        const suite = harnessRuntime.collectTests(() => {
            harnessRuntime.describe('Sample Suite', () => {
                harnessRuntime.it('test 1', () => { });
                harnessRuntime.it('test 2', () => { });
            });
        });

        expect(suite.suites).toHaveLength(1);
        const sampleSuite = suite.suites[0];
        expect(sampleSuite.name).toBe('Sample Suite');
        expect(sampleSuite.tests).toHaveLength(2);
        expect(sampleSuite.tests[0].name).toBe('test 1');
        expect(sampleSuite.tests[1].name).toBe('test 2');
        expect(sampleSuite.tests[0].status).toBe('active');
        expect(sampleSuite.tests[1].status).toBe('active');
    });

    it('should collect basic test cases using test()', () => {
        const suite = harnessRuntime.collectTests(() => {
            harnessRuntime.describe('Sample Suite', () => {
                harnessRuntime.test('test 1', () => { });
                harnessRuntime.test('test 2', () => { });
            });
        });

        expect(suite.suites).toHaveLength(1);
        const sampleSuite = suite.suites[0];
        expect(sampleSuite.tests).toHaveLength(2);
        expect(sampleSuite.tests[0].name).toBe('test 1');
        expect(sampleSuite.tests[1].name).toBe('test 2');
    });

    it('should handle async test functions', () => {
        const suite = harnessRuntime.collectTests(() => {
            harnessRuntime.describe('Async Suite', () => {
                harnessRuntime.it('async test', async () => {
                    await new Promise(resolve => setTimeout(resolve, 10));
                });
            });
        });

        const asyncSuite = suite.suites[0];
        expect(asyncSuite.tests[0].name).toBe('async test');
        expect(typeof asyncSuite.tests[0].fn).toBe('function');
    });

    it('should collect tests at root level', () => {
        const suite = harnessRuntime.collectTests(() => {
            harnessRuntime.it('root test 1', () => { });
            harnessRuntime.test('root test 2', () => { });

            harnessRuntime.describe('Suite with tests', () => {
                harnessRuntime.it('suite test', () => { });
            });
        });

        // Root suite should have the root-level tests
        expect(suite.tests).toHaveLength(2);
        expect(suite.tests[0].name).toBe('root test 1');
        expect(suite.tests[1].name).toBe('root test 2');
        expect(suite.tests[0].status).toBe('active');
        expect(suite.tests[1].status).toBe('active');

        // Should also have the describe suite
        expect(suite.suites).toHaveLength(1);
        expect(suite.suites[0].tests).toHaveLength(1);
        expect(suite.suites[0].tests[0].name).toBe('suite test');
    });

    it('should collect tests with modifiers at root level', () => {
        const suite = harnessRuntime.collectTests(() => {
            harnessRuntime.it('regular root test', () => { });
            harnessRuntime.test.skip('skipped root test', () => { });
            harnessRuntime.it.todo('todo root test');
            harnessRuntime.test.only('focused root test', () => { });
            harnessRuntime.it('another root test', () => { });
        });

        // Root suite should have all the tests with correct statuses
        expect(suite.tests).toHaveLength(5);
        expect(suite.tests[0].name).toBe('regular root test');
        expect(suite.tests[0].status).toBe('skipped'); // Due to .only
        expect(suite.tests[1].name).toBe('skipped root test');
        expect(suite.tests[1].status).toBe('skipped');
        expect(suite.tests[2].name).toBe('todo root test');
        expect(suite.tests[2].status).toBe('todo');
        expect(suite.tests[3].name).toBe('focused root test');
        expect(suite.tests[3].status).toBe('active'); // The .only test
        expect(suite.tests[4].name).toBe('another root test');
        expect(suite.tests[4].status).toBe('skipped'); // Due to .only
    });
});

describe('suite recognition', () => {
    it('should collect nested describe blocks', () => {
        const suite = harnessRuntime.collectTests(() => {
            harnessRuntime.describe('Outer Suite', () => {
                harnessRuntime.describe('Inner Suite 1', () => {
                    harnessRuntime.it('test 1', () => { });
                });
                harnessRuntime.describe('Inner Suite 2', () => {
                    harnessRuntime.it('test 2', () => { });
                });
            });
        });

        expect(suite.suites).toHaveLength(1);
        const outerSuite = suite.suites[0];
        expect(outerSuite.name).toBe('Outer Suite');
        expect(outerSuite.suites).toHaveLength(2);
        expect(outerSuite.suites[0].name).toBe('Inner Suite 1');
        expect(outerSuite.suites[1].name).toBe('Inner Suite 2');
        expect(outerSuite.suites[0].tests[0].name).toBe('test 1');
        expect(outerSuite.suites[1].tests[0].name).toBe('test 2');
    });

    it('should collect multiple top-level describe blocks', () => {
        const suite = harnessRuntime.collectTests(() => {
            harnessRuntime.describe('Suite 1', () => {
                harnessRuntime.it('test 1', () => { });
            });
            harnessRuntime.describe('Suite 2', () => {
                harnessRuntime.it('test 2', () => { });
            });
        });

        expect(suite.suites).toHaveLength(2);
        expect(suite.suites[0].name).toBe('Suite 1');
        expect(suite.suites[1].name).toBe('Suite 2');
    });

    it('should handle deeply nested suites', () => {
        const suite = harnessRuntime.collectTests(() => {
            harnessRuntime.describe('Level 1', () => {
                harnessRuntime.describe('Level 2', () => {
                    harnessRuntime.describe('Level 3', () => {
                        harnessRuntime.it('deep test', () => { });
                    });
                });
            });
        });

        const level1 = suite.suites[0];
        const level2 = level1.suites[0];
        const level3 = level2.suites[0];

        expect(level1.name).toBe('Level 1');
        expect(level2.name).toBe('Level 2');
        expect(level3.name).toBe('Level 3');
        expect(level3.tests[0].name).toBe('deep test');
    });
});

describe('skip modifier recognition', () => {
    it('should mark skipped tests with test.skip()', () => {
        const suite = harnessRuntime.collectTests(() => {
            harnessRuntime.describe('Skip Suite', () => {
                harnessRuntime.it('active test', () => { });
                harnessRuntime.test.skip('skipped test', () => { });
                harnessRuntime.it.skip('another skipped test', () => { });
            });
        });

        const skipSuite = suite.suites[0];
        expect(skipSuite.tests).toHaveLength(3);
        expect(skipSuite.tests[0].status).toBe('active');
        expect(skipSuite.tests[1].status).toBe('skipped');
        expect(skipSuite.tests[2].status).toBe('skipped');
    });

    it('should mark skipped suites with describe.skip()', () => {
        const suite = harnessRuntime.collectTests(() => {
            harnessRuntime.describe('Active Suite', () => {
                harnessRuntime.it('active test', () => { });
            });
            harnessRuntime.describe.skip('Skipped Suite', () => {
                harnessRuntime.it('test in skipped suite', () => { });
            });
        });

        expect(suite.suites).toHaveLength(2);
        expect(suite.suites[0].status).toBe('active');
        expect(suite.suites[1].status).toBe('skipped');
    });

    it('should handle nested skipped suites', () => {
        const suite = harnessRuntime.collectTests(() => {
            harnessRuntime.describe.skip('Outer Skipped', () => {
                harnessRuntime.describe('Inner Suite', () => {
                    harnessRuntime.it('test', () => { });
                });
            });
        });

        const outerSuite = suite.suites[0];
        expect(outerSuite.status).toBe('skipped');
        expect(outerSuite.suites[0].tests[0].name).toBe('test');
    });
});

describe('only modifier recognition', () => {
    it('should mark only tests and skip others with test.only()', () => {
        const suite = harnessRuntime.collectTests(() => {
            harnessRuntime.describe('Only Suite', () => {
                harnessRuntime.it('regular test 1', () => { });
                harnessRuntime.test.only('focused test', () => { });
                harnessRuntime.it('regular test 2', () => { });
            });
        });

        const onlySuite = suite.suites[0];
        expect(onlySuite.tests).toHaveLength(3);
        expect(onlySuite.tests[0].status).toBe('skipped');
        expect(onlySuite.tests[1].status).toBe('active');
        expect(onlySuite.tests[2].status).toBe('skipped');
        expect(onlySuite._hasFocused).toBe(true);
    });

    it('should handle multiple test.only() calls', () => {
        const suite = harnessRuntime.collectTests(() => {
            harnessRuntime.describe('Multiple Only Suite', () => {
                harnessRuntime.it('regular test', () => { });
                harnessRuntime.test.only('focused test 1', () => { });
                harnessRuntime.test.only('focused test 2', () => { });
            });
        });

        const multipleSuite = suite.suites[0];
        expect(multipleSuite.tests[0].status).toBe('skipped');
        expect(multipleSuite.tests[1].status).toBe('skipped'); // First only gets skipped by second
        expect(multipleSuite.tests[2].status).toBe('active');  // Last only stays active
    });

    it('should mark only suites and skip others with describe.only()', () => {
        const suite = harnessRuntime.collectTests(() => {
            harnessRuntime.describe('Regular Suite 1', () => {
                harnessRuntime.it('test 1', () => { });
            });
            harnessRuntime.describe.only('Focused Suite', () => {
                harnessRuntime.it('focused test', () => { });
            });
            harnessRuntime.describe('Regular Suite 2', () => {
                harnessRuntime.it('test 2', () => { });
            });
        });

        expect(suite.suites).toHaveLength(3);
        expect(suite.suites[0].status).toBe('skipped');
        expect(suite.suites[1].status).toBe('active');
        expect(suite.suites[2].status).toBe('skipped');
        expect(suite.suites[1]._hasFocused).toBe(true);
    });

    it('should handle nested describe.only()', () => {
        const suite = harnessRuntime.collectTests(() => {
            harnessRuntime.describe('Outer Suite', () => {
                harnessRuntime.describe('Regular Inner', () => {
                    harnessRuntime.it('test 1', () => { });
                });
                harnessRuntime.describe.only('Focused Inner', () => {
                    harnessRuntime.it('focused test', () => { });
                });
            });
        });

        const outerSuite = suite.suites[0];
        expect(outerSuite.status).toBe('active');
        expect(outerSuite._hasFocused).toBe(true);
        expect(outerSuite.suites[0].status).toBe('skipped');
        expect(outerSuite.suites[1].status).toBe('active');
    });
});

describe('todo test recognition', () => {
    it('should mark todo tests with test.todo()', () => {
        const suite = harnessRuntime.collectTests(() => {
            harnessRuntime.describe('Todo Suite', () => {
                harnessRuntime.it('regular test', () => { });
                harnessRuntime.test.todo('todo test');
                harnessRuntime.it.todo('another todo test');
            });
        });

        const todoSuite = suite.suites[0];
        expect(todoSuite.tests).toHaveLength(3);
        expect(todoSuite.tests[0].status).toBe('active');
        expect(todoSuite.tests[1].status).toBe('todo');
        expect(todoSuite.tests[2].status).toBe('todo');
    });

    it('should handle todo tests without function bodies', () => {
        const suite = harnessRuntime.collectTests(() => {
            harnessRuntime.describe('Todo Suite', () => {
                harnessRuntime.test.todo('implement this feature');
            });
        });

        const todoSuite = suite.suites[0];
        expect(todoSuite.tests[0].name).toBe('implement this feature');
        expect(todoSuite.tests[0].status).toBe('todo');
        expect(typeof todoSuite.tests[0].fn).toBe('function');
    });
});

describe('hook recognition', () => {
    it('should collect beforeAll hooks', () => {
        const suite = harnessRuntime.collectTests(() => {
            harnessRuntime.describe('Hook Suite', () => {
                harnessRuntime.beforeAll(() => {
                    // setup
                });
                harnessRuntime.beforeAll(async () => {
                    // async setup
                });
                harnessRuntime.it('test', () => { });
            });
        });

        const hookSuite = suite.suites[0];
        expect(hookSuite.beforeAll).toHaveLength(2);
        expect(typeof hookSuite.beforeAll[0]).toBe('function');
        expect(typeof hookSuite.beforeAll[1]).toBe('function');
    });

    it('should collect afterAll hooks', () => {
        const suite = harnessRuntime.collectTests(() => {
            harnessRuntime.describe('Hook Suite', () => {
                harnessRuntime.afterAll(() => {
                    // cleanup
                });
                harnessRuntime.it('test', () => { });
            });
        });

        const hookSuite = suite.suites[0];
        expect(hookSuite.afterAll).toHaveLength(1);
        expect(typeof hookSuite.afterAll[0]).toBe('function');
    });

    it('should collect beforeEach hooks', () => {
        const suite = harnessRuntime.collectTests(() => {
            harnessRuntime.describe('Hook Suite', () => {
                harnessRuntime.beforeEach(() => {
                    // setup each
                });
                harnessRuntime.beforeEach(async () => {
                    // async setup each
                });
                harnessRuntime.it('test', () => { });
            });
        });

        const hookSuite = suite.suites[0];
        expect(hookSuite.beforeEach).toHaveLength(2);
        expect(typeof hookSuite.beforeEach[0]).toBe('function');
        expect(typeof hookSuite.beforeEach[1]).toBe('function');
    });

    it('should collect afterEach hooks', () => {
        const suite = harnessRuntime.collectTests(() => {
            harnessRuntime.describe('Hook Suite', () => {
                harnessRuntime.afterEach(() => {
                    // cleanup each
                });
                harnessRuntime.it('test', () => { });
            });
        });

        const hookSuite = suite.suites[0];
        expect(hookSuite.afterEach).toHaveLength(1);
        expect(typeof hookSuite.afterEach[0]).toBe('function');
    });

    it('should collect all types of hooks together', () => {
        const suite = harnessRuntime.collectTests(() => {
            harnessRuntime.describe('All Hooks Suite', () => {
                harnessRuntime.beforeAll(() => { });
                harnessRuntime.afterAll(() => { });
                harnessRuntime.beforeEach(() => { });
                harnessRuntime.afterEach(() => { });
                harnessRuntime.it('test', () => { });
            });
        });

        const allHooksSuite = suite.suites[0];
        expect(allHooksSuite.beforeAll).toHaveLength(1);
        expect(allHooksSuite.afterAll).toHaveLength(1);
        expect(allHooksSuite.beforeEach).toHaveLength(1);
        expect(allHooksSuite.afterEach).toHaveLength(1);
    });

    it('should collect hooks at root level', () => {
        const suite = harnessRuntime.collectTests(() => {
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
                harnessRuntime.it('test', () => { });
            });
        });

        // Root suite should have the hooks
        expect(suite.beforeAll).toHaveLength(1);
        expect(suite.afterAll).toHaveLength(1);
        expect(suite.beforeEach).toHaveLength(1);
        expect(suite.afterEach).toHaveLength(1);
        expect(typeof suite.beforeAll[0]).toBe('function');
        expect(typeof suite.afterAll[0]).toBe('function');
        expect(typeof suite.beforeEach[0]).toBe('function');
        expect(typeof suite.afterEach[0]).toBe('function');
    });

    it('should collect hooks at both root and suite levels', () => {
        const suite = harnessRuntime.collectTests(() => {
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
                harnessRuntime.it('test', () => { });
            });
        });

        // Root suite should have its hooks
        expect(suite.beforeAll).toHaveLength(1);
        expect(suite.beforeEach).toHaveLength(1);

        // Child suite should have its own hooks
        const childSuite = suite.suites[0];
        expect(childSuite.beforeAll).toHaveLength(1);
        expect(childSuite.beforeEach).toHaveLength(1);
    });
});

describe('complex scenarios', () => {
    it('should handle mix of tests, suites, hooks, and modifiers', () => {
        const suite = harnessRuntime.collectTests(() => {
            harnessRuntime.describe('Complex Suite', () => {
                harnessRuntime.beforeAll(() => { });
                harnessRuntime.beforeEach(() => { });

                harnessRuntime.it('regular test', () => { });
                harnessRuntime.test.skip('skipped test', () => { });
                harnessRuntime.test.todo('todo test');

                harnessRuntime.describe.skip('Skipped Inner Suite', () => {
                    harnessRuntime.it('inner test', () => { });
                });

                harnessRuntime.describe('Regular Inner Suite', () => {
                    harnessRuntime.beforeEach(() => { });
                    harnessRuntime.it('inner test 1', () => { });
                    harnessRuntime.test.only('focused inner test', () => { });
                    harnessRuntime.it('inner test 2', () => { });
                    harnessRuntime.afterEach(() => { });
                });

                harnessRuntime.afterAll(() => { });
            });
        });

        const complexSuite = suite.suites[0];

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
        expect(innerSuite.tests[1].status).toBe('active');  // The .only test
        expect(innerSuite.tests[2].status).toBe('skipped'); // Due to .only
    });

    it('should clear state between collectTests calls', () => {
        const suite1 = harnessRuntime.collectTests(() => {
            harnessRuntime.describe('Suite 1', () => {
                harnessRuntime.it('test 1', () => { });
            });
        });

        const suite2 = harnessRuntime.collectTests(() => {
            harnessRuntime.describe('Suite 2', () => {
                harnessRuntime.it('test 2', () => { });
            });
        });

        expect(suite1.suites).toHaveLength(1);
        expect(suite2.suites).toHaveLength(1);
        expect(suite1.suites[0].name).toBe('Suite 1');
        expect(suite2.suites[0].name).toBe('Suite 2');
    });

    it('should handle empty describe blocks', () => {
        const suite = harnessRuntime.collectTests(() => {
            harnessRuntime.describe('Empty Suite', () => {
                // No tests or hooks
            });
        });

        const emptySuite = suite.suites[0];
        expect(emptySuite.name).toBe('Empty Suite');
        expect(emptySuite.tests).toHaveLength(0);
        expect(emptySuite.suites).toHaveLength(0);
        expect(emptySuite.beforeAll).toHaveLength(0);
        expect(emptySuite.afterAll).toHaveLength(0);
        expect(emptySuite.beforeEach).toHaveLength(0);
        expect(emptySuite.afterEach).toHaveLength(0);
    });
});