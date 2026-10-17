export const KIB = 1024;
export const MAX_DATA_BYTES = 64 * KIB;
export const CHANNEL_WINDOW = 4 * KIB * KIB;
export const MAX_CHANNEL_NUMBER = 0xffffffff;

export const ENVELOPE = { OPEN: 1, DATA: 2, END: 3, STOP: 4, CREDIT: 5, RESET: 6 } as const;
export type EnvelopeType = (typeof ENVELOPE)[keyof typeof ENVELOPE];

const RESET_CODES = { aborted: 1, stalled: 2, "not-accepted": 3, invalid: 4 } as const;
export type ResetReason = keyof typeof RESET_CODES;

const HEADER_BYTES = 5;
const CHANNEL_ID = /^[A-Za-z0-9-]{1,32}$/;

export interface ParsedEnvelope {
  readonly type: number;
  readonly number: number;
  readonly payload: Uint8Array;
}

export function encodeEnvelope(
  type: EnvelopeType,
  number: number,
  payload: Uint8Array = new Uint8Array(0),
): Uint8Array {
  const bytes = new Uint8Array(HEADER_BYTES + payload.length);
  bytes[0] = type;
  new DataView(bytes.buffer).setUint32(1, number);
  bytes.set(payload, HEADER_BYTES);
  return bytes;
}

export function encodeCredit(number: number, amount: number): Uint8Array {
  const payload = new Uint8Array(4);
  new DataView(payload.buffer).setUint32(0, amount);
  return encodeEnvelope(ENVELOPE.CREDIT, number, payload);
}

export function encodeReset(number: number, reason: ResetReason): Uint8Array {
  return encodeEnvelope(ENVELOPE.RESET, number, new Uint8Array([RESET_CODES[reason]]));
}

export function parseEnvelope(bytes: Uint8Array): ParsedEnvelope | undefined {
  if (bytes.length < HEADER_BYTES) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { number: view.getUint32(1), payload: bytes.slice(HEADER_BYTES), type: bytes[0] ?? 0 };
}

export function isEnvelopeType(type: number): type is EnvelopeType {
  return type >= ENVELOPE.OPEN && type <= ENVELOPE.RESET;
}

export function parseCredit(payload: Uint8Array): number | undefined {
  if (payload.length !== 4) return undefined;
  return new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(0);
}

export function parseResetReason(payload: Uint8Array): ResetReason | undefined {
  const code = payload[0];
  for (const [reason, value] of Object.entries(RESET_CODES)) {
    if (value === code) return reason as ResetReason;
  }
  return undefined;
}

// why: counted the way Buffer.byteLength counts, so the link needs no Buffer (a browser has none).
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let at = 0; at < text.length; at += 1) {
    const code = text.charCodeAt(at);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && isLowSurrogate(text.charCodeAt(at + 1))) {
      bytes += 4;
      at += 1;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

export function isChannelId(id: string): boolean {
  return CHANNEL_ID.test(id);
}

export function parseChannelId(payload: Uint8Array): string | undefined {
  const id = decodeAscii(payload);
  return isChannelId(id) ? id : undefined;
}

// harness: channel ids are ASCII, so the link needs no TextEncoder or TextDecoder (not every
// Hermes has TextDecoder). A byte over 0x7f decodes to a character the id pattern refuses.
export function encodeAscii(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let at = 0; at < text.length; at += 1) bytes[at] = text.charCodeAt(at) & 0xff;
  return bytes;
}

function decodeAscii(bytes: Uint8Array): string {
  let text = "";
  for (let at = 0; at < bytes.length; at += 1) text += String.fromCharCode(bytes[at] ?? 0);
  return text;
}
