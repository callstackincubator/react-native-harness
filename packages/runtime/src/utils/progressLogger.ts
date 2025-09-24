import type {
  TestRunnerEvents,
  TestCollectorEvents,
} from '@react-native-harness/bridge';
import type { EventEmitter } from './emitter.js';

/**
 * Attaches console logging to runtime events to provide progress information.
 * This function handles all test run lifecycle events including start, progress, and completion.
 */
export const attachProgressLogger = (
  events: EventEmitter<TestRunnerEvents | TestCollectorEvents>,
  testPath: string
): void => {
  // Log test run start
  console.log(`🎯 Starting test run for: ${testPath}`);

  // Handle all runtime events
  events.addListener((event) => {
    switch (event.type) {
      case 'collection-started':
        console.log(`📄 Collecting tests from: ${event.file}`);
        break;
      case 'collection-finished':
        console.log(`✅ Test collection completed in ${event.duration}ms`);
        break;
      case 'file-started':
        console.log(`🚀 Running tests in: ${event.file}`);
        break;
      case 'file-finished':
        console.log(`📋 File completed in ${event.duration}ms: ${event.file}`);
        break;
      case 'suite-started':
        console.log(`📦 Suite started: ${event.name}`);
        break;
      case 'suite-finished':
        const suiteStatus =
          event.status === 'passed'
            ? '✅'
            : event.status === 'failed'
            ? '❌'
            : '⏭️';
        console.log(
          `${suiteStatus} Suite "${event.name}" ${event.status} (${event.duration}ms)`
        );
        if (event.error) {
          console.log(`   Error: ${event.error.message}`);
        }
        break;
      case 'test-started':
        console.log(`  🧪 Running: ${event.name}`);
        break;
      case 'test-finished':
        const testStatus =
          event.status === 'passed'
            ? '✅'
            : event.status === 'failed'
            ? '❌'
            : event.status === 'skipped'
            ? '⏭️'
            : '📝';
        console.log(`  ${testStatus} ${event.name} (${event.duration}ms)`);
        if (event.error) {
          console.log(`     Error: ${event.error.message}`);
          if (event.error.codeFrame) {
            console.log(`     Code frame: ${event.error.codeFrame.content}`);
          }
        }
        break;
      default:
        console.log(`🔔 Event: ${(event as any).type}`, event);
        break;
    }
  });

  // Add completion and error logging through a wrapper
  const originalEmit = events.emit;
  let isCompleted = false;

  events.emit = (event) => {
    const result = originalEmit.call(events, event);

    // Check if this is the last event to log completion
    if (!isCompleted && event.type === 'file-finished') {
      console.log(`🏁 Test run completed for: ${testPath}`);
      isCompleted = true;
    }

    return result;
  };
};
