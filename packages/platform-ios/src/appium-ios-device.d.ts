declare module 'appium-ios-device' {
  import type net from 'node:net';

  export const utilities: {
    connectPort: (udid: string, port: number) => Promise<net.Socket | unknown>;
  };
}
