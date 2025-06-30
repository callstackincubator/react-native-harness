export class BridgeTimeoutError extends Error {
    constructor(
        public readonly timeout: number,
        public readonly runnerName: string,
        public readonly platform: string
    ) {
        super(`Bridge connection timed out after ${timeout}ms while waiting for "${runnerName}" (${platform}) runner to be ready`);
        this.name = 'BridgeTimeoutError';
    }
} 