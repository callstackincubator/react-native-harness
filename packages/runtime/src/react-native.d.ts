declare module 'react-native/Libraries/Core/Devtools/getDevServer' {
  export type DevServerInfo = {
    url: string;
    fullBundleUrl?: string;
    bundleLoadedFromServer: boolean;
  };
  export default function getDevServer(): DevServerInfo;
}

declare module 'react-native/Libraries/Core/Devtools/symbolicateStackTrace' {
  import { StackFrame } from 'react-native/Libraries/Core/Devtools/parseErrorStack';

  export type CodeFrame = Readonly<{
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

  export type SymbolicatedStackTrace = Readonly<{
    stack: ReadonlyArray<StackFrame>;
    codeFrame: CodeFrame | null | undefined;
  }>;

  export default function symbolicateStackTrace(
    stack: ReadonlyArray<StackFrame>,
    extraData?: unknown
  ): Promise<SymbolicatedStackTrace>;
}

declare module 'react-native/Libraries/Core/Devtools/parseErrorStack' {
  export type StackFrame = {
    column: number | null | undefined;
    file: string | null | undefined;
    lineNumber: number | null | undefined;
    methodName: string;
  };
  export default function parseErrorStack(errorStack?: string): StackFrame[];
}
