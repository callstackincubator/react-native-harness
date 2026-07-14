import { describe, expect, it, vi } from 'vitest';
import { createDiagnostics, instrumented } from '../diagnostics.js';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('createDiagnostics (enabled)', () => {
  it('measures a successful sync/async fn', async () => {
    const diagnostics = createDiagnostics({ enabled: true });

    const result = await diagnostics.measure('foo.bar', async () => {
      await wait(5);
      return 42;
    });

    expect(result).toBe(42);
    const entries = diagnostics.flush();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.label).toBe('foo.bar');
    expect(entries[0]?.status).toBe('ok');
    expect(entries[0]?.kind).toBe('span');
    expect(entries[0]?.duration).toBeGreaterThanOrEqual(0);
  });

  it('records an error status and rethrows on measure failure', async () => {
    const diagnostics = createDiagnostics({ enabled: true });
    const error = new Error('boom');

    await expect(
      diagnostics.measure('foo.bar', () => {
        throw error;
      })
    ).rejects.toThrow('boom');

    const entries = diagnostics.flush();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.status).toBe('error');
    expect(entries[0]?.attrs?.error).toBe('Error: boom');
  });

  it('spans end() is idempotent', () => {
    const diagnostics = createDiagnostics({ enabled: true });
    const span = diagnostics.start('foo.span');
    span.end({ a: 1 });
    span.end({ a: 2 });
    span.fail(new Error('nope'));

    const entries = diagnostics.flush();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.attrs).toEqual({ a: 1 });
  });

  it('spans fail() is idempotent and truncates long errors', () => {
    const diagnostics = createDiagnostics({ enabled: true });
    const span = diagnostics.start('foo.span');
    const longMessage = 'x'.repeat(300);
    span.fail(new Error(longMessage));
    span.end();

    const entries = diagnostics.flush();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.status).toBe('error');
    expect(entries[0]?.attrs?.error).toHaveLength(203);
  });

  it('child(namespace) prefixes labels and writes to the root buffer', () => {
    const diagnostics = createDiagnostics({ enabled: true });
    const metro = diagnostics.child('metro');
    metro.mark('bundle.request');

    const entries = diagnostics.flush();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.label).toBe('metro.bundle.request');
  });

  it('child(attrs) merges inherited attrs into every entry', () => {
    const diagnostics = createDiagnostics({ enabled: true });
    const withRunId = diagnostics.child({ runId: 'run-1' });
    withRunId.mark('run.total', { status: 'ok' });

    const entries = diagnostics.flush();
    expect(entries[0]?.attrs).toEqual({ runId: 'run-1', status: 'ok' });
  });

  it('mark() records an instant entry with zero duration', () => {
    const diagnostics = createDiagnostics({ enabled: true });
    diagnostics.mark('bridge.connected');

    const entries = diagnostics.flush();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe('mark');
    expect(entries[0]?.duration).toBe(0);
  });

  it('record() computes startTime from now - duration', () => {
    const diagnostics = createDiagnostics({ enabled: true });
    const before = Date.now();
    diagnostics.record({ label: 'client.test', duration: 100 });
    const after = Date.now();

    const entries = diagnostics.flush();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.duration).toBe(100);
    expect(entries[0]?.startTime).toBeGreaterThanOrEqual(before - 100 - 5);
    expect(entries[0]?.startTime).toBeLessThanOrEqual(after - 100 + 5);
  });

  it('flush() drains recorded entries', () => {
    const diagnostics = createDiagnostics({ enabled: true });
    diagnostics.mark('a');
    expect(diagnostics.flush()).toHaveLength(1);
    expect(diagnostics.flush()).toHaveLength(0);
  });
});

describe('createDiagnostics (disabled)', () => {
  it('is a no-op: measure just invokes fn, flush returns empty', async () => {
    const diagnostics = createDiagnostics({ enabled: false });
    expect(diagnostics.enabled).toBe(false);

    const result = await diagnostics.measure('foo', async () => 'value');
    expect(result).toBe('value');
    expect(diagnostics.flush()).toEqual([]);

    const span = diagnostics.start('foo');
    span.end();
    span.fail(new Error('x'));
    diagnostics.mark('foo');
    diagnostics.record({ label: 'foo', duration: 10 });
    expect(diagnostics.flush()).toEqual([]);
  });

  it('defaults to disabled when no options are passed', () => {
    const diagnostics = createDiagnostics();
    expect(diagnostics.enabled).toBe(false);
  });

  it('child() of a disabled instance is also disabled', () => {
    const diagnostics = createDiagnostics({ enabled: false });
    const child = diagnostics.child('ns');
    expect(child.enabled).toBe(false);
  });
});

