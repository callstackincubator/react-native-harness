export class MalformedModuleError extends Error {
  constructor(
    public readonly modulePath: string,
    public readonly reason: string
  ) {
    super(`Module ${modulePath} is malformed: ${reason}`);
    this.name = 'MalformedModuleError';
  }
}
