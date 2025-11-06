import { getEmitter, type EventEmitter } from '@react-native-harness/tools';
import type {
  MetroConfig,
  ReportableEvent as MetroReportableEvent,
} from 'metro';

export type ReportableEvent =
  | MetroReportableEvent
  | {
      type: 'initialize_done';
    };

export type Reporter = EventEmitter<ReportableEvent>;

export const withReporter = (metroConfig: MetroConfig): Reporter => {
  const emitter = getEmitter<ReportableEvent>();

  metroConfig.reporter = {
    update: (event: ReportableEvent) => {
      emitter.emit(event);
    },
  };

  return emitter;
};
