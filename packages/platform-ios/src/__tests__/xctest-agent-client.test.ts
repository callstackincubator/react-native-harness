import { describe, expect, it, vi } from 'vitest';
import { createXCTestAgentClient } from '../xctest-agent-client.js';
import type { XCTestAgentTransport } from '../xctest-agent-transport.js';

describe('xctest-agent client', () => {
  it('sends typed permission commands over the internal transport', async () => {
    const request = vi
      .fn<NonNullable<XCTestAgentTransport['request']>>()
      .mockResolvedValueOnce({
        body: JSON.stringify({
          permissions: {
            permissionPromptPolicy: 'disabled',
          },
          status: 'ok',
        }),
        headers: {},
        statusCode: 200,
      })
      .mockResolvedValueOnce({
        body: JSON.stringify({
          permissions: {
            permissionPromptPolicy: 'grant-all',
          },
        }),
        headers: {},
        statusCode: 200,
      })
      .mockResolvedValueOnce({
        body: JSON.stringify({
          permissions: {
            permissionPromptPolicy: 'grant-all',
          },
        }),
        headers: {},
        statusCode: 200,
      });
    const dispose = vi.fn(async () => undefined);
    const client = createXCTestAgentClient({
      dispose,
      request,
    });

    await expect(client.health()).resolves.toEqual({
      permissions: {
        permissionPromptPolicy: 'disabled',
      },
      status: 'ok',
    });
    await expect(
      client.configurePermissions({
        permissionPromptPolicy: 'grant-all',
      }),
    ).resolves.toEqual({
      permissionPromptPolicy: 'grant-all',
    });
    await expect(client.getPermissionsConfig()).resolves.toEqual({
      permissionPromptPolicy: 'grant-all',
    });

    expect(request).toHaveBeenNthCalledWith(1, {
      method: 'GET',
      path: '/health',
      body: undefined,
    });
    expect(request).toHaveBeenNthCalledWith(2, {
      method: 'POST',
      path: '/permissions/configure',
      body: JSON.stringify({
        permissionPromptPolicy: 'grant-all',
      }),
    });
    expect(request).toHaveBeenNthCalledWith(3, {
      method: 'GET',
      path: '/permissions',
      body: undefined,
    });
    await client.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('throws on non-success responses', async () => {
    const client = createXCTestAgentClient({
      dispose: vi.fn(async () => undefined),
      request: vi.fn(async () => ({
        body: '{"error":"bad request"}',
        headers: {},
        statusCode: 400,
      })),
    });

    await expect(client.health()).rejects.toThrow(
      'XCTest agent GET /health failed with status 400',
    );
  });
});
