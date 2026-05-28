import type {
  AppSession,
  AppSessionEvent,
  AppSessionLog,
  AppSessionListener,
  AppSessionState,
} from './types.js';

export const createBoundedLogBuffer = (limit = 500) => {
  let logs: AppSessionLog[] = [];

  return {
    push: (line: string, occurredAt = Date.now()) => {
      logs = [...logs, { line, occurredAt }].slice(-limit);
    },
    getLogs: () => [...logs],
    clear: () => {
      logs = [];
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
