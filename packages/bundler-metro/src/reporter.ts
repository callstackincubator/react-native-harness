import { getEmitter, type EventEmitter } from '@react-native-harness/tools';
import type { ReportableEvent as MetroReportableEvent } from 'metro';
import type { ConfigT as MetroConfig } from 'metro-config';
import { NotReadOnly } from './utils.js';

export type ReportableEvent =
  | MetroReportableEvent
  | {
      type: 'initialize_done';
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
