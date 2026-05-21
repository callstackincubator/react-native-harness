import { beforeEach, describe, expect, it, vi } from 'vitest';
import { device } from '../device/index.js';
import { setHandle } from '../client/store.js';

describe('runtime device permissions API', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sends named grant commands through the bridge handle', async () => {
    const applyDevicePermission = vi.fn(async () => ({ mutationId: 'mutation-1' }));
    const revertDevicePermission = vi.fn(async () => undefined);

    setHandle({
      reportReady: vi.fn(),
      emitEvent: vi.fn(),
      applyDevicePermission,
      revertDevicePermission,
      transferScreenshot: vi.fn(),
      matchImageSnapshot: vi.fn(),
      disconnect: vi.fn(),
    });

    const mutation = await device.permissions.grant('microphone');

    expect(applyDevicePermission).toHaveBeenCalledWith({
      kind: 'permission',
      permission: 'microphone',
      decision: 'grant',
    });
    expect(mutation?.id).toBe('mutation-1');

    await mutation?.revert();

    expect(revertDevicePermission).toHaveBeenCalledWith('mutation-1');
  });

  it('sends bulk commands through the bridge handle', async () => {
    const applyDevicePermission = vi.fn(async () => ({}));

    setHandle({
      reportReady: vi.fn(),
      emitEvent: vi.fn(),
      applyDevicePermission,
      revertDevicePermission: vi.fn(),
      transferScreenshot: vi.fn(),
      matchImageSnapshot: vi.fn(),
      disconnect: vi.fn(),
    });

    const mutation = await device.permissions.denyAll();

    expect(applyDevicePermission).toHaveBeenCalledWith({
      kind: 'permission-all',
      decision: 'deny',
    });
    expect(mutation).toBeNull();
  });

  it('warns and returns null when the host reports a no-op warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    setHandle({
      reportReady: vi.fn(),
      emitEvent: vi.fn(),
      applyDevicePermission: vi.fn(async () => ({ warning: 'not supported' })),
      revertDevicePermission: vi.fn(),
      transferScreenshot: vi.fn(),
      matchImageSnapshot: vi.fn(),
      disconnect: vi.fn(),
    });

    await expect(device.permissions.reset('camera')).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith('not supported');
  });
});
