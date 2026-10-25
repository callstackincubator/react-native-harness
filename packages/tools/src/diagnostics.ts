export type DiagnosticAttrs = Record<string, string | number | boolean | undefined>;

export type DiagnosticEntry = {
  label: string;
  startTime: number; // ms epoch
  duration: number; // ms
  attrs?: DiagnosticAttrs;
  status: 'ok' | 'error';
  kind: 'span' | 'mark' | 'gauge';
  /** Numeric sample, set only on `gauge` entries. */
  value?: number;
  /** Optional unit of `value` (for example `MB` or `%`), `gauge` entries only. */
  unit?: string;
};

export type DiagnosticEntryListener = (entry: DiagnosticEntry) => void;

export type DiagnosticSpan = {
  end(attrs?: DiagnosticAttrs): void;
  fail(error: unknown, attrs?: DiagnosticAttrs): void;
};

export type DiagnosticRecordInput = {
  label: string;
  duration: number;
  attrs?: DiagnosticAttrs;
  status?: 'ok' | 'error';
};

export type Diagnostics = {
  readonly enabled: boolean;
  start(label: string, attrs?: DiagnosticAttrs): DiagnosticSpan;
  measure<T>(label: string, fn: () => T | Promise<T>, attrs?: DiagnosticAttrs): Promise<T>;
  mark(label: string, attrs?: DiagnosticAttrs): void;
  /** Records a numeric sample (a point on a time series) at the current time. */
  gauge(label: string, value: number, attrs?: DiagnosticAttrs, unit?: string): void;
  record(entry: DiagnosticRecordInput): void;
  child(nsOrAttrs: string | DiagnosticAttrs): Diagnostics;
  /**
   * Observes every entry as it is recorded, including entries recorded through
   * child instances. Unlike `flush()`, subscribing does not consume entries, so
   * a sink can persist them incrementally. With `replay`, entries already
   * recorded and not yet flushed are delivered to the listener first, so a sink
   * attached late still sees the start of the session. Returns a function that
   * unsubscribes.
   */
  subscribe(
    listener: DiagnosticEntryListener,
    options?: { replay?: boolean }
  ): () => void;
  flush(): DiagnosticEntry[];
};

const MAX_ERROR_ATTR_LENGTH = 200;

const truncateError = (error: unknown): string => {
  const message = String(error);
  return message.length > MAX_ERROR_ATTR_LENGTH
    ? `${message.slice(0, MAX_ERROR_ATTR_LENGTH)}...`
    : message;
};

const mergeAttrs = (
  base: DiagnosticAttrs | undefined,
  extra: DiagnosticAttrs | undefined
): DiagnosticAttrs | undefined => {
  if (!base && !extra) {
    return undefined;
  }

  return { ...base, ...extra };
};

const noop = (): void => undefined;

const noopSpan: DiagnosticSpan = {
  end: noop,
  fail: noop,
};

const createNoopDiagnostics = (): Diagnostics => {
  const diagnostics: Diagnostics = {
    enabled: false,
    start: () => noopSpan,
    measure: async (_label, fn) => fn(),
    mark: noop,
    gauge: noop,
    record: noop,
    child: () => diagnostics,
    subscribe: () => noop,
    flush: () => [],
  };

  return diagnostics;
};

export const noopDiagnostics: Diagnostics = createNoopDiagnostics();

type RootState = {
  entries: DiagnosticEntry[];
  listeners: Set<DiagnosticEntryListener>;
  epochAnchor: number;
  perfAnchor: number;
};

const now = (state: RootState): number =>
  state.epochAnchor + (performance.now() - state.perfAnchor);

