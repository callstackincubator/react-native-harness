# Link

A copy of the link from [simlock](https://github.com/callstackincubator/simlock)
(`src/link/`, commit `b730ef37536b51ebdb37d076e7592954c32d0904`), plus the
standard `WebSocket` transport from simlock's browser link check.

The link wraps one WebSocket and carries two kinds of traffic:

- **Text messages** (`write` / `onData`): the bridge's JSON RPC, events, and
  heartbeat ping/pong. They go in the priority lane, so they are never stuck
  behind a large transfer.
- **Byte channels** (`openChannel` / `acceptChannel`): raw bytes as
  `ReadableStream` / `WritableStream`, in 64 KiB frames with per-channel credit.
  The bridge uses them for screenshots (`../binary.ts`).

See simlock's `src/link/AGENTS.md` for the wire format, limits and rules.

## Harness changes

Keep the files close to upstream so they are easy to sync. Changes are marked
with `harness:` comments:

- `ports.ts` holds the port types the link imports from simlock's `src/ports`,
  plus `globalClock`.
- `streams.ts` uses the global WHATWG streams when present and the
  `web-streams-polyfill` ponyfill otherwise (React Native). It never installs
  globals.
- `envelope.ts` encodes channel ids as ASCII instead of using
  `TextEncoder`/`TextDecoder`.
- `standard-websocket.ts` treats a missing `bufferedAmount` as `0`, since React
  Native's `WebSocket` never sets it.
- `__tests__/` holds upstream's link tests. The in-memory pair and `FakeClock`
  come from simlock's ports, and the WebSocket pair uses `ws` with
  `StandardWebSocketConnection` on both ends.

## React Native notes

- React Native's `WebSocket` base64-encodes binary frames on the way to the
  native module. The protocol is binary, but stock React Native still pays for
  that encoding inside the socket.
- With no `bufferedAmount`, the link cannot see the socket's send buffer, so
  only per-channel credit (4 MiB) limits how much is in flight.
- There is no `crypto.randomUUID`, so the client passes `generateId`.
