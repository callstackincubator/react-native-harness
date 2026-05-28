import { HarnessError } from '@react-native-harness/tools';

export class DeviceNotRespondingError extends HarnessError {
  constructor(
    public readonly functionName: string,
    public readonly args: unknown[]
  ) {
    super('The device did not respond within the timeout period.');
    this.name = 'DeviceNotRespondingError';
  }
}

export type AppBridgeDisconnectedReason =
  | 'app-disconnected'
  | 'app-replaced'
  | 'heartbeat-timeout'
  | 'socket-error'
  | 'bridge-disposed';

const appBridgeDisconnectedMessage = (
  reason: AppBridgeDisconnectedReason,
): string => {
  switch (reason) {
    case 'app-replaced':
      return 'The app bridge was replaced by a newer app connection. This can happen when the app reloads, restarts, or reconnects while a test file is still running.';
    case 'heartbeat-timeout':
      return 'The app bridge stopped responding during test execution. This can happen if the app was killed, crashed, became unresponsive, or lost its WebSocket connection.';
    case 'socket-error':
      return 'The app bridge connection failed during test execution. This can happen if the app was killed, crashed, or the underlying WebSocket connection closed unexpectedly.';
    case 'bridge-disposed':
      return 'The app bridge was disposed before the test file finished running.';
    case 'app-disconnected':
      return 'The app bridge disconnected during test execution. This can happen if the app was killed, crashed, reloaded, or restarted while the test file was running.';
  }
};

export class AppBridgeDisconnectedError extends HarnessError {
  constructor(public readonly reason: AppBridgeDisconnectedReason) {
    super(appBridgeDisconnectedMessage(reason));
    this.name = 'AppBridgeDisconnectedError';
    this.stack = `${this.name}: ${this.message}`;
  }
}
