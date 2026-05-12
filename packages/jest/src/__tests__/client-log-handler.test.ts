import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createClientLogCollector,
  formatClientLogMessage,
  formatClientLogEntry,
  type ClientLogEvent,
} from '../client-log-handler.js';

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
        const result = formatClientLogMessage([
          'Hello %s, you have %d messages',
          'Alice',
          5,
        ]);
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
        const result = formatClientLogMessage([
          'Hello %s',
          'world',
          'extra',
          'args',
        ]);
        expect(result).toBe('Hello world extra args');
      });
    });
  });

  describe('formatClientLogEntry', () => {
    it('should format log level event', () => {
      const event: ClientLogEvent = {
        type: 'client_log',
        level: 'log',
        data: ['Test message'],
      };
      const result = formatClientLogEntry(event);
      expect(result).toEqual({
        message: 'Test message',
        origin: '',
        type: 'log',
      });
    });

    it('should format error level event', () => {
      const event: ClientLogEvent = {
        type: 'client_log',
        level: 'error',
        data: ['Error occurred'],
      };
      const result = formatClientLogEntry(event);
      expect(result).toEqual({
        message: 'Error occurred',
        origin: '',
        type: 'error',
      });
    });

    it('should format warn level event', () => {
      const event: ClientLogEvent = {
        type: 'client_log',
        level: 'warn',
        data: ['Warning message'],
      };
      const result = formatClientLogEntry(event);
      expect(result).toEqual({
        message: 'Warning message',
        origin: '',
        type: 'warn',
      });
    });

    it('should format info level event', () => {
      const event: ClientLogEvent = {
        type: 'client_log',
        level: 'info',
        data: ['Info message'],
      };
      const result = formatClientLogEntry(event);
      expect(result).toEqual({
        message: 'Info message',
        origin: '',
        type: 'info',
      });
    });

    it('should format debug level event', () => {
      const event: ClientLogEvent = {
        type: 'client_log',
        level: 'debug',
        data: ['Debug message'],
      };
      const result = formatClientLogEntry(event);
      expect(result).toEqual({
        message: 'Debug message',
        origin: '',
        type: 'debug',
      });
    });

    it('should format trace level event', () => {
      const event: ClientLogEvent = {
        type: 'client_log',
        level: 'trace',
        data: ['Trace message'],
      };
      const result = formatClientLogEntry(event);
      expect(result).toEqual({
        message: 'Trace message',
        origin: '',
        type: 'log',
      });
    });

    it('should handle multiple data items', () => {
      const event: ClientLogEvent = {
        type: 'client_log',
        level: 'log',
        data: ['User:', { id: 1, name: 'Test' }],
      };
      const result = formatClientLogEntry(event);
      expect(result?.message).toContain('User:');
      expect(result?.message).toContain('id');
      expect(result?.message).toContain('Test');
    });
  });

  describe('createClientLogCollector', () => {
    it('collects client_log events and flushes them', () => {
      const collector = createClientLogCollector();
      const event: ClientLogEvent = {
        type: 'client_log',
        level: 'log',
        data: ['Test message'],
      };

      collector.handleEvent(event);

      expect(collector.flush()).toEqual([
        {
          message: 'Test message',
          origin: '',
          type: 'log',
        },
      ]);
    });

    it('returns an empty array for non-client_log events', () => {
      const collector = createClientLogCollector();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const event = { type: 'bundle_build_started' } as any;

      collector.handleEvent(event);

      expect(collector.flush()).toEqual([]);
    });

    it('collects error level logs', () => {
      const collector = createClientLogCollector();
      const event: ClientLogEvent = {
        type: 'client_log',
        level: 'error',
        data: ['Something went wrong'],
      };

      collector.handleEvent(event);

      expect(collector.flush()).toEqual([
        {
          message: 'Something went wrong',
          origin: '',
          type: 'error',
        },
      ]);
    });

    it('collects warn level logs', () => {
      const collector = createClientLogCollector();
      const event: ClientLogEvent = {
        type: 'client_log',
        level: 'warn',
        data: ['Deprecation warning'],
      };

      collector.handleEvent(event);

      expect(collector.flush()).toEqual([
        {
          message: 'Deprecation warning',
          origin: '',
          type: 'warn',
        },
      ]);
    });

    it('flush clears the buffer', () => {
      const collector = createClientLogCollector();

      collector.handleEvent({
        type: 'client_log',
        level: 'info',
        data: ['Listener test'],
      });

      expect(collector.flush()).toEqual([
        {
          message: 'Listener test',
          origin: '',
          type: 'info',
        },
      ]);
      expect(collector.flush()).toEqual([]);
    });

    it('ignores non-client_log events', () => {
      const collector = createClientLogCollector();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const event = { type: 'initialize_done' } as any;

      collector.handleEvent(event);

      expect(collector.flush()).toEqual([]);
    });

    it('ignores group events', () => {
      const collector = createClientLogCollector();
      const event: ClientLogEvent = {
        type: 'client_log',
        level: 'group',
        data: ['Group label'],
      };

      collector.handleEvent(event);

      expect(collector.flush()).toEqual([]);
    });

    it('ignores groupCollapsed events', () => {
      const collector = createClientLogCollector();
      const event: ClientLogEvent = {
        type: 'client_log',
        level: 'groupCollapsed',
        data: ['Collapsed'],
      };

      collector.handleEvent(event);

      expect(collector.flush()).toEqual([]);
    });

    it('ignores groupEnd events', () => {
      const collector = createClientLogCollector();
      const event: ClientLogEvent = {
        type: 'client_log',
        level: 'groupEnd',
        data: [],
      };

      collector.handleEvent(event);

      expect(collector.flush()).toEqual([]);
    });
  });
});
