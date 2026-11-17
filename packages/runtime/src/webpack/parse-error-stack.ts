import type { StackFrame } from '../host.js';

// "    at fn (http://host/file.js:10:5)" and "    at http://host/file.js:10:5"
const V8_FRAME = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/;
// "fn@http://host/file.js:10:5" and "@http://host/file.js:10:5"
const GECKO_FRAME = /^(.*?)@(.+?):(\d+):(\d+)\s*$/;

const toFrame = (
  methodName: string | undefined,
  file: string,
  line: string,
  column: string
): StackFrame => ({
  methodName: methodName || '<unknown>',
  file,
  lineNumber: Number(line),
  column: Number(column),
});

/**
 * Parses the `stack` of a browser error: the V8 format (Chromium) and the
 * format of Firefox and Safari. Lines that are not frames are dropped.
 */
export const parseErrorStack = (stack?: string): StackFrame[] => {
  if (!stack) {
    return [];
  }

  const frames: StackFrame[] = [];

  for (const line of stack.split('\n')) {
    const match = V8_FRAME.exec(line) ?? GECKO_FRAME.exec(line);

    if (match) {
      frames.push(toFrame(match[1], match[2], match[3], match[4]));
    }
  }

  return frames;
};
