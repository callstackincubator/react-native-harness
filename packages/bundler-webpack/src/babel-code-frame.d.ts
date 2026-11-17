// `@babel/code-frame` ships no types, and nothing in the workspace carries them.
declare module '@babel/code-frame' {
  export function codeFrameColumns(
    source: string,
    location: {
      start: { line: number; column?: number };
      end?: { line: number; column?: number };
    },
    options?: { forceColor?: boolean; highlightCode?: boolean }
  ): string;
}
