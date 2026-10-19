/**
 * Resolves on a later macrotask, so the native side can deliver pending
 * WebSocket messages in both directions before the JS thread continues.
 * A microtask is not enough: it runs before the current task gives up the
 * thread.
 */
export const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));
