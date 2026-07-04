import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchModule, releaseModule } from './bundle.js';

const mocks = vi.hoisted(() => ({
  Platform: { OS: 'ios' as string },
  devServerUrl: 'http://localhost:8081/',
}));

vi.mock('react-native', () => ({
  Platform: mocks.Platform,
}));

vi.mock('react-native/Libraries/Core/Devtools/getDevServer', () => ({
  default: () => ({ url: mocks.devServerUrl }),
}));

const EXPECTED_URL =
  'http://localhost:8081/path/to/example.harness.bundle?modulesOnly=true&platform=ios';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('module bundling', () => {
  it('fetches a module from its per-file bundle URL', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('module-source', { status: 200 }));

    await expect(fetchModule('path/to/example.harness.tsx')).resolves.toBe(
      'module-source',
    );

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(EXPECTED_URL);
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('releases the graph by DELETE-ing the exact same URL', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));

    await releaseModule('path/to/example.harness.tsx');

    expect(fetchSpy).toHaveBeenCalledWith(EXPECTED_URL, { method: 'DELETE' });
  });

  it('never throws if releasing the graph fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    await expect(
      releaseModule('path/to/example.harness.tsx'),
    ).resolves.toBeUndefined();
  });
});
