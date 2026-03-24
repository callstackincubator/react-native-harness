import { afterEach, describe, expect, it, vi } from 'vitest';
import * as tools from '@react-native-harness/tools';
import {
  applyHarnessDebugHttpHost,
  clearHarnessDebugHttpHost,
} from '../shared-prefs.js';

const bundleId = 'com.example.app';
const adbId = 'emulator-5554';

const getWrittenContent = (
  calls: ReadonlyArray<readonly unknown[]>
): string => {
  const writeCall = calls.find(([, , options]) => {
    if (!options || typeof options !== 'object' || !('stdin' in options)) {
      return false;
    }

    return Boolean(options.stdin);
  });
  const options = writeCall?.[2];

  if (!options || typeof options !== 'object' || !('stdin' in options)) {
    throw new Error('Expected write call options.');
  }

  const content = options.stdin;

  if (
    !content ||
    typeof content !== 'object' ||
    !('string' in content) ||
    typeof content.string !== 'string'
  ) {
    throw new Error('Expected write call with string stdin.');
  }

  return content.string;
};

const getWrittenContents = (
  calls: ReadonlyArray<readonly unknown[]>
): string[] =>
  calls
    .filter(([, , options]) => {
      if (!options || typeof options !== 'object' || !('stdin' in options)) {
        return false;
      }

      return Boolean(options.stdin);
    })
    .map((call) => getWrittenContent([call]));

describe('Android shared preferences Metro host override', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('handles empty self-closing map files', async () => {
    const spawnSpy = vi
      .spyOn(tools, 'spawn')
      .mockResolvedValueOnce({
        stdout: '<?xml version="1.0" encoding="utf-8"?>\n<map />\n',
      } as Awaited<ReturnType<typeof tools.spawn>>)
      .mockResolvedValueOnce({} as Awaited<ReturnType<typeof tools.spawn>>);

    await applyHarnessDebugHttpHost(adbId, bundleId, 'localhost:9090');

    expect(getWrittenContent(spawnSpy.mock.calls)).toContain('<map>');
    expect(getWrittenContent(spawnSpy.mock.calls)).toContain('</map>');
    expect(getWrittenContent(spawnSpy.mock.calls)).toContain(
      '<string name="debug_http_host">localhost:9090</string>'
    );
  });

  it('restores the previous debug host on cleanup', async () => {
    const spawnSpy = vi
      .spyOn(tools, 'spawn')
      .mockResolvedValueOnce({
        stdout: [
          '<?xml version="1.0" encoding="utf-8"?>',
          '<map>',
          '  <string name="debug_http_host">10.0.2.2:8081</string>',
          '</map>',
        ].join('\n'),
      } as Awaited<ReturnType<typeof tools.spawn>>)
      .mockResolvedValueOnce({} as Awaited<ReturnType<typeof tools.spawn>>)
      .mockResolvedValueOnce({
        stdout: [
          '<?xml version="1.0" encoding="utf-8"?>',
          '<map>',
          '  <string name="debug_http_host">10.0.2.2:8081</string>',
          '  <!-- react-native-harness:debug_http_host:start -->',
          '  <string name="debug_http_host">localhost:9090</string>',
          '  <!-- react-native-harness:debug_http_host:end -->',
          '</map>',
        ].join('\n'),
      } as Awaited<ReturnType<typeof tools.spawn>>)
      .mockResolvedValueOnce({} as Awaited<ReturnType<typeof tools.spawn>>);

    await applyHarnessDebugHttpHost(adbId, bundleId, 'localhost:9090');
    await clearHarnessDebugHttpHost(adbId, bundleId);

    const writes = getWrittenContents(spawnSpy.mock.calls);
    const firstWrite = writes[0];
    const secondWrite = writes[1];

    expect(firstWrite).toEqual(
      expect.stringContaining(
        '<string name="harness_debug_http_host_backup">10.0.2.2:8081</string>'
      )
    );
    expect(firstWrite).toEqual(
      expect.stringContaining(
        '<string name="debug_http_host">localhost:9090</string>'
      )
    );
    expect(firstWrite).toEqual(
      expect.not.stringContaining(
        '<string name="debug_http_host">10.0.2.2:8081</string>'
      )
    );
    expect(secondWrite).toEqual(
      expect.stringContaining(
        '<string name="debug_http_host">10.0.2.2:8081</string>'
      )
    );
    expect(secondWrite).toEqual(
      expect.not.stringContaining(
        '<string name="harness_debug_http_host_backup">10.0.2.2:8081</string>'
      )
    );
    expect(secondWrite).toEqual(
      expect.not.stringContaining(
        '<!-- react-native-harness:debug_http_host:start -->'
      )
    );
    expect(secondWrite).toEqual(
      expect.not.stringContaining(
        '<string name="debug_http_host">localhost:9090</string>'
      )
    );
  });
});
