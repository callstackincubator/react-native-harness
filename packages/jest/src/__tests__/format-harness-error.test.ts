import { describe, expect, it } from 'vitest';
import { formatHarnessErrorMessage } from '../format-harness-error.js';

describe('formatHarnessErrorMessage', () => {
  it('formats pending promise diagnostics for timeout errors', () => {
    const message = formatHarnessErrorMessage(
      {
        name: 'TestCaseTimeoutError',
        message: 'Test timed out after 50ms: suite hangs',
        diagnostics: {
          pendingPromises: {
            total: 2,
            items: [
              {
                id: 7,
                createdAt: 110,
                stack: 'Error: Promise created\n    at hangs (example.ts:10:5)',
              },
            ],
          },
        },
      },
      { testStartedAt: 100 },
    );

    expect(message).toContain('Test timed out after 50ms: suite hangs');
    expect(message).toContain('Pending promises at timeout: 2');
    expect(message).toContain('Showing 1 of 2 pending promises.');
    expect(message).toContain('Promise #7, created 10ms after test start:');
    expect(message).toContain('  Error: Promise created');
  });

  it('prints the assertion diff between the message and the code frame', () => {
    const message = formatHarnessErrorMessage({
      name: 'AssertionError',
      message: 'expected 1 to be 2 // Object.is equality',
      diff: '- Expected\n+ Received\n\n- 2\n+ 1',
      codeFrame: {
        content: '> 3 |   expect(1).toBe(2);',
        fileName: 'example.harness.ts',
      },
    });

    expect(message).toBe(
      [
        'expected 1 to be 2 // Object.is equality',
        '- Expected\n+ Received\n\n- 2\n+ 1',
        '> 3 |   expect(1).toBe(2);',
      ].join('\n\n'),
    );
  });
});
