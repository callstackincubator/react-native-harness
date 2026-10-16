import { SubprocessError, type DiagnosticAttrs } from '@react-native-harness/tools';
import { parseBootStatus, type BootStatusSummary } from './simctl.js';

/**
 * Describes simctl results and failures as span attrs. Handed to
 * `instrumented()` so the simctl module itself stays free of diagnostics code.
 */
const toBootAttrs = (summary: BootStatusSummary): DiagnosticAttrs => ({
  bootLastStatus: summary.lastStatusLine ?? undefined,
  bootElapsedSeconds: summary.elapsedSeconds ?? undefined,
});

export const simctlResultAttrs = (
  method: string,
  result: unknown,
): DiagnosticAttrs | undefined =>
  method === 'waitForBoot' ? toBootAttrs(result as BootStatusSummary) : undefined;

/**
 * A boot that never finishes (timeout, abort) is the interesting case: the
 * output captured up to that point still says which stage it was stuck on.
 */
export const simctlErrorAttrs = (
  method: string,
  error: unknown,
): DiagnosticAttrs | undefined =>
  method === 'waitForBoot' && error instanceof SubprocessError
    ? toBootAttrs(parseBootStatus(error.stdout))
    : undefined;
