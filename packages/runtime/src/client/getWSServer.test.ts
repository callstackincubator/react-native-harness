import { HARNESS_BRIDGE_PATH } from '@react-native-harness/bridge';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getWSServer } from './getWSServer.js';

const mocks = vi.hoisted(() => ({
  getDevServerUrl: vi.fn(),
}));

vi.mock('../utils/dev-server.js', () => ({
  getDevServerUrl: mocks.getDevServerUrl,
}));

vi.mock('react-native-url-polyfill', () => ({
  URL,
}));

describe('getWSServer', () => {
  beforeEach(() => {
    mocks.getDevServerUrl.mockReset();
  });

  it('builds a websocket bridge URL from an http dev server URL', () => {
    mocks.getDevServerUrl.mockReturnValue(
      'http://localhost:8081/index.bundle?platform=ios&dev=true#main',
    );

    expect(getWSServer()).toBe(`ws://localhost:8081${HARNESS_BRIDGE_PATH}`);
  });

  it('builds a secure websocket bridge URL from an https dev server URL', () => {
    mocks.getDevServerUrl.mockReturnValue('HTTPS://Example.COM:19000/');

    expect(getWSServer()).toBe(`wss://example.com:19000${HARNESS_BRIDGE_PATH}`);
  });

  it('preserves the explicit port for hostnames', () => {
    mocks.getDevServerUrl.mockReturnValue('http://example.com:31337/status');

    expect(getWSServer()).toBe(`ws://example.com:31337${HARNESS_BRIDGE_PATH}`);
  });

  it('drops user info while preserving the host for ipv6 URLs', () => {
    mocks.getDevServerUrl.mockReturnValue(
      'http://user:secret@[::1]:8081/status',
    );

    expect(getWSServer()).toBe(`ws://[::1]:8081${HARNESS_BRIDGE_PATH}`);
  });

  it('preserves the port for ipv6 URLs without user info', () => {
    mocks.getDevServerUrl.mockReturnValue('http://[2001:db8::1]:19001/status');

    expect(getWSServer()).toBe(
      `ws://[2001:db8::1]:19001${HARNESS_BRIDGE_PATH}`,
    );
  });

  it('throws for non-absolute dev server URLs', () => {
    mocks.getDevServerUrl.mockReturnValue('localhost:8081');

    expect(() => getWSServer()).toThrow(
      new TypeError('Invalid URL: localhost:8081'),
    );
  });
});
