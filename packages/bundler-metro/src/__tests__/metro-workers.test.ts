import { describe, expect, it } from 'vitest';
import { getCappedMaxWorkers } from '../metro-workers.js';

describe('getCappedMaxWorkers', () => {
  it('runs in-band on a 2-core host', () => {
    expect(
      getCappedMaxWorkers({ configuredMaxWorkers: 1, hostParallelism: 2 })
    ).toBe(1);
  });

  it('runs in-band on a 3-vCPU CI runner, leaving cores for the device', () => {
    // Metro's own default here is 2; the device budget claims 2 of 3 cores.
    expect(
      getCappedMaxWorkers({ configuredMaxWorkers: 2, hostParallelism: 3 })
    ).toBe(1);
  });

  it("halves Metro's default on a 12-core host", () => {
    expect(
      getCappedMaxWorkers({ configuredMaxWorkers: 8, hostParallelism: 12 })
    ).toBe(4);
  });

  it("halves Metro's default on a 16-core host", () => {
    expect(
      getCappedMaxWorkers({ configuredMaxWorkers: 10, hostParallelism: 16 })
    ).toBe(5);
  });

  it('applies the device-core reservation when it binds harder than halving', () => {
    // 8 cores: Metro's default is 6 (halved: 3), device cap is 8 - 4 = 4.
    expect(
      getCappedMaxWorkers({ configuredMaxWorkers: 6, hostParallelism: 8 })
    ).toBe(3);
  });

  it('never raises a configured value of 1', () => {
    expect(
      getCappedMaxWorkers({ configuredMaxWorkers: 1, hostParallelism: 16 })
    ).toBe(1);
  });

  it('lowers a configured value that exceeds both limits', () => {
    expect(
      getCappedMaxWorkers({ configuredMaxWorkers: 64, hostParallelism: 4 })
    ).toBe(2);
  });

  it('never returns less than one worker', () => {
    expect(
      getCappedMaxWorkers({ configuredMaxWorkers: 1, hostParallelism: 1 })
    ).toBe(1);
  });

  it("falls back to Metro's own default when maxWorkers is unset", () => {
    // Mirrors the 12-core case above, deriving 8 rather than being handed it.
    expect(
      getCappedMaxWorkers({
        configuredMaxWorkers: undefined,
        hostParallelism: 12,
      })
    ).toBe(4);
  });
});
