export function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new AssertionError(message);
  }
}

export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssertionError';
  }
}
