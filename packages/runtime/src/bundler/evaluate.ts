import { MalformedModuleError } from './errors.js';
import type { ModuleId } from '../mocker/types.js';
import { getChunkSource, readChunkPlan } from '../bundle-format/chunk-plan.js';
import { flushOutgoingMessages, yieldToEventLoop } from '../utils/yield.js';

// Metro emits `__r(123)` by default; custom module id factories (Vega
// system bundles, for example) emit quoted string ids such as `__r("1a27")`.
const REQUIRE_CALL_PATTERN = /__r\((\d+|"[^"]*"|'[^']*')\)/g;

const parseModuleId = (raw: string): ModuleId =>
  raw.startsWith('"') || raw.startsWith("'") ? raw.slice(1, -1) : Number(raw);

const findEntryModuleId = (moduleJs: string, modulePath: string): ModuleId => {
  const __rMatches = Array.from(moduleJs.matchAll(REQUIRE_CALL_PATTERN));

  if (__rMatches.length === 0) {
    throw new MalformedModuleError(modulePath, 'No __r function found');
  }

  // Get the last match as there may be many require calls
  const __rMatch = __rMatches[__rMatches.length - 1];
  const __rParam = __rMatch[1];

  if (!__rParam) {
    throw new MalformedModuleError(modulePath, 'No __r parameter found');
  }

  return parseModuleId(__rParam);
};

export const evaluateModule = async (
  moduleJs: string,
  modulePath: string,
): Promise<void> => {
  const plan = readChunkPlan(moduleJs);
  const lastChunk = plan?.chunks[plan.chunks.length - 1];
  // The entry module is required at the end of the bundle, in the last chunk.
  const moduleId = findEntryModuleId(
    plan && lastChunk
      ? moduleJs.slice(lastChunk.start, plan.codeLength)
      : moduleJs,
    modulePath,
  );

  // This is important as if module was already initialized, it would not be re-initialized
  global.__resetModule(moduleId);

  // Let events emitted so far reach the harness before evaluation can block.
  await flushOutgoingMessages();

  if (!plan) {
    // eslint-disable-next-line no-eval
    eval(moduleJs);
    return;
  }

  // Parsing a large bundle in one `eval` blocks the JS thread long enough
  // for the harness to consider it unresponsive. Chunks are evaluated in
  // separate tasks so the thread answers the harness in between; the last
  // chunk runs the entry module.
  for (const [index, chunk] of plan.chunks.entries()) {
    if (index > 0) {
      await yieldToEventLoop();
    }

    // eslint-disable-next-line no-eval
    eval(getChunkSource(plan, chunk));
  }
};
