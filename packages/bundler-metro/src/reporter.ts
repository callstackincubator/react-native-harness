import { getEmitter, type EventEmitter } from '@react-native-harness/tools';
import type { ReportableEvent as MetroReportableEvent } from 'metro';
import type { ConfigT as MetroConfig } from 'metro-config';
import { NotReadOnly } from './utils.js';
import type { HarnessBundleRequestKind } from './request-kind.js';

export type ReportableEvent =
  | MetroReportableEvent
  | {
      type: 'initialize_done';
    }
  | {
      type: 'client_log';
      level: 'trace' | 'info' | 'warn' | 'log' | 'group' | 'groupCollapsed' | 'groupEnd' | 'debug' | 'error';
      data: unknown[];
    }
  | {
      type: 'bundle_request_observed';
      platform: string;
      requestKind: HarnessBundleRequestKind;
      timestamp: string;
      url: string;
    };

export type Reporter = EventEmitter<ReportableEvent>;

export const withReporter = (metroConfig: MetroConfig): Reporter => {
  const emitter = getEmitter<ReportableEvent>();

  (metroConfig.reporter as NotReadOnly<MetroConfig['reporter']>) = {
    update: (event: ReportableEvent) => {
      emitter.emit(event);
    },
  };

  return emitter;
};
