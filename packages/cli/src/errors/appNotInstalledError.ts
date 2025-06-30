export class AppNotInstalledError extends Error {
    constructor(
        public readonly deviceName: string,
        public readonly bundleId: string,
        public readonly platform: 'ios' | 'android'
    ) {
        super(`App "${bundleId}" is not installed on ${platform === 'ios' ? 'simulator' : 'emulator'} "${deviceName}"`);
        this.name = 'AppNotInstalledError';
    }
} 