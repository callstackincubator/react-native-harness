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

export class EnvironmentError extends Error {
  constructor(
    public readonly context: string,
    public readonly details?: string
  ) {
    const message = details
      ? `Environment error in ${context}: ${details}`
      : `Environment error: ${context}`;
    super(message);
    this.name = 'EnvironmentError';
  }
}
