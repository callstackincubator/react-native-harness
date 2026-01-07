import {
  describe,
  it,
  expect,
  afterEach,
  mock,
  unmock,
  requireActual,
  fn,
  resetModules,
} from 'react-native-harness';

describe('Module mocking', () => {
  afterEach(() => {
    resetModules();
  });

  it('should not interfere with modules that are not mocked', () => {
    const moduleA = require('react-native');
    const moduleB = require('react-native');
    expect(moduleA === moduleB).toBe(true);
  });

  it('should completely mock a module and return mock implementation', () => {
    // Create a mock factory for a hypothetical utility module
    const mockUtilsFactory = () => ({
      formatString: fn().mockReturnValue('mocked string'),
      calculateSum: fn().mockImplementation(
        (a: number, b: number) => a + b + 1000
      ),
      constants: {
        VERSION: '999.0.0',
        DEBUG: true,
      },
    });

    mock('react-native', mockUtilsFactory);

    // Require the mocked module
    const mockedModule = require('react-native');

    // Verify the mock implementation is returned
    expect(mockedModule.formatString()).toBe('mocked string');
    expect(mockedModule.calculateSum(5, 10)).toBe(1015);
    expect(mockedModule.constants.VERSION).toBe('999.0.0');
    expect(mockedModule.constants.DEBUG).toBe(true);

    // Verify the mock functions were called
    expect(mockedModule.formatString).toHaveBeenCalledTimes(1);
    expect(mockedModule.calculateSum).toHaveBeenCalledWith(5, 10);
  });

  it('should partially mock react-native, replacing only Platform while keeping other exports', () => {
    const mockFactory = () => {
      // Get the actual react-native module
      const actualRN = requireActual('react-native');

      // Copy without invoking getters to avoid triggering lazy initialization
      const proto = Object.getPrototypeOf(actualRN);
      const descriptors = Object.getOwnPropertyDescriptors(actualRN);

      const mockedRN = Object.create(proto, descriptors);
      const mockedPlatform = {
        OS: 'mockOS',
        Version: 999,
        select: fn().mockImplementation((options: Record<string, any>) => {
          return options.mockOS || options.default;
        }),
        isPad: false,
        isTesting: true,
      };
      Object.defineProperty(mockedRN, 'Platform', {
        get() {
          return mockedPlatform;
        },
      });
      return mockedRN;
    };

    mock('react-native', mockFactory);

    const mockedRN = require('react-native');

    // Verify Platform is mocked
    expect(mockedRN.Platform.OS).toBe('mockOS');
    expect(mockedRN.Platform.Version).toBe(999);
    expect(mockedRN.Platform.isTesting).toBe(true);

    // Test Platform.select mock
    const result = mockedRN.Platform.select({
      ios: 'iOS value',
      android: 'Android value',
      mockOS: 'Mock OS value',
      default: 'Default value',
    });
    expect(result).toBe('Mock OS value');
    expect(mockedRN.Platform.select).toHaveBeenCalledTimes(1);

    // Verify other React Native exports are preserved (actual implementation)
    expect(mockedRN).toHaveProperty('View');
    expect(mockedRN).toHaveProperty('Text');
    expect(mockedRN).toHaveProperty('StyleSheet');
    expect(typeof mockedRN.View).toBe('object');
  });

  it('should unmock a previously mocked module', () => {
    // Mock a module
    const mockFactory = () => ({ mockProperty: 'mocked' });
    mock('react-native', mockFactory);

    // Verify it's mocked
    let module = require('react-native');
    expect(module.mockProperty).toBe('mocked');

    // Unmock it
    unmock('react-native');

    // Verify it's back to actual
    module = require('react-native');
    expect(module).not.toHaveProperty('mockProperty');
    expect(module).toHaveProperty('Platform'); // Should have actual RN properties
  });

  it('should reinitialize module after resetModules', () => {
    // Mock multiple modules (using the same module for simplicity)
    const mockFactory = () => ({ now: Math.random() });

    mock('react-native', mockFactory);

    // Verify mock is active
    const oldNow = require('react-native').now;

    // Reset all modules
    resetModules();

    // Require again, should reinitialize the module
    const newNow = require('react-native').now;
    expect(newNow).not.toBe(oldNow);
  });
});
