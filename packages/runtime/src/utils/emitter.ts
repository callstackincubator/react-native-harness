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

export function combineEventEmitters<TEvents0, TEvents1>(
  emitter0: EventEmitter<TEvents0>,
  emitter1: EventEmitter<TEvents1>
): EventEmitter<TEvents0 | TEvents1>;
export function combineEventEmitters<TEvents0, TEvents1, TEvents2>(
  emitter0: EventEmitter<TEvents0>,
  emitter1: EventEmitter<TEvents1>,
  emitter2: EventEmitter<TEvents2>
): EventEmitter<TEvents0 | TEvents1 | TEvents2>;
export function combineEventEmitters(
  ...emitters: EventEmitter<unknown>[]
): EventEmitter<unknown> {
  const internalEmitter = getEmitter();

  const handleEvent = (event: unknown) => internalEmitter.emit(event);

  emitters.forEach((emitter) => {
    emitter.addListener(handleEvent);
  });

  return {
    addListener: (listener: EventListener<unknown>) => {
      internalEmitter.addListener(listener);
    },
    removeListener: (listener: EventListener<unknown>) => {
      internalEmitter.removeListener(listener);
    },
    emit: (event: unknown) => {
      internalEmitter.emit(event);
    },
    clearAllListeners: () => {
      internalEmitter.clearAllListeners();
      emitters.forEach((emitter) => emitter.removeListener(handleEvent));
    },
  };
}
