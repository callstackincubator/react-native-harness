import type { LinkChannel, LinkConnection } from './link/index.js';

export type OutgoingBinary = {
  channelId: string;
  /** Settles once every byte is handed to the link, or rejects if the channel fails. */
  written: Promise<void>;
  abort: (reason?: string) => void;
};

/**
 * Opens a link channel and starts writing `data` into it. The channel id travels in an
 * RPC message; the peer reads the bytes with `receiveBinary`. The link sends the channel's
 * OPEN before any later message, so the peer always knows the id by the time it asks.
 */
export const sendBinary = async (
  link: LinkConnection,
  data: Uint8Array,
): Promise<OutgoingBinary> => {
  const channel = await link.openChannel({
    signal: new AbortController().signal,
  });

  const written = (async () => {
    const writer = channel.writable.getWriter();
    await writer.write(data);
    await writer.close();
  })();

  return {
    channelId: channel.id,
    written,
    abort: (reason) => channel.abort(reason),
  };
};

const readAll = async (channel: LinkChannel): Promise<Uint8Array> => {
  const reader = channel.readable.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    chunks.push(value);
    size += value.length;
  }

  const bytes = new Uint8Array(size);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }

  return bytes;
};

/** Accepts the channel the peer opened with `sendBinary` and reads it to the end. */
export const receiveBinary = async (
  link: LinkConnection,
  channelId: string,
): Promise<Uint8Array> => {
  const channel = link.acceptChannel(channelId);

  // Nothing flows back to the sender; ending this direction lets the channel free its slot.
  void channel.writable.close().catch(() => undefined);

  return readAll(channel);
};
