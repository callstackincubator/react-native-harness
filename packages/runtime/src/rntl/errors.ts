export const enum TestErrorCode {
  CONTEXT_NOT_INITIALIZED = 'CONTEXT_NOT_INITIALIZED',
  OUTSIDE_DESCRIBE_BLOCK = 'OUTSIDE_DESCRIBE_BLOCK',
  INVALID_TEST_NAME = 'INVALID_TEST_NAME',
  DUPLICATE_TEST_NAME = 'DUPLICATE_TEST_NAME',
  INVALID_FUNCTION = 'INVALID_FUNCTION',
}

export class TestError extends Error {
  constructor(
    public code: TestErrorCode,
    public functionName: string,
    public context?: Record<string, unknown>
  ) {
    const baseMessages = {
      [TestErrorCode.CONTEXT_NOT_INITIALIZED]:
        'Test context not initialized. Call collectTests() first.',
      [TestErrorCode.OUTSIDE_DESCRIBE_BLOCK]: `${functionName}() must be called within a describe() block`,
      [TestErrorCode.INVALID_TEST_NAME]: `${functionName}() requires a non-empty string name`,
      [TestErrorCode.DUPLICATE_TEST_NAME]: `Duplicate test name "${context?.name}" in suite "${context?.suiteName}"`,
      [TestErrorCode.INVALID_FUNCTION]: `${functionName}() requires a function as the second parameter`,
    };

    const message = baseMessages[code] || `Unknown error in ${functionName}()`;
    super(message);
    this.name = 'TestError';
  }
}
