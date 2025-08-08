import {
  ConfigLoadError,
  ConfigNotFoundError,
  ConfigValidationError,
} from '@react-native-harness/config';
import { AssertionError } from '../utils.js';
import {
  NoRunnerSpecifiedError,
  RunnerNotFoundError,
  EnvironmentInitializationError,
  TestExecutionError,
  RpcClientError,
  AppNotInstalledError,
  BridgeTimeoutError,
} from './errors.js';

export const handleError = (error: unknown): void => {
  if (error instanceof AssertionError) {
    console.error(`\n❌ Assertion Error`);
    console.error(`\nError: ${error.message}`);
    console.error(`\nPlease check your configuration and try again.`);
  } else if (error instanceof ConfigValidationError) {
    console.error(`\n❌ Configuration Error`);
    console.error(`\nFile: ${error.filePath}`);
    console.error(`\nValidation errors:`);
    error.validationErrors.forEach((err) => {
      console.error(`  • ${err}`);
    });
    console.error(`\nPlease fix the configuration errors and try again.`);
  } else if (error instanceof ConfigNotFoundError) {
    console.error(`\n❌ Configuration Not Found`);
    console.error(
      `\nCould not find 'rn-harness.config' in '${error.searchPath}' or any parent directories.`
    );
    console.error(`\nSupported file extensions: .js, .mjs, .cjs, .json`);
    console.error(
      `\nPlease create a configuration file or run from a directory that contains one.`
    );
  } else if (error instanceof ConfigLoadError) {
    console.error(`\n❌ Configuration Load Error`);
    console.error(`\nFile: ${error.filePath}`);
    console.error(`Error: ${error.message}`);
    if (error.cause) {
      console.error(`\nCause: ${error.cause.message}`);
    }
    console.error(
      `\nPlease check your configuration file syntax and try again.`
    );
  } else if (error instanceof NoRunnerSpecifiedError) {
    console.error('\n❌ No runner specified');
    console.error(
      '\nPlease specify a runner name or set a defaultRunner in your config.'
    );
    console.error('\nUsage: react-native-harness test [runner-name] [pattern]');
    console.error('\nAvailable runners:');
    error.availableRunners.forEach((r) => {
      console.error(`  • ${r.name} (${r.platform})`);
    });
    console.error(
      '\nTo set a default runner, add "defaultRunner" to your config:'
    );
    console.error('  { "defaultRunner": "your-runner-name" }');
  } else if (error instanceof RunnerNotFoundError) {
    console.error(`\n❌ Runner "${error.runnerName}" not found`);
    console.error('\nAvailable runners:');
    error.availableRunners.forEach((r) => {
      console.error(`  • ${r.name} (${r.platform})`);
    });
    console.error('\nTo add a new runner, update your rn-harness.config file.');
  } else if (error instanceof EnvironmentInitializationError) {
    console.error(`\n❌ Environment Initialization Error`);
    console.error(`\nRunner: ${error.runnerName} (${error.platform})`);
    console.error(`\nError: ${error.message}`);
    if (error.details) {
      console.error(`\nDetails: ${error.details}`);
    }
    console.error(`\nTroubleshooting steps:`);
    console.error(
      `  • Verify that ${error.platform} development environment is properly set up`
    );
    console.error(`  • Check that the app is built and ready for testing`);
    console.error(`  • Ensure all required dependencies are installed`);
    if (error.platform === 'ios') {
      console.error(`  • Verify Xcode and iOS Simulator are working correctly`);
    } else if (error.platform === 'android') {
      console.error(
        `  • Verify Android SDK and emulator are working correctly`
      );
    }
    console.error(
      `\nPlease check your environment configuration and try again.`
    );
  } else if (error instanceof TestExecutionError) {
    console.error(`\n❌ Test Execution Error`);
    console.error(`\nFile: ${error.testFile}`);
    if (error.testSuite) {
      console.error(`\nSuite: ${error.testSuite}`);
    }
    if (error.testName) {
      console.error(`\nTest: ${error.testName}`);
    }
    console.error(`\nError: ${error.message}`);
    console.error(`\nTroubleshooting steps:`);
    console.error(`  • Check the test file syntax and logic`);
    console.error(`  • Verify all test dependencies are available`);
    console.error(`  • Ensure the app is in the expected state for the test`);
    console.error(
      `  • Check device/emulator logs for additional error details`
    );
    console.error(`\nPlease check your test file and try again.`);
  } else if (error instanceof RpcClientError) {
    console.error(`\n❌ RPC Client Error`);
    console.error(`\nError: ${error.message}`);
    if (error.bridgePort) {
      console.error(`\nBridge Port: ${error.bridgePort}`);
    }
    if (error.connectionStatus) {
      console.error(`\nConnection Status: ${error.connectionStatus}`);
    }
    console.error(`\nTroubleshooting steps:`);
    console.error(`  • Verify the React Native app is running and connected`);
    console.error(`  • Check that the bridge port is not blocked by firewall`);
    console.error(
      `  • Ensure the app has the React Native Harness runtime integrated`
    );
    console.error(`  • Try restarting the app and test harness`);
    console.error(`\nPlease check your bridge connection and try again.`);
  } else if (error instanceof AppNotInstalledError) {
    console.error(`\n❌ App Not Installed`);
    console.error(
      `\nThe app "${error.bundleId}" is not installed on ${
        error.platform === 'ios' ? 'simulator' : 'emulator'
      } "${error.deviceName}".`
    );
    console.error(`\nTo resolve this issue:`);
    if (error.platform === 'ios') {
      console.error(
        `  • Build and install the app: npx react-native run-ios --simulator="${error.deviceName}"`
      );
      console.error(
        `  • Or install from Xcode: Open ios/*.xcworkspace and run the project`
      );
    } else {
      console.error(
        `  • Build and install the app: npx react-native run-android`
      );
      console.error(
        `  • Or build manually: ./gradlew assembleDebug && adb install android/app/build/outputs/apk/debug/app-debug.apk`
      );
    }
    console.error(`\nPlease install the app and try running the tests again.`);
  } else if (error instanceof BridgeTimeoutError) {
    console.error(`\n❌ Bridge Connection Timeout`);
    console.error(
      `\nThe bridge connection timed out after ${error.timeout}ms while waiting for the "${error.runnerName}" (${error.platform}) runner to be ready.`
    );
    console.error(`\nThis usually indicates that:`);
    console.error(
      `  • The React Native app failed to load or connect to the bridge`
    );
    console.error(`  • The app crashed during startup`);
    console.error(
      `  • Network connectivity issues between the app and the test harness`
    );
    console.error(`  • The app is taking longer than expected to initialize`);
    console.error(`\nTo resolve this issue:`);
    console.error(
      `  • Check that the app is properly installed and can start normally`
    );
    console.error(
      `  • Verify that the app has the React Native Harness runtime integrated`
    );
    console.error(`  • Check device/emulator logs for any startup errors`);
    console.error(
      `  • Ensure the test harness bridge port (3001) is not blocked`
    );
    console.error(
      `\nIf the app needs more time to start, consider increasing the timeout in the configuration.`
    );
  } else {
    console.error(`\n❌ Unexpected Error`);
    console.error(error);
  }
};