const createEnabledDiagnostics = (
  state: RootState,
  namespace: string,
  inheritedAttrs: DiagnosticAttrs | undefined
): Diagnostics => {
  const prefixLabel = (label: string): string =>
    namespace ? `${namespace}.${label}` : label;

  const pushEntry = (entry: DiagnosticEntry) => {
    state.entries.push(entry);
    for (const listener of state.listeners) {
      try {
        listener(entry);
      } catch {
        // A faulty sink must never break the code being observed.
      }
    }
  };

  const start = (label: string, attrs?: DiagnosticAttrs): DiagnosticSpan => {
    const fullLabel = prefixLabel(label);
    const startTime = now(state);
    const startPerf = performance.now();
    let settled = false;

    return {
      end: (endAttrs?: DiagnosticAttrs) => {
        if (settled) {
          return;
        }
        settled = true;
        pushEntry({
          label: fullLabel,
          startTime,
          duration: performance.now() - startPerf,
          attrs: mergeAttrs(mergeAttrs(inheritedAttrs, attrs), endAttrs),
          status: 'ok',
          kind: 'span',
        });
      },
      fail: (error: unknown, failAttrs?: DiagnosticAttrs) => {
        if (settled) {
          return;
        }
        settled = true;
        pushEntry({
          label: fullLabel,
          startTime,
          duration: performance.now() - startPerf,
          attrs: mergeAttrs(mergeAttrs(mergeAttrs(inheritedAttrs, attrs), failAttrs), {
            error: truncateError(error),
          }),
          status: 'error',
          kind: 'span',
        });
      },
    };
  };

  const measure = async <T>(
    label: string,
    fn: () => T | Promise<T>,
    attrs?: DiagnosticAttrs
  ): Promise<T> => {
    const span = start(label, attrs);
    try {
      const result = await fn();
      span.end();
      return result;
    } catch (error) {
      span.fail(error);
      throw error;
    }
  };

  const mark = (label: string, attrs?: DiagnosticAttrs): void => {
    pushEntry({
      label: prefixLabel(label),
      startTime: now(state),
      duration: 0,
      attrs: mergeAttrs(inheritedAttrs, attrs),
      status: 'ok',
      kind: 'mark',
    });
  };

  const gauge = (
    label: string,
    value: number,
    attrs?: DiagnosticAttrs,
    unit?: string
  ): void => {
    pushEntry({
      label: prefixLabel(label),
      startTime: now(state),
      duration: 0,
      attrs: mergeAttrs(inheritedAttrs, attrs),
      status: 'ok',
      kind: 'gauge',
      value,
      ...(unit === undefined ? {} : { unit }),
    });
  };

  const record = (entry: DiagnosticRecordInput): void => {
    pushEntry({
      label: prefixLabel(entry.label),
      startTime: now(state) - entry.duration,
      duration: entry.duration,
      attrs: mergeAttrs(inheritedAttrs, entry.attrs),
      status: entry.status ?? 'ok',
      kind: 'span',
    });
  };

  const child = (nsOrAttrs: string | DiagnosticAttrs): Diagnostics => {
    if (typeof nsOrAttrs === 'string') {
      const childNamespace = namespace ? `${namespace}.${nsOrAttrs}` : nsOrAttrs;
      return createEnabledDiagnostics(state, childNamespace, inheritedAttrs);
    }

    return createEnabledDiagnostics(
      state,
      namespace,
      mergeAttrs(inheritedAttrs, nsOrAttrs)
    );
  };

  const subscribe = (
    listener: DiagnosticEntryListener,
    options?: { replay?: boolean }
  ): (() => void) => {
    if (options?.replay) {
      for (const entry of [...state.entries]) {
        listener(entry);
      }
    }
    state.listeners.add(listener);
    return () => {
      state.listeners.delete(listener);
    };
  };

  const flush = (): DiagnosticEntry[] => {
    const flushed = state.entries;
    state.entries = [];
    return flushed;
  };

  return {
    enabled: true,
    start,
    measure,
    mark,
    gauge,
    record,
    child,
    subscribe,
    flush,
  };
};

export const createDiagnostics = (options?: { enabled?: boolean }): Diagnostics => {
  if (!options?.enabled) {
    return noopDiagnostics;
  }

  const state: RootState = {
    entries: [],
    listeners: new Set(),
    epochAnchor: Date.now(),
    perfAnchor: performance.now(),
  };

  return createEnabledDiagnostics(state, '', undefined);
};

export type InstrumentedOptions = {
  /**
   * Derives extra span attrs from a method's resolved return value, so a
   * wrapped module can surface facts about its result (for example the last
   * status line of a long wait) without calling diagnostics itself.
   */
  resultAttrs?: (method: string, result: unknown) => DiagnosticAttrs | undefined;
  /** Same as `resultAttrs`, for the error a method rejected or threw with. */
  errorAttrs?: (method: string, error: unknown) => DiagnosticAttrs | undefined;
};

const safeAttrs = <TValue>(
  derive: ((method: string, value: TValue) => DiagnosticAttrs | undefined) | undefined,
  method: string,
  value: TValue
): DiagnosticAttrs | undefined => {
  if (!derive) {
    return undefined;
  }

  try {
    return derive(method, value);
  } catch {
    return undefined;
  }
};

export const instrumented = <T extends object>(
  target: T,
  ns: string,
  diagnostics: Diagnostics,
  options?: InstrumentedOptions
): T => {
  if (!diagnostics.enabled) {
    return target;
  }

  const wrapped = new Map<PropertyKey, (...args: unknown[]) => unknown>();

  return new Proxy(target, {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver);

      if (typeof value !== 'function') {
        return value;
      }

      const cached = wrapped.get(prop);
      if (cached) {
        return cached;
      }

      const wrappedFn = (...args: unknown[]) => {
        const method = String(prop);
        const span = diagnostics.start(`${ns}.${method}`);

        let result: unknown;
        try {
          result = value.apply(obj, args);
        } catch (error) {
          span.fail(error, safeAttrs(options?.errorAttrs, method, error));
          throw error;
        }

        if (
          result &&
          typeof result === 'object' &&
          'then' in result &&
          typeof (result as { then: unknown }).then === 'function'
        ) {
          // Some thenables (e.g. nano-spawn's Subprocess) carry extra
          // properties/behavior beyond `.then()` (async iteration, a handle
          // to the underlying child process, etc). Calling `.then()` and
          // returning its result would collapse them into a plain Promise
          // and silently drop that shape, so track the span as a side
          // effect and always return the original object untouched.
          (result as Promise<unknown>).then(
            (value: unknown) =>
              span.end(safeAttrs(options?.resultAttrs, method, value)),
            (error: unknown) =>
              span.fail(error, safeAttrs(options?.errorAttrs, method, error))
          );
          return result;
        }

        span.end(safeAttrs(options?.resultAttrs, method, result));
        return result;
      };

      wrapped.set(prop, wrappedFn);
      return wrappedFn;
    },
  });
};
