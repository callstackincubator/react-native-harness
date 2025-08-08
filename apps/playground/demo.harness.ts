import {
  describe,
  it,
  test,
  mock,
  requireActual,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  clearMocks,
} from '@react-native-harness/runtime';

// Demo: React Native Harness Features Showcase
// This test demonstrates all the features implemented in React Native Harness

afterEach(() => {
  clearMocks();
});

describe('React Native Harness Features Demo', () => {
  // Feature 1: Test lifecycle hooks
  beforeAll(() => {
    console.log('🚀 Demo suite starting - beforeAll hook');
  });

  afterAll(() => {
    console.log('✅ Demo suite completed - afterAll hook');
  });

  beforeEach(() => {
    console.log('📝 Before each test - beforeEach hook');
  });

  afterEach(() => {
    console.log('🧹 After each test - afterEach hook');
  });

  // Feature 2: Basic test functionality
  describe('Basic Test Features', () => {
    it('should run normal tests', () => {
      expect(1 + 1).to.equal(2);
      expect('hello').to.equal('hello');
      expect([1, 2, 3]).to.have.length(3);
    });

    it('should handle async tests', async () => {
      const result = await Promise.resolve('async result');
      expect(result).to.equal('async result');
    });

    it('should handle promises', () => {
      return Promise.resolve(42).then((value) => {
        expect(value).to.equal(42);
      });
    });
  });

  // Feature 3: Skip functionality
  describe('Skip Feature', () => {
    it('should run this test', () => {
      expect(true).to.equal(true);
    });

    it.skip('should be skipped', () => {
      // This test will be skipped
      expect(false).to.equal(true); // This won't run
    });

    test.skip('another skipped test', () => {
      // This test will also be skipped
      expect('skipped').to.equal('skipped');
    });
  });

  // Feature 4: Only functionality
  describe('Only Feature', () => {
    it('should be skipped when another test is marked as only', () => {
      expect('this should be skipped').to.equal('this should be skipped');
    });

    it.only('should be the only test running in this suite', () => {
      expect('only this runs').to.equal('only this runs');
    });

    it('should also be skipped', () => {
      expect('skipped too').to.equal('skipped too');
    });
  });

  // Feature 5: Todo functionality
  describe('Todo Feature', () => {
    it('should run normal test', () => {
      expect('normal test').to.equal('normal test');
    });

    it.todo('should be marked as todo');
    it.todo('another todo test');
    test.todo('yet another todo test');
  });

  // Feature 6: Nested describe blocks with skip/only
  describe('Nested Describe Features', () => {
    describe('normal nested suite', () => {
      it('should run', () => {
        expect('nested test').to.equal('nested test');
      });
    });

    describe.skip('skipped nested suite', () => {
      it('should not run', () => {
        expect('skipped').to.equal('skipped');
      });
    });

    describe.only('only nested suite', () => {
      it('should run', () => {
        expect('only nested test').to.equal('only nested test');
      });

      it('should also run', () => {
        expect('another only nested test').to.equal('another only nested test');
      });
    });
  });

  // Feature 7: Module Mocking
  describe('Module Mocking Feature', () => {
    beforeEach(() => {
      // Create a mock module factory
      const mockModuleFactory = () => ({
        name: 'mocked-module',
        version: '1.0.0',
        getData: () => 'mocked data',
        calculate: (a: number, b: number) => a + b + 100, // Mocked calculation
      });

      // Mock the module using require.resolveWeak
      // @ts-expect-error - require.resolveWeak is available in React Native environment
      const moduleId = require.resolveWeak('react-native');
      mock(moduleId, mockModuleFactory);
    });

    it('should mock a module and return mocked version via require', () => {
      // Now require the same module - should return mocked version
      const mockedModule = require('react-native');

      expect(mockedModule.name).to.equal('mocked-module');
      expect(mockedModule.version).to.equal('1.0.0');
      expect(mockedModule.getData()).to.equal('mocked data');
      expect(mockedModule.calculate(5, 3)).to.equal(108); // 5 + 3 + 100
    });

    it('should return original module via requireActual', () => {
      // Use requireActual with require.resolveWeak to get the original module
      // @ts-expect-error - require.resolveWeak is available in React Native environment
      const moduleId = require.resolveWeak('react-native');
      const originalModule = requireActual(moduleId);

      // The original module should have the real React Native exports
      expect(typeof originalModule).to.equal('object');
      expect(originalModule).to.have.property('Platform');
      expect(originalModule).to.have.property('View');
      expect(originalModule).to.have.property('Text');
    });

    it('should demonstrate the difference between mocked and original', () => {
      // @ts-expect-error - require.resolveWeak is available in React Native environment
      const moduleId = require.resolveWeak('react-native');

      // First, get the original module
      const originalModule = requireActual(moduleId);

      // Create a mock that changes the Platform.OS
      const mockModuleFactory = () => ({
        ...originalModule,
        Platform: {
          ...originalModule.Platform,
          OS: 'mocked-platform',
          Version: '999.0.0',
        },
      });

      // Apply the mock
      mock(moduleId, mockModuleFactory);

      // Now require the module - should return mocked version
      const mockedModule = require('react-native');

      // Check that the mock changed the Platform.OS
      expect(mockedModule.Platform.OS).to.equal('mocked-platform');
      expect(mockedModule.Platform.Version).to.equal('999.0.0');

      // But requireActual should still return original
      const actualModule = requireActual(moduleId);
      expect(actualModule.Platform.OS).to.not.equal('mocked-platform');
    });

    it('should mock specific functions while keeping others original', () => {
      // @ts-expect-error - require.resolveWeak is available in React Native environment
      const moduleId = require.resolveWeak('react-native');
      const originalModule = requireActual(moduleId);

      // Create a mock that only changes specific functions
      const mockModuleFactory = () => ({
        ...originalModule,
        Alert: {
          ...originalModule.Alert,
          alert: (title: string, message?: string) => {
            return `MOCKED ALERT: ${title} - ${message || 'No message'}`;
          },
        },
      });

      // Apply the mock
      mock(moduleId, mockModuleFactory);

      // Test the mocked function
      const mockedModule = require('react-native');
      const alertResult = mockedModule.Alert.alert(
        'Test Title',
        'Test Message'
      );
      expect(alertResult).to.equal('MOCKED ALERT: Test Title - Test Message');

      // But other properties should remain original
      expect(mockedModule.Platform).to.deep.equal(originalModule.Platform);
    });

    it('should clear mocks and restore original behavior', () => {
      // @ts-expect-error - require.resolveWeak is available in React Native environment
      const moduleId = require.resolveWeak('react-native');

      // Apply a mock
      const mockModuleFactory = () => ({
        name: 'temporary-mock',
        version: '0.0.0',
      });

      mock(moduleId, mockModuleFactory);

      // Verify mock is active
      const mockedModule = require('react-native');
      expect(mockedModule.name).to.equal('temporary-mock');

      // Clear the mock
      clearMocks();

      const actualModule = require('react-native');
      expect(actualModule).to.not.have.property('name');
      expect(actualModule).to.have.property('Platform');
    });
  });

  // Feature 8: Complex test scenarios
  describe('Complex Test Scenarios', () => {
    describe('with multiple nested levels', () => {
      describe('and more nesting', () => {
        it('should handle deep nesting', () => {
          expect('deeply nested').to.equal('deeply nested');
        });

        it.skip('should skip in deep nesting', () => {
          expect('skipped').to.equal('skipped');
        });
      });
    });

    describe('with mixed skip/only/todo', () => {
      it('normal test', () => {
        expect('normal').to.equal('normal');
      });

      it.skip('skipped test', () => {
        expect('skipped').to.equal('skipped');
      });

      it.only('only test', () => {
        expect('only').to.equal('only');
      });

      it.todo('todo test');
    });
  });

  // Feature 9: Error handling
  describe('Error Handling', () => {
    it('should handle test failures', () => {
      // This test will fail
      expect(1).to.equal(2);
    });

    it('should handle async errors', async () => {
      try {
        await Promise.reject(new Error('Async error'));
        expect(true).to.equal(false); // Should not reach here
      } catch (error) {
        expect(error.message).to.equal('Async error');
      }
    });

    it('should handle thrown errors', () => {
      try {
        throw new Error('Thrown error');
      } catch (error) {
        expect(error.message).to.equal('Thrown error');
      }
    });
  });
});

// Additional demo: Testing with different test patterns
describe('Alternative Test Patterns', () => {
  test('using test() instead of it()', () => {
    expect('test function').to.equal('test function');
  });

  test.skip('skipped with test()', () => {
    expect('skipped').to.equal('skipped');
  });

  test.only('only with test()', () => {
    expect('only test').to.equal('only test');
  });

  test.todo('todo with test()');
});
