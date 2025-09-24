import type { CodeFrame } from '@react-native-harness/bridge';
import parseErrorStack from 'react-native/Libraries/Core/Devtools/parseErrorStack';
import symbolicateStackTrace from 'react-native/Libraries/Core/Devtools/symbolicateStackTrace';

export const getCodeFrame = async (error: Error): Promise<CodeFrame | null> => {
  const parsedStack = parseErrorStack(error.stack);
  const symbolicatedStack = await symbolicateStackTrace(parsedStack);

  if (!symbolicatedStack.codeFrame) {
    return null;
  }

  // Normalize optionality (null -> undefined)
  return {
    ...symbolicatedStack.codeFrame,
    location: symbolicatedStack.codeFrame.location
      ? {
          ...symbolicatedStack.codeFrame.location,
        }
      : undefined,
  };
};
