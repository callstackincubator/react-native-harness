/**
 * The chunk plan lets the runtime evaluate a test bundle in several `eval`
 * calls, yielding to the event loop between them, instead of blocking the
 * JS thread for one long parse. See docs/adr/0001-app-liveness-detection.md.
 *
 * The Metro serializer appends the plan as a comment after all code, so the
 * bundle stays valid JavaScript with unchanged line numbers, and a runtime
 * that ignores the plan can still evaluate it whole.
 *
 * This module must not import React Native: the Metro serializer (Node)
 * imports it too.
 */

export const CHUNK_PLAN_MARKER = '\n//# harnessChunks=';
export const DEFAULT_CHUNK_TARGET_BYTES = 256 * 1024;

type SerializedChunkPlan = {
  /** `[offset, line]` of each chunk's first character, zero-based. */
  chunks: Array<[number, number]>;
  sourceUrl?: string;
};

export type BundleChunk = {
  start: number;
  end: number;
  /** Zero-based line of the bundle that the chunk starts on. */
  startLine: number;
};

export type ChunkPlan = {
  /** The whole bundle, including the plan comment. */
  bundle: string;
  /** Where the code ends and the plan comment starts. */
  codeLength: number;
  chunks: BundleChunk[];
  sourceUrl?: string;
};

const countNewlines = (text: string): number => {
  let count = 0;
  let index = text.indexOf('\n');

  while (index !== -1) {
    count++;
    index = text.indexOf('\n', index + 1);
  }

  return count;
};

/**
 * Appends a chunk plan to a bundle produced by Metro's `bundleToString`.
 * Chunks start on module boundaries, which `bundleToString` always places
 * at the start of a line.
 *
 * Returns the code unchanged when the bundle fits in one chunk, or when its
 * layout is not what `bundleToString` produces, so the runtime evaluates it
 * whole as before.
 */
export const appendChunkPlan = (
  code: string,
  bundle: {
    pre: string;
    modules: ReadonlyArray<readonly [number, string]>;
  },
  options: { sourceUrl?: string; targetBytes?: number } = {},
): string => {
  const targetBytes = options.targetBytes ?? DEFAULT_CHUNK_TARGET_BYTES;
  const chunks: Array<[number, number]> = [[0, 0]];
  // Mirrors bundleToString: `pre` and each non-empty module (sorted by id)
  // are followed by a newline.
  let offset = bundle.pre.length > 0 ? bundle.pre.length + 1 : 0;
  let line = bundle.pre.length > 0 ? countNewlines(bundle.pre) + 1 : 0;
  let chunkStart = 0;
  const modules = [...bundle.modules].sort((a, b) => a[0] - b[0]);

  for (const [, moduleCode] of modules) {
    if (moduleCode.length === 0) {
      continue;
    }

    if (!code.startsWith(moduleCode, offset)) {
      return code;
    }

    if (offset - chunkStart >= targetBytes) {
      chunks.push([offset, line]);
      chunkStart = offset;
    }

    offset += moduleCode.length + 1;
    line += countNewlines(moduleCode) + 1;
  }

  if (chunks.length === 1) {
    return code;
  }

  const plan: SerializedChunkPlan = { chunks, sourceUrl: options.sourceUrl };
  return code + CHUNK_PLAN_MARKER + JSON.stringify(plan);
};

const isValidPlan = (value: unknown, codeLength: number): value is SerializedChunkPlan => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const { chunks, sourceUrl } = value as Record<string, unknown>;

  if (sourceUrl !== undefined && typeof sourceUrl !== 'string') {
    return false;
  }

  if (!Array.isArray(chunks) || chunks.length === 0) {
    return false;
  }

  let previousOffset = -1;
  let previousLine = 0;

  for (const chunk of chunks) {
    if (
      !Array.isArray(chunk) ||
      !Number.isSafeInteger(chunk[0]) ||
      !Number.isSafeInteger(chunk[1]) ||
      chunk[0] <= previousOffset ||
      chunk[0] >= codeLength ||
      // Each chunk starts on a later line than the one before, at most one
      // line per character of the chunks before it.
      chunk[1] < previousLine ||
      chunk[1] > chunk[0]
    ) {
      return false;
    }

    previousOffset = chunk[0];
    previousLine = chunk[1];
  }

  return chunks[0][0] === 0 && chunks[0][1] === 0;
};

/**
 * Reads the chunk plan of a bundle, or returns `null` if it has none, in
 * which case the bundle should be evaluated whole.
 */
export const readChunkPlan = (bundle: string): ChunkPlan | null => {
  const markerAt = bundle.lastIndexOf(CHUNK_PLAN_MARKER);

  if (markerAt === -1) {
    return null;
  }

  let plan: unknown;

  try {
    plan = JSON.parse(bundle.slice(markerAt + CHUNK_PLAN_MARKER.length));
  } catch {
    return null;
  }

  if (!isValidPlan(plan, markerAt)) {
    return null;
  }

  return {
    bundle,
    codeLength: markerAt,
    sourceUrl: plan.sourceUrl,
    chunks: plan.chunks.map(([start, startLine], index) => ({
      start,
      end: plan.chunks[index + 1]?.[0] ?? markerAt,
      startLine,
    })),
  };
};

/**
 * Builds the source to `eval` for one chunk so that, to the JS engine, it
 * is the same file at the same position as in the whole bundle: leading
 * newlines restore its line numbers, and a `sourceURL` comment restores the
 * file name. Without both, stack traces could not be symbolicated against
 * the bundle's source map.
 */
export const getChunkSource = (plan: ChunkPlan, chunk: BundleChunk): string => {
  const source = plan.bundle.slice(chunk.start, chunk.end);
  const isLast = chunk.end === plan.codeLength;
  // The last chunk carries the bundle's own sourceURL comment.
  const sourceUrlComment =
    !isLast && plan.sourceUrl ? `\n//# sourceURL=${plan.sourceUrl}` : '';

  return '\n'.repeat(chunk.startLine) + source + sourceUrlComment;
};
