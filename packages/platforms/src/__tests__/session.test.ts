import { describe, expect, it, vi } from 'vitest';
import { createBoundedLogBuffer } from '../session.js';

describe('createBoundedLogBuffer', () => {
  it('returns entries in chronological (oldest-first) order when under the limit', () => {
    const buffer = createBoundedLogBuffer(5);

    buffer.push('a', 1);
    buffer.push('b', 2);
    buffer.push('c', 3);

    expect(buffer.getLogs()).toEqual([
      { line: 'a', occurredAt: 1 },
      { line: 'b', occurredAt: 2 },
      { line: 'c', occurredAt: 3 },
    ]);
  });

  it('retains all entries when exactly at the limit', () => {
    const buffer = createBoundedLogBuffer(3);

    buffer.push('a', 1);
    buffer.push('b', 2);
    buffer.push('c', 3);

    expect(buffer.getLogs()).toEqual([
      { line: 'a', occurredAt: 1 },
      { line: 'b', occurredAt: 2 },
      { line: 'c', occurredAt: 3 },
    ]);
  });

  it('drops the oldest entry and keeps chronological order one past the limit', () => {
    const buffer = createBoundedLogBuffer(3);

    buffer.push('a', 1);
    buffer.push('b', 2);
    buffer.push('c', 3);
    buffer.push('d', 4);

    expect(buffer.getLogs()).toEqual([
      { line: 'b', occurredAt: 2 },
      { line: 'c', occurredAt: 3 },
      { line: 'd', occurredAt: 4 },
    ]);
  });

  it('keeps only the most recent `limit` entries, oldest-first, well past the limit', () => {
    const limit = 5;
    const buffer = createBoundedLogBuffer(limit);
    const totalPushes = limit * 4 + 2; // several full wrap-arounds

    for (let i = 1; i <= totalPushes; i++) {
      buffer.push(`line-${i}`, i);
    }

    const logs = buffer.getLogs();
    expect(logs).toHaveLength(limit);
    expect(logs.map((entry) => entry.line)).toEqual([
      `line-${totalPushes - limit + 1}`,
      `line-${totalPushes - limit + 2}`,
      `line-${totalPushes - limit + 3}`,
      `line-${totalPushes - limit + 4}`,
      `line-${totalPushes - limit + 5}`,
    ]);
    // occurredAt must be strictly increasing, confirming oldest-first order.
    expect(logs.map((entry) => entry.occurredAt)).toEqual([
      totalPushes - limit + 1,
      totalPushes - limit + 2,
      totalPushes - limit + 3,
      totalPushes - limit + 4,
      totalPushes - limit + 5,
    ]);
  });

  it('returns a defensive copy from getLogs', () => {
    const buffer = createBoundedLogBuffer(5);
    buffer.push('a', 1);

    const logs = buffer.getLogs();
    logs.push({ line: 'mutated', occurredAt: 999 });
    logs.length = 0;

    expect(buffer.getLogs()).toEqual([{ line: 'a', occurredAt: 1 }]);
  });

  it('empties the buffer on clear', () => {
    const buffer = createBoundedLogBuffer(3);
    buffer.push('a', 1);
    buffer.push('b', 2);

    buffer.clear();

    expect(buffer.getLogs()).toEqual([]);

    buffer.push('c', 3);
    expect(buffer.getLogs()).toEqual([{ line: 'c', occurredAt: 3 }]);
  });

  it('continues to enforce the limit correctly after a clear', () => {
    const buffer = createBoundedLogBuffer(2);
    buffer.push('a', 1);
    buffer.push('b', 2);
    buffer.push('c', 3);
    buffer.clear();

    buffer.push('d', 4);
    buffer.push('e', 5);
    buffer.push('f', 6);

    expect(buffer.getLogs()).toEqual([
      { line: 'e', occurredAt: 5 },
      { line: 'f', occurredAt: 6 },
    ]);
  });

  it('returns an empty array when nothing has been pushed', () => {
    const buffer = createBoundedLogBuffer(5);

    expect(buffer.getLogs()).toEqual([]);
  });

  it('defaults occurredAt to Date.now()', () => {
    vi.useFakeTimers();
    vi.setSystemTime(12345);

    const buffer = createBoundedLogBuffer(5);
    buffer.push('a');

    expect(buffer.getLogs()).toEqual([{ line: 'a', occurredAt: 12345 }]);

    vi.useRealTimers();
  });

  it('defaults to a limit of 500', () => {
    const buffer = createBoundedLogBuffer();

    for (let i = 1; i <= 501; i++) {
      buffer.push(`line-${i}`, i);
    }

    const logs = buffer.getLogs();
    expect(logs).toHaveLength(500);
    expect(logs[0]).toEqual({ line: 'line-2', occurredAt: 2 });
    expect(logs[499]).toEqual({ line: 'line-501', occurredAt: 501 });
  });
});
