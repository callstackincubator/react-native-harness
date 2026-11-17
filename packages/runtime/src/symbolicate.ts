import type { CodeFrame } from '@react-native-harness/bridge';
import { getHost, type StackFrame } from './host.js';

export type RNCodeFrame = Readonly<{
  content: string;
  location:
  | {
    row: number;
    column: number;
    [key: string]: unknown;
  }
  | null
  | undefined;
  fileName: string;
}>;

export type RNSymbolicatedStackTrace = Readonly<{
  stack: ReadonlyArray<StackFrame>;
  codeFrame: CodeFrame | null | undefined;
}>;


const symbolicateStackTrace = async (stack: ReadonlyArray<StackFrame>, extraData?: unknown): Promise<RNSymbolicatedStackTrace> => {
  const devServerUrl = getHost().getDevServerUrl();
  const response = await fetch(devServerUrl + 'symbolicate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ stack, extraData }),
  });
  return await response.json();
}

export const getCodeFrame = async (error: Error): Promise<CodeFrame | null> => {
  const parsedStack = getHost().parseErrorStack(error.stack);
  const symbolicatedStack = await symbolicateStackTrace(parsedStack);

  if (!('codeFrame' in symbolicatedStack) || !symbolicatedStack.codeFrame) {
    return null;
  }

  const codeFrame = symbolicatedStack.codeFrame as CodeFrame;

  // Normalize optionality (null -> undefined)
  return {
    ...codeFrame,
    location: codeFrame.location
      ? {
        ...codeFrame.location,
      }
      : undefined,
  };
};
