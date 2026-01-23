declare module 'react-native/Libraries/Core/Devtools/getDevServer' {
  export type DevServerInfo = {
    url: string;
    fullBundleUrl?: string;
    bundleLoadedFromServer: boolean;
  };
  export default function getDevServer(): DevServerInfo;
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
