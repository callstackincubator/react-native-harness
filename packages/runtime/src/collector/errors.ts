export type TestErrorCode =
  | 'CONTEXT_NOT_INITIALIZED'
  | 'OUTSIDE_DESCRIBE_BLOCK'
  | 'INVALID_TEST_NAME'
  | 'DUPLICATE_TEST_NAME'
  | 'INVALID_FUNCTION';

export class TestError extends Error {
  constructor(
    public code: TestErrorCode,
    public functionName: string,
    public context?: Record<string, unknown>
  ) {
    const baseMessages: Record<TestErrorCode, string> = {
      CONTEXT_NOT_INITIALIZED:
        'Test context not initialized. Call collectTests() first.',
      OUTSIDE_DESCRIBE_BLOCK: `${functionName}() must be called within a describe() block`,
      INVALID_TEST_NAME: `${functionName}() requires a non-empty string name`,
      DUPLICATE_TEST_NAME: `Duplicate test name "${context?.name}" in suite "${context?.suiteName}"`,
      INVALID_FUNCTION: `${functionName}() requires a function as the second parameter`,
    };

    const message = baseMessages[code] || `Unknown error in ${functionName}()`;
    super(message);
    this.name = 'TestError';
  }
}