describe('instrumented()', () => {
  it('returns the same reference when diagnostics is disabled', () => {
    const target = { doThing: () => 'ok' };
    const diagnostics = createDiagnostics({ enabled: false });
    expect(instrumented(target, 'ns', diagnostics)).toBe(target);
  });

  it('times a successful async method', async () => {
    const diagnostics = createDiagnostics({ enabled: true });
    const target = {
      doThing: async (n: number) => {
        await wait(5);
        return n * 2;
      },
    };

    const wrapped = instrumented(target, 'platform.android.adb', diagnostics);
    await expect(wrapped.doThing(21)).resolves.toBe(42);

    const entries = diagnostics.flush();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.label).toBe('platform.android.adb.doThing');
    expect(entries[0]?.status).toBe('ok');
  });

  it('records a failed async method and rethrows', async () => {
    const diagnostics = createDiagnostics({ enabled: true });
    const target = {
      doThing: async () => {
        throw new Error('fail');
      },
    };

    const wrapped = instrumented(target, 'ns', diagnostics);
    await expect(wrapped.doThing()).rejects.toThrow('fail');

    const entries = diagnostics.flush();
    expect(entries[0]?.status).toBe('error');
  });

  it('records a failed sync method and rethrows', () => {
    const diagnostics = createDiagnostics({ enabled: true });
    const target = {
      doThing: () => {
        throw new Error('sync fail');
      },
    };

    const wrapped = instrumented(target, 'ns', diagnostics);
    expect(() => wrapped.doThing()).toThrow('sync fail');

    const entries = diagnostics.flush();
    expect(entries[0]?.status).toBe('error');
  });

  it('passes through non-function properties untouched', () => {
    const diagnostics = createDiagnostics({ enabled: true });
    const target = { value: 123 };
    const wrapped = instrumented(target, 'ns', diagnostics);
    expect(wrapped.value).toBe(123);
  });

  it('preserves this binding for wrapped methods', async () => {
    const diagnostics = createDiagnostics({ enabled: true });
    const target = {
      state: 7,
      getState() {
        return this.state;
      },
    };

    const wrapped = instrumented(target, 'ns', diagnostics);
    expect(wrapped.getState()).toBe(7);
  });

  it('keeps a stable identity for wrapped methods so listener add/remove works', () => {
    const diagnostics = createDiagnostics({ enabled: true });
    const target = { handler: () => undefined };
    const wrapped = instrumented(target, 'ns', diagnostics);

    const first = wrapped.handler;
    const second = wrapped.handler;
    expect(first).toBe(second);

    const listeners = new Set<() => void>();
    listeners.add(wrapped.handler);
    listeners.delete(wrapped.handler);
    expect(listeners.size).toBe(0);
  });

  it('returns hybrid thenables (e.g. nano-spawn Subprocess) untouched, not collapsed to a plain Promise', async () => {
    const diagnostics = createDiagnostics({ enabled: true });
    const nodeChildProcess = Promise.resolve({ kill: vi.fn() });
    const hybrid = Object.assign(Promise.resolve('done'), {
      nodeChildProcess,
      [Symbol.asyncIterator]: async function* () {
        yield 'line-1';
      },
    });
    const target = { startLogcat: () => hybrid };

    const wrapped = instrumented(target, 'platform.android.adb', diagnostics);
    const result = wrapped.startLogcat();

    expect(result).toBe(hybrid);
    expect((result as typeof hybrid).nodeChildProcess).toBe(nodeChildProcess);

    const lines: string[] = [];
    for await (const line of result as AsyncIterable<string>) {
      lines.push(line);
    }
    expect(lines).toEqual(['line-1']);

    await wait(5);
    const entries = diagnostics.flush();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.status).toBe('ok');
  });

  it('spy-based check that fn is invoked once per call', () => {
    const diagnostics = createDiagnostics({ enabled: true });
    const spy = vi.fn(() => 'ok');
    const target = { doThing: spy };
    const wrapped = instrumented(target, 'ns', diagnostics);

    wrapped.doThing();
    wrapped.doThing();

    expect(spy).toHaveBeenCalledTimes(2);
  });
});
