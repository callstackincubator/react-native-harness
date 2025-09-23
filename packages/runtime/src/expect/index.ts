import type { Assertion, ExpectStatic, MatcherState } from '@vitest/expect';
import {
  addCustomEqualityTesters,
  ASYMMETRIC_MATCHERS_OBJECT,
  customMatchers,
  getState,
  GLOBAL_EXPECT,
  setState,
} from '@vitest/expect';
import * as chai from 'chai';

// Setup additional matchers
import './setup.js';

export function createExpect(): ExpectStatic {
  const expect = ((value: any, message?: string): Assertion => {
    const { assertionCalls } = getState(expect);
    setState({ assertionCalls: assertionCalls + 1 }, expect);
    return chai.expect(value, message) as unknown as Assertion;
  }) as ExpectStatic;
  Object.assign(expect, chai.expect);
  Object.assign(expect, (globalThis as any)[ASYMMETRIC_MATCHERS_OBJECT]);

  expect.getState = () => getState<MatcherState>(expect);
  expect.setState = (state) => setState(state as Partial<MatcherState>, expect);

  // @ts-expect-error global is not typed
  const globalState = getState(globalThis[GLOBAL_EXPECT]) || {};

  setState<MatcherState>(
    {
      // this should also add "snapshotState" that is added conditionally
      ...globalState,
      assertionCalls: 0,
      isExpectingAssertions: false,
      isExpectingAssertionsError: null,
      expectedAssertionsNumber: null,
      expectedAssertionsNumberErrorGen: null,
    },
    expect
  );

  // @ts-expect-error untyped
  expect.extend = (matchers) => chai.expect.extend(expect, matchers);
  // @ts-expect-error untyped
  expect.addEqualityTesters = (customTesters) =>
    addCustomEqualityTesters(customTesters);

  // @ts-expect-error untyped
  expect.soft = (...args) => {
    // @ts-expect-error private soft access
    return expect(...args).withContext({ soft: true }) as Assertion;
  };

  // @ts-expect-error untyped
  expect.unreachable = (message?: string) => {
    chai.assert.fail(
      `expected${message ? ` "${message}" ` : ' '}not to be reached`
    );
  };

  function assertions(expected: number) {
    const errorGen = () =>
      new Error(
        `expected number of assertions to be ${expected}, but got ${
          expect.getState().assertionCalls
        }`
      );
    if (Error.captureStackTrace) {
      Error.captureStackTrace(errorGen(), assertions);
    }

    expect.setState({
      expectedAssertionsNumber: expected,
      expectedAssertionsNumberErrorGen: errorGen,
    });
  }

  function hasAssertions() {
    const error = new Error('expected any number of assertion, but got none');
    if (Error.captureStackTrace) {
      Error.captureStackTrace(error, hasAssertions);
    }

    expect.setState({
      isExpectingAssertions: true,
      isExpectingAssertionsError: error,
    });
  }

  chai.util.addMethod(expect, 'assertions', assertions);
  chai.util.addMethod(expect, 'hasAssertions', hasAssertions);

  expect.extend(customMatchers);

  return expect;
}

const globalExpect: ExpectStatic = createExpect();

Object.defineProperty(globalThis, GLOBAL_EXPECT, {
  value: globalExpect,
  writable: true,
  configurable: true,
});

export { assert, should } from 'chai';
export { chai, globalExpect as expect };

export type {
  Assertion,
  AsymmetricMatchersContaining,
  DeeplyAllowMatchers,
  ExpectStatic,
  JestAssertion,
  Matchers,
} from '@vitest/expect';
