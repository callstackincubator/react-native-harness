import type { BundlerEvent } from '@react-native-harness/bundlers';
import type { ReportableEvent } from './reporter.js';

/**
 * Translates Metro's reporter events into the bundler-neutral ones. Events
 * Harness does not consume are dropped.
 */
export const toBundlerEvent = (event: ReportableEvent): BundlerEvent | null => {
  switch (event.type) {
    case 'bundle_build_started':
      return {
        type: 'build_started',
        buildId: event.buildID,
        platform: event.bundleDetails.platform,
        entryFile: event.bundleDetails.entryFile,
        dev: event.bundleDetails.dev,
      };
    case 'bundle_build_done':
      return { type: 'build_done', buildId: event.buildID };
    case 'bundle_build_failed':
      return { type: 'build_failed', buildId: event.buildID };
    case 'bundle_request_observed':
      return {
        type: 'entry_requested',
        platform: event.platform,
        requestKind: event.requestKind,
      };
    case 'client_log':
      return { type: 'client_log', level: event.level, data: event.data };
    default:
      return null;
  }
};
