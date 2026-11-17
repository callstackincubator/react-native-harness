import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeFrameColumns } from '@babel/code-frame';
import { TraceMap, traceSegment } from '@jridgewell/trace-mapping';

/** A frame as the runtime sends it, and as Metro answers it. `column` counts from 0. */
export type StackFrame = {
  methodName?: string;
  file?: string | null;
  lineNumber?: number | null;
  column?: number | null;
  collapse?: boolean;
};

export type CodeFrame = {
  content: string;
  location: { row: number; column: number };
  fileName: string;
};

export type SymbolicatedStack = {
  stack: StackFrame[];
  codeFrame: CodeFrame | null;
};

export type SymbolicateOptions = {
  /** Source map of a script, by the URL the browser loaded it from. */
  getSourceMap: (url: string) => Promise<TraceMap | null>;
  /** Where a source path that is relative to the build resolves from. */
  context: string;
  /** Whether a file is Harness's own code or a dependency, to skip in a code frame. */
  isInternalFile: (file: string) => boolean;
};

// "webpack://<namespace>/./src/a.ts". The namespace can hold slashes (it is
// the package name by default), so the path starts at the first `./` or `../`.
const NAMESPACED_SOURCE = /^webpack:\/\/.*?\/(\.{1,2}\/.*)$/;
// "webpack://<namespace>//abs/path", with an empty namespace for the common
// `webpack:///[absolute-resource-path]` (`webpack:////abs/path`). Lazy, so that
// a namespace holding slashes ends at the first `//`.
const NAMESPACED_ABSOLUTE_SOURCE = /^webpack:\/\/.*?\/(\/.*)$/;
// "webpack:///abs/path": no namespace and the path as it is.
const BARE_ABSOLUTE_SOURCE = /^webpack:\/\/(\/.*)$/;
// `webpack:`, `webpack-internal:` and the like, which name no file.
const OTHER_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

const NODE_MODULES = /(^|[\\/])node_modules([\\/]|$)/;

/**
 * The file a source name in a map stands for, or null when it stands for none
 * (the bundler's runtime, an external module). Maps name sources by whatever
 * `devtoolModuleFilenameTemplate` says: a namespaced `webpack://` name, a
 * `file:` URL, an absolute path, or a path relative to the build's context. A
 * relative one names a file only if the file is there.
 */
export const resolveSourcePath = (
  source: string,
  context: string
): string | null => {
  if (source.startsWith('file:')) {
    try {
      return path.normalize(fileURLToPath(source));
    } catch {
      return null;
    }
  }

  if (path.isAbsolute(source)) {
    return source;
  }

  const namespaced = NAMESPACED_SOURCE.exec(source);

  if (namespaced) {
    return path.resolve(context, namespaced[1]);
  }

  const absolute =
    NAMESPACED_ABSOLUTE_SOURCE.exec(source) ?? BARE_ABSOLUTE_SOURCE.exec(source);

  if (absolute && path.isAbsolute(absolute[1])) {
    return path.normalize(absolute[1]);
  }

  if (OTHER_SCHEME.test(source)) {
    return null;
  }

  const resolved = path.resolve(context, source);

  return fs.existsSync(resolved) ? resolved : null;
};

const toRequestPath = (file: string): string | null => {
  try {
    return new URL(file).pathname;
  } catch {
    return null;
  }
};

const mapFrame = async (
  frame: StackFrame,
  { getSourceMap, context, isInternalFile }: SymbolicateOptions
): Promise<{ frame: StackFrame; source?: string }> => {
  const { file, lineNumber, column } = frame;

  if (typeof file !== 'string' || typeof lineNumber !== 'number') {
    return { frame };
  }

  const map = toRequestPath(file) ? await getSourceMap(file) : null;
  // The segment, not `originalPositionFor`: that one resolves the source name
  // as a URL, which drops the `./` that marks where the path starts.
  const segment = map ? traceSegment(map, lineNumber - 1, column ?? 0) : null;

  if (!map || !segment || segment.length === 1) {
    return { frame };
  }

  const [, sourceIndex, line, originalColumn] = segment;
  const source = map.sources[sourceIndex];

  if (source == null) {
    return { frame };
  }

  const resolved = resolveSourcePath(source, context);

  return {
    frame: {
      ...frame,
      file: resolved ?? source,
      lineNumber: line + 1,
      column: originalColumn,
      // A source that is no file is the bundler's runtime.
      collapse:
        resolved === null ||
        NODE_MODULES.test(resolved) ||
        isInternalFile(resolved),
    },
    source: map.sourcesContent?.[sourceIndex] ?? undefined,
  };
};

const readSource = (file: string, fallback?: string): string | null => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return fallback ?? null;
  }
};

/**
 * The first frame that is not collapsed, as Metro picks it, or the first one
 * with a position when every frame is collapsed. Frames that no source map
 * explained are skipped: their file is still a URL.
 */
const createCodeFrame = (
  frames: StackFrame[],
  sources: Array<string | undefined>
): CodeFrame | null => {
  const allCollapsed = frames.every((frame) => frame.collapse);

  for (const [index, frame] of frames.entries()) {
    const { file, lineNumber, column } = frame;

    if (
      (!allCollapsed && frame.collapse) ||
      typeof file !== 'string' ||
      typeof lineNumber !== 'number' ||
      !path.isAbsolute(file)
    ) {
      continue;
    }

    const content = readSource(file, sources[index]);

    if (content === null) {
      continue;
    }

    return {
      content: codeFrameColumns(
        content,
        { start: { column: (column ?? 0) + 1, line: lineNumber } },
        { forceColor: true }
      ),
      location: { row: lineNumber, column: column ?? 0 },
      fileName: file,
    };
  }

  return null;
};

/**
 * Maps the frames of a browser stack back to the original files through the
 * source maps of the build, and builds the code frame Metro would send.
 */
export const symbolicateStack = async (
  stack: StackFrame[],
  options: SymbolicateOptions
): Promise<SymbolicatedStack> => {
  const mapped = await Promise.all(
    stack.map((frame) => mapFrame(frame, options))
  );
  const frames = mapped.map(({ frame }) => frame);

  return {
    stack: frames,
    codeFrame: createCodeFrame(
      frames,
      mapped.map(({ source }) => source)
    ),
  };
};
