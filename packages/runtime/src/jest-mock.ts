// Mock jest global to warn users about using Jest APIs in Harness tests
export const setupJestMock = (): void => {
  function throwError(): never {
    throw new Error(
      `Jest globals are not available in Harness tests. Import from 'react-native-harness' instead (e.g., import { harness } from 'react-native-harness'; harness.fn())`
    );
  }

  const jestMock = new Proxy(
    {},
    {
      get() {
        throwError();
      },
      set() {
        throwError();
      },
      has() {
        throwError();
      },
      ownKeys() {
        throwError();
      },
    }
  );

  Object.defineProperty(globalThis, 'jest', {
    value: jestMock,
    writable: false,
    configurable: false,
  });
};
