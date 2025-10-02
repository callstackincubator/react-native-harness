import {
  describe,
  it,
  expect,
  afterEach,
  fn,
  spyOn,
  clearAllMocks,
} from 'react-native-harness';

afterEach(() => {
  clearAllMocks();
});

describe('fn()', () => {
  it('should create a mock function', () => {
    const mockFn = fn();

    expect(typeof mockFn).toBe('function');
    expect(mockFn.mock).toBeDefined();
  });

  it('should track function calls', () => {
    const mockFn = fn();

    mockFn('arg1', 'arg2');
    mockFn('arg3');

    expect(mockFn).toHaveBeenCalledTimes(2);
    expect(mockFn).toHaveBeenCalledWith('arg1', 'arg2');
    expect(mockFn).toHaveBeenLastCalledWith('arg3');
  });

  it('should support mockReturnValue', () => {
    const mockFn = fn();
    mockFn.mockReturnValue('mocked value');

    expect(mockFn()).toBe('mocked value');
  });

  it('should support mockImplementation', () => {
    const mockFn = fn();
    mockFn.mockImplementation((x: number) => x * 2);

    expect(mockFn(5)).toBe(10);
  });

  it('should clear all mocks', () => {
    const mockFn = fn();
    mockFn('test');

    expect(mockFn).toHaveBeenCalledTimes(1);

    clearAllMocks();

    expect(mockFn).toHaveBeenCalledTimes(0);
  });
});

describe('spyOn()', () => {
  it('should spy on existing method', () => {
    const obj = { method: (x: number) => x * 2 };
    const spy = spyOn(obj, 'method');

    const result = obj.method(5);

    expect(result).toBe(10);
    expect(spy).toHaveBeenCalledWith(5);
  });

  it('should allow mocking spied method', () => {
    const obj = { method: () => 'original' };
    const spy = spyOn(obj, 'method');
    spy.mockReturnValue('mocked');

    expect(obj.method()).toBe('mocked');
  });

  it('should restore original method', () => {
    const obj = { method: () => 'original' };
    const spy = spyOn(obj, 'method');
    spy.mockReturnValue('mocked');

    expect(obj.method()).toBe('mocked');

    spy.mockRestore();

    expect(obj.method()).toBe('original');
  });
});
