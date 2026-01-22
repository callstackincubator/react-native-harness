import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  formatClientLogMessage,
  formatClientLogLine,
  handleClientLogEvent,
  createClientLogListener,
  type ClientLogEvent,
} from '../client-log-handler.js';

// Mock the log function
vi.mock('../logs.js', () => ({
  log: vi.fn(),
}));

import { log } from '../logs.js';

describe('client-log-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('formatClientLogMessage', () => {
    it('should format a single string', () => {
      const result = formatClientLogMessage(['Hello, world!']);
      expect(result).toBe('Hello, world!');
    });

    it('should join multiple strings with spaces', () => {
      const result = formatClientLogMessage(['Hello', 'world', '!']);
      expect(result).toBe('Hello world !');
    });

    it('should format objects', () => {
      const result = formatClientLogMessage([{ key: 'value' }]);
      // util.format uses inspect-style output for objects
      expect(result).toContain('key');
      expect(result).toContain('value');
    });

    it('should format arrays', () => {
      const result = formatClientLogMessage([[1, 2, 3]]);
      expect(result).toContain('1');
      expect(result).toContain('2');
      expect(result).toContain('3');
    });

    it('should handle mixed types', () => {
      const result = formatClientLogMessage([
        'Message:',
        { count: 42 },
        'items',
      ]);
      expect(result).toContain('Message:');
      expect(result).toContain('count');
      expect(result).toContain('42');
      expect(result).toContain('items');
    });

    it('should format numbers', () => {
      const result = formatClientLogMessage([123, 456]);
      expect(result).toBe('123 456');
    });

    it('should format booleans', () => {
      const result = formatClientLogMessage([true, false]);
      expect(result).toBe('true false');
    });

    it('should format null and undefined', () => {
      const result = formatClientLogMessage([null, undefined]);
      expect(result).toBe('null undefined');
    });

    it('should handle empty array', () => {
      const result = formatClientLogMessage([]);
      expect(result).toBe('');
    });

    describe('printf-style format specifiers', () => {
      it('should handle %s string substitution', () => {
        const result = formatClientLogMessage(['%s world', 'hello']);
        expect(result).toBe('hello world');
      });

      it('should handle %d integer substitution', () => {
        const result = formatClientLogMessage(['Count: %d', 42]);
        expect(result).toBe('Count: 42');
      });

      it('should handle %i integer substitution', () => {
        const result = formatClientLogMessage(['Value: %i', 123]);
        expect(result).toBe('Value: 123');
      });

      it('should handle %f float substitution', () => {
        const result = formatClientLogMessage(['Pi: %f', 3.14159]);
        expect(result).toContain('3.14159');
      });

      it('should handle multiple substitutions', () => {
        const result = formatClientLogMessage(['Hello %s, you have %d messages', 'Alice', 5]);
        expect(result).toBe('Hello Alice, you have 5 messages');
      });

      it('should handle %j JSON substitution', () => {
        const result = formatClientLogMessage(['Data: %j', { key: 'value' }]);
        expect(result).toBe('Data: {"key":"value"}');
      });

      it('should handle %o object substitution', () => {
        const result = formatClientLogMessage(['Object: %o', { a: 1 }]);
        // %o produces inspect-style output, just check it contains the key
        expect(result).toContain('a');
      });

      it('should handle %% as literal percent when substituting', () => {
        // %% is only converted to % when there are substitutions
        const result = formatClientLogMessage(['%s is 100%% complete', 'Task']);
        expect(result).toBe('Task is 100% complete');
      });

      it('should append extra arguments after substitution', () => {
        const result = formatClientLogMessage(['Hello %s', 'world', 'extra', 'args']);
        expect(result).toBe('Hello world extra args');
      });
    });
  });

  describe('formatClientLogLine', () => {
    it('should format log level event', () => {
      const event: ClientLogEvent = {
        type: 'client_log',
        level: 'log',
        data: ['Test message'],
      };
      const result = formatClientLogLine(event);
      // The result will contain ANSI codes for styling, so we check it contains the message
      expect(result).toContain('Test message');
    });

    it('should format error level event', () => {
      const event: ClientLogEvent = {
        type: 'client_log',
        level: 'error',
        data: ['Error occurred'],
      };
      const result = formatClientLogLine(event);
      expect(result).toContain('Error occurred');
    });

    it('should format warn level event', () => {
      const event: ClientLogEvent = {
        type: 'client_log',
        level: 'warn',
        data: ['Warning message'],
      };
      const result = formatClientLogLine(event);
      expect(result).toContain('Warning message');
    });

    it('should format info level event', () => {
      const event: ClientLogEvent = {
        type: 'client_log',
        level: 'info',
        data: ['Info message'],
      };
      const result = formatClientLogLine(event);
      expect(result).toContain('Info message');
    });

    it('should format debug level event', () => {
      const event: ClientLogEvent = {
        type: 'client_log',
        level: 'debug',
        data: ['Debug message'],
      };
      const result = formatClientLogLine(event);
      expect(result).toContain('Debug message');
    });

    it('should format trace level event', () => {
      const event: ClientLogEvent = {
        type: 'client_log',
        level: 'trace',
        data: ['Trace message'],
      };
      const result = formatClientLogLine(event);
      expect(result).toContain('Trace message');
    });

    it('should handle multiple data items', () => {
      const event: ClientLogEvent = {
        type: 'client_log',
        level: 'log',
        data: ['User:', { id: 1, name: 'Test' }],
      };
      const result = formatClientLogLine(event);
      expect(result).toContain('User:');
      expect(result).toContain('id');
      expect(result).toContain('Test');
    });
  });

  describe('handleClientLogEvent', () => {
    it('should handle client_log events and call log', () => {
      const event: ClientLogEvent = {
        type: 'client_log',
        level: 'log',
        data: ['Test message'],
      };

      const result = handleClientLogEvent(event);

      expect(result).toBe(true);
      expect(log).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Test message'));
    });

    it('should return false for non-client_log events', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const event = { type: 'bundle_build_started' } as any;

      const result = handleClientLogEvent(event);

      expect(result).toBe(false);
      expect(log).not.toHaveBeenCalled();
    });

    it('should handle error level logs', () => {
      const event: ClientLogEvent = {
        type: 'client_log',
        level: 'error',
        data: ['Something went wrong'],
      };

      handleClientLogEvent(event);

      expect(log).toHaveBeenCalledWith(
        expect.stringContaining('Something went wrong')
      );
    });

    it('should handle warn level logs', () => {
      const event: ClientLogEvent = {
        type: 'client_log',
        level: 'warn',
        data: ['Deprecation warning'],
      };

      handleClientLogEvent(event);

      expect(log).toHaveBeenCalledWith(
        expect.stringContaining('Deprecation warning')
      );
    });
  });

  describe('createClientLogListener', () => {
    it('should create a listener function', () => {
      const listener = createClientLogListener();
      expect(typeof listener).toBe('function');
    });

    it('should handle client_log events when called', () => {
      const listener = createClientLogListener();
      const event: ClientLogEvent = {
        type: 'client_log',
        level: 'info',
        data: ['Listener test'],
      };

      listener(event);

      expect(log).toHaveBeenCalledWith(expect.stringContaining('Listener test'));
    });

    it('should ignore non-client_log events', () => {
      const listener = createClientLogListener();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const event = { type: 'initialize_done' } as any;

      listener(event);

      expect(log).not.toHaveBeenCalled();
    });
  });

  describe('group events', () => {
    it('should handle group events without logging', () => {
      const event: ClientLogEvent = {
        type: 'client_log',
        level: 'group',
        data: ['Group label'],
      };

      const result = handleClientLogEvent(event);

      expect(result).toBe(true);
      expect(log).not.toHaveBeenCalled();
    });

    it('should handle groupCollapsed events without logging', () => {
      const event: ClientLogEvent = {
        type: 'client_log',
        level: 'groupCollapsed',
        data: ['Collapsed'],
      };

      const result = handleClientLogEvent(event);

      expect(result).toBe(true);
      expect(log).not.toHaveBeenCalled();
    });

    it('should handle groupEnd events without logging', () => {
      const event: ClientLogEvent = {
        type: 'client_log',
        level: 'groupEnd',
        data: [],
      };

      const result = handleClientLogEvent(event);

      expect(result).toBe(true);
      expect(log).not.toHaveBeenCalled();
    });
  });
});
