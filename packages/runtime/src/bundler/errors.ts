export class ModuleNotFoundError extends Error {
  constructor(public readonly modulePath: string) {
    super(`Module ${modulePath} not found`);
    this.name = 'ModuleNotFoundError';
  }
}

export class BundlingFailedError extends Error {
  constructor(
    public readonly modulePath: string,
    public readonly reason: string,
    message: string = reason
  ) {
    super(`Bundling of ${modulePath} failed with error:\n\n${message}\n`);
    this.name = 'BundlingFailedError';
  }
}
