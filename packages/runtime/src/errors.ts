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
