import os from 'node:os';

export type HostCapabilities = {
  totalMemoryBytes: number;
  availableCpuCount: number;
};

export const getHostCapabilities = (): HostCapabilities => {
  return {
    totalMemoryBytes: os.totalmem(),
    availableCpuCount: os.availableParallelism(),
  };
};
