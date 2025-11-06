export type EventListener<TEvent> = (event: TEvent) => void;

export type EventEmitter<TEvents> = {
  addListener: (listener: EventListener<TEvents>) => void;
  removeListener: (listener: EventListener<TEvents>) => void;
  emit: (event: TEvents) => void;
  clearAllListeners: () => void;
};

export const getEmitter = <TEvents>() => {
  const listeners = new Set<EventListener<TEvents>>();

  return {
    addListener: (listener: EventListener<TEvents>) => {
      listeners.add(listener);
    },
    removeListener: (listener: EventListener<TEvents>) => {
      listeners.delete(listener);
    },
    emit: (event: TEvents) => {
      listeners.forEach((listener) => listener(event));
    },
    clearAllListeners: () => {
      listeners.clear();
    },
  };
};
