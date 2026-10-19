/**
 * Resolves on a later macrotask, so the native side can deliver pending
 * WebSocket messages in both directions before the JS thread continues.
 * A microtask is not enough to receive messages: incoming ones are only
 * dispatched once the current task gives up the thread.
 */
export const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Lets events emitted so far reach the socket before code that may block the
 * JS thread starts. The bridge hands a message to `WebSocket.send` one
 * microtask after it is emitted, and the native WebSocket sends it from
 * there even while JS stays blocked, so a microtask hop is enough. It is
 * much cheaper than `yieldToEventLoop`, whose timer can wait for the next
 * frame, which matters because it runs before every test.
 */
export const flushOutgoingMessages = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};
