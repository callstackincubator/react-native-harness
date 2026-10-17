import { describe, expect, it, vi } from 'vitest';
import {
  resolveXCTestAgentArtifacts,
  type XCTestAgentArtifacts,
  type XCTestAgentProvider,
} from '../xctest-agent-artifacts.js';

const context = {
  destination: 'simulator' as const,
  projectRoot: '/tmp/project',
};

const artifactsFrom = (
  source: XCTestAgentArtifacts['source']
): XCTestAgentArtifacts => ({
  launch: {
    derivedDataPath: `/tmp/derived/${source}`,
    kind: 'xctestrun',
    xctestrunPath: `/tmp/derived/${source}/agent.xctestrun`,
  },
  source,
});

const providerReturning = (
  id: XCTestAgentArtifacts['source']
): XCTestAgentProvider => ({
  id,
  prepare: vi.fn(() => artifactsFrom(id)),
});

const providerDeclining = (id: string): XCTestAgentProvider => ({
  id,
  prepare: vi.fn(() => null),
});

describe('resolveXCTestAgentArtifacts', () => {
  it('returns artifacts from the first provider that provides them', async () => {
    const first = providerReturning('prebuilt');
    const second = providerReturning('build');

    const artifacts = await resolveXCTestAgentArtifacts([first, second], context);

    expect(artifacts.source).toBe('prebuilt');
    expect(artifacts.launch.derivedDataPath).toBe('/tmp/derived/prebuilt');
    expect(first.prepare).toHaveBeenCalledTimes(1);
    expect(second.prepare).not.toHaveBeenCalled();
  });

  it('falls through to the next provider when one declines', async () => {
    const declining = providerDeclining('prebuilt');
    const providing = providerReturning('build');

    const artifacts = await resolveXCTestAgentArtifacts(
      [declining, providing],
      context
    );

    expect(artifacts.launch.derivedDataPath).toBe('/tmp/derived/build');
    expect(declining.prepare).toHaveBeenCalledTimes(1);
    expect(providing.prepare).toHaveBeenCalledTimes(1);
  });

  it('passes the requested context to providers', async () => {
    const provider = providerReturning('build');
    const signal = new AbortController().signal;

    await resolveXCTestAgentArtifacts([provider], {
      destination: 'device',
      projectRoot: '/tmp/other',
      signing: { teamId: 'TESTTEAM01' },
      signal,
    });

    expect(provider.prepare).toHaveBeenCalledWith({
      destination: 'device',
      projectRoot: '/tmp/other',
      signing: { teamId: 'TESTTEAM01' },
      signal,
    });
  });

  it('fails listing every provider that declined when none provides artifacts', async () => {
    await expect(
      resolveXCTestAgentArtifacts(
        [providerDeclining('prebuilt'), providerDeclining('cache')],
        context
      )
    ).rejects.toThrow(/no provider supplied artifacts \(tried prebuilt, cache\)/);
  });

  it('propagates a provider failure instead of falling back', async () => {
    const failing: XCTestAgentProvider = {
      id: 'prebuilt',
      prepare: vi.fn(async () => {
        throw new Error('artifact checksum mismatch');
      }),
    };
    const fallback = providerReturning('build');

    await expect(
      resolveXCTestAgentArtifacts([failing, fallback], context)
    ).rejects.toThrow('artifact checksum mismatch');
    expect(fallback.prepare).not.toHaveBeenCalled();
  });
});
