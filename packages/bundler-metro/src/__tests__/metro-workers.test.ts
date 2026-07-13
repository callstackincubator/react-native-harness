import { describe, expect, it } from 'vitest';
import { getCappedMaxWorkers } from '../metro-workers.js';

describe('getCappedMaxWorkers', () => {
  it('caps to 1 worker when only 2 host cores are available', () => {
    expect(
      getCappedMaxWorkers({ configuredMaxWorkers: undefined, hostParallelism: 2 })
    ).toBe(1);
  });

  it('caps to 1 worker when only 3 host cores are available', () => {
    expect(
      getCappedMaxWorkers({ configuredMaxWorkers: undefined, hostParallelism: 3 })
    ).toBe(1);
  });

  it('caps to 2 workers when 4 host cores are available', () => {
    expect(
      getCappedMaxWorkers({ configuredMaxWorkers: undefined, hostParallelism: 4 })
    ).toBe(2);
  });

  it('reserves the four cores granted to the device on an 8-core host', () => {
    expect(
      getCappedMaxWorkers({ configuredMaxWorkers: 6, hostParallelism: 8 })
    ).toBe(4);
  });

  it('respects a configured value well below the cap on a large host', () => {
    expect(
      getCappedMaxWorkers({ configuredMaxWorkers: 10, hostParallelism: 16 })
    ).toBe(10);
  });

  it('never lowers a configured value of 1', () => {
    expect(
      getCappedMaxWorkers({ configuredMaxWorkers: 1, hostParallelism: 8 })
    ).toBe(1);
  });

  it('falls back to the cap when maxWorkers is undefined', () => {
    expect(
      getCappedMaxWorkers({ configuredMaxWorkers: undefined, hostParallelism: 8 })
    ).toBe(4);
  });

  it('lowers a configured value that exceeds the cap', () => {
    expect(
      getCappedMaxWorkers({ configuredMaxWorkers: 8, hostParallelism: 4 })
    ).toBe(2);
  });
});
