export class ConfigValidationError extends Error {
    constructor(
        public readonly filePath: string,
        public readonly validationErrors: string[]
    ) {
        super(`Invalid configuration in ${filePath}`);
        this.name = 'ConfigValidationError';
    }
}

export class ConfigNotFoundError extends Error {
    constructor(public readonly searchPath: string) {
        super(`Config file not found in ${searchPath} or any parent directories`);
        this.name = 'ConfigNotFoundError';
    }
}

export class ConfigLoadError extends Error {
    public override readonly cause?: Error;

    constructor(public readonly filePath: string, cause?: Error) {
        super(`Failed to load config file ${filePath}`);
        this.name = 'ConfigLoadError';
        this.cause = cause;
    }
} 