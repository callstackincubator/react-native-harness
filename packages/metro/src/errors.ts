export class CouldNotPatchModuleSystemError extends Error {
  constructor() {
    super('Could not patch module system');
    this.name = 'CouldNotPatchModuleSystemError';
  }
}
