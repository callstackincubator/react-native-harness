import type { BridgeEvents, DeviceDescriptor } from './shared.js';

export type SerializedBridgeError = {
  name: string;
  message: string;
  stack?: string;
  cause?: unknown;
};

export type BridgeInvokeMessage = {
  type: 'invoke';
  id: number;
  method: string;
  args: unknown[];
};

export type BridgeReturnMessage =
  | {
      type: 'return';
      id: number;
      ok: true;
      value?: unknown;
    }
  | {
      type: 'return';
      id: number;
      ok: false;
      error: SerializedBridgeError;
    };

export type BridgeEventMessage<Event extends { type: string } = BridgeEvents> = {
  type: 'event';
  event: Event;
};

export type BridgeReadyMessage = {
  type: 'ready';
  device: DeviceDescriptor;
};

export type BridgePingMessage = {
  type: 'ping';
  id: number;
};

export type BridgePongMessage = {
  type: 'pong';
  id: number;
};

export type BridgeControlMessage =
  | BridgeReadyMessage
  | BridgePingMessage
  | BridgePongMessage;

export type BridgeMessage<Event extends { type: string } = BridgeEvents> =
  | BridgeInvokeMessage
  | BridgeReturnMessage
  | BridgeEventMessage<Event>
  | BridgeControlMessage;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const readNumber = (value: unknown, fieldName: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid bridge message: ${fieldName} must be a number`);
  }

  return value;
};

const readString = (value: unknown, fieldName: string): string => {
  if (typeof value !== 'string') {
    throw new Error(`Invalid bridge message: ${fieldName} must be a string`);
  }

  return value;
};

const readSerializedBridgeError = (value: unknown): SerializedBridgeError => {
  if (!isRecord(value)) {
    throw new Error('Invalid bridge message: error must be an object');
  }

  const name = readString(value.name, 'error.name');
  const message = readString(value.message, 'error.message');

  if (value.stack !== undefined) {
    readString(value.stack, 'error.stack');
  }

  const stack = value.stack as string | undefined;

  return {
    name,
    message,
    stack,
    cause: value.cause,
  };
};

const readDeviceDescriptor = (value: unknown): DeviceDescriptor => {
  if (!isRecord(value)) {
    throw new Error('Invalid bridge message: device must be an object');
  }

  return {
    platform: readString(value.platform, 'device.platform') as DeviceDescriptor['platform'],
    manufacturer: readString(value.manufacturer, 'device.manufacturer'),
    model: readString(value.model, 'device.model'),
    osVersion: readString(value.osVersion, 'device.osVersion'),
  };
};

const readBridgeEvent = (value: unknown): BridgeEvents => {
  if (!isRecord(value)) {
    throw new Error('Invalid bridge message: event must be an object');
  }

  readString(value.type, 'event.type');

  return value as BridgeEvents;
};

export const serializeBridgeMessage = (
  message: BridgeMessage,
): string => {
  return JSON.stringify(message);
};

export const parseBridgeMessage = (raw: string): BridgeMessage => {
  const parsed: unknown = JSON.parse(raw);

  if (!isRecord(parsed)) {
    throw new Error('Invalid bridge message: expected an object');
  }

  const messageType = readString(parsed.type, 'type');

  switch (messageType) {
    case 'invoke': {
      readNumber(parsed.id, 'id');
      readString(parsed.method, 'method');

      if (!Array.isArray(parsed.args)) {
        throw new Error('Invalid bridge message: args must be an array');
      }

      return parsed as BridgeInvokeMessage;
    }
    case 'return': {
      readNumber(parsed.id, 'id');

      if (typeof parsed.ok !== 'boolean') {
        throw new Error('Invalid bridge message: ok must be a boolean');
      }

      if (!parsed.ok) {
        readSerializedBridgeError(parsed.error);
      }

      return parsed as BridgeReturnMessage;
    }
    case 'event': {
      readBridgeEvent(parsed.event);
      return parsed as BridgeEventMessage;
    }
    case 'ready': {
      readDeviceDescriptor(parsed.device);
      return parsed as BridgeReadyMessage;
    }
    case 'ping':
    case 'pong': {
      readNumber(parsed.id, 'id');
      return parsed as BridgePingMessage | BridgePongMessage;
    }
    default:
      throw new Error(`Invalid bridge message: unknown type ${messageType}`);
  }
};

export const serializeBridgeError = (
  error: unknown,
): SerializedBridgeError => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause,
    };
  }

  if (isRecord(error)) {
    const message =
      typeof error.message === 'string'
        ? error.message
        : `Non-Error thrown value: ${String(error)}`;

    return {
      name: typeof error.name === 'string' ? error.name : 'NonErrorThrown',
      message,
      stack: typeof error.stack === 'string' ? error.stack : undefined,
      cause: 'cause' in error ? error.cause : undefined,
    };
  }

  return {
    name: 'NonErrorThrown',
    message:
      typeof error === 'string'
        ? error
        : `Non-Error thrown value: ${String(error)}`,
  };
};

export const deserializeBridgeError = (
  serialized: SerializedBridgeError,
): Error => {
  const error = new Error(serialized.message, {
    cause: serialized.cause,
  });

  error.name = serialized.name;

  if (serialized.stack) {
    error.stack = serialized.stack;
  }

  return error;
};
