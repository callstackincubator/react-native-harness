export class ModuleNotFoundError extends Error {
  constructor(public readonly modulePath: string) {
    super(`Module ${modulePath} not found`);
    this.name = 'ModuleNotFoundError';
  }
}

export class MalformedModuleError extends Error {
  constructor(
    public readonly modulePath: string,
    public readonly reason: string
  ) {
    super(`Module ${modulePath} is malformed: ${reason}`);
    this.name = 'MalformedModuleError';
  }
}

export class BundlingFailedError extends Error {
  constructor(
    public readonly modulePath: string,
    public readonly reason: string
  ) {
    const reasonMessage = JSON.parse(reason).message ?? reason;
    super(`Bundling of ${modulePath} failed with error:\n\n${reasonMessage}\n`);
    this.name = 'BundlingFailedError';
  }
}
