import type {
  AppSession,
  AppSessionEvent,
  AppSessionLog,
  AppSessionListener,
  AppSessionState,
} from './types.js';

export const createBoundedLogBuffer = (limit = 500) => {
  // Ring buffer: `buffer[start]` is the oldest entry, and entries wrap
  // around the fixed-size array instead of reallocating on every push.
  const buffer: AppSessionLog[] = new Array(limit);
  let start = 0;
  let count = 0;

  return {
    push: (line: string, occurredAt = Date.now()) => {
      const index = (start + count) % limit;
      buffer[index] = { line, occurredAt };
      if (count < limit) {
        count++;
      } else {
        // Buffer is full: the slot we just overwrote was the oldest
        // entry, so advance `start` to the new oldest entry.
        start = (start + 1) % limit;
      }
    },
    getLogs: (): AppSessionLog[] => {
      const logs: AppSessionLog[] = [];
      for (let i = 0; i < count; i++) {
        logs.push(buffer[(start + i) % limit]);
      }
      return logs;
    },
    clear: () => {
      start = 0;
      count = 0;
    },
  };
};

export const createNoopAppSession = (): AppSession => {
  let state: AppSessionState = { status: 'running' };
  const listeners = new Set<AppSessionListener>();

  return {
    dispose: async () => {
      state = { status: 'disposed', occurredAt: Date.now() };
      listeners.clear();
    },
    getState: async () => state,
    getLogs: () => [],
    addListener: (listener) => {
      listeners.add(listener);
    },
    removeListener: (listener) => {
      listeners.delete(listener);
    },
  };
};

export const createAppSessionEmitter = () => {
  const listeners = new Set<AppSessionListener>();

  return {
    emit: (event: AppSessionEvent) => {
      for (const listener of listeners) listener(event);
    },
    addListener: (listener: AppSessionListener) => {
      listeners.add(listener);
    },
    removeListener: (listener: AppSessionListener) => {
      listeners.delete(listener);
    },
    clear: () => {
      listeners.clear();
    },
  };
};
