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
  BundlingFailedError,
  MetroPortUnavailableError,
} from './errors.js';

export const formatError = (error: unknown): string => {
  const lines: string[] = [];

  if (error instanceof AssertionError) {
    lines.push(`\n❌ Assertion Error`);
    lines.push(`\nError: ${error.message}`);
    lines.push(`\nPlease check your configuration and try again.`);
  } else if (error instanceof ConfigValidationError) {
    lines.push(`\n❌ Configuration Error`);
    lines.push(`\nFile: ${error.filePath}`);
    lines.push(`\nValidation errors:`);
    error.validationErrors.forEach((err) => {
      lines.push(`  • ${err}`);
    });
    lines.push(`\nPlease fix the configuration errors and try again.`);
  } else if (error instanceof ConfigNotFoundError) {
    lines.push(`\n❌ Configuration Not Found`);
    lines.push(
      `\nCould not find 'rn-harness.config' in '${error.searchPath}' or any parent directories.`
    );
    lines.push(`\nSupported file extensions: .js, .mjs, .cjs, .json`);
    lines.push(
      `\nPlease create a configuration file or run from a directory that contains one.`
    );
  } else if (error instanceof ConfigLoadError) {
    lines.push(`\n❌ Configuration Load Error`);
    lines.push(`\nFile: ${error.filePath}`);
    lines.push(`Error: ${error.message}`);
    if (error.cause) {
      lines.push(`\nCause: ${error.cause.message}`);
    }
    lines.push(`\nPlease check your configuration file syntax and try again.`);
  } else if (error instanceof NoRunnerSpecifiedError) {
    lines.push('\n❌ No runner specified');
    lines.push(
      '\nPlease specify a runner name or set a defaultRunner in your config.'
    );
    lines.push('\nUsage: react-native-harness test [runner-name] [pattern]');
    lines.push('\nAvailable runners:');
    error.availableRunners.forEach((r) => {
      lines.push(`  • ${r.name} (${r.platform})`);
    });
    lines.push(
      '\nTo set a default runner, add "defaultRunner" to your config:'
    );
    lines.push('  { "defaultRunner": "your-runner-name" }');
  } else if (error instanceof RunnerNotFoundError) {
    lines.push(`\n❌ Runner "${error.runnerName}" not found`);
    lines.push('\nAvailable runners:');
    error.availableRunners.forEach((r) => {
      lines.push(`  • ${r.name} (${r.platform})`);
    });
    lines.push('\nTo add a new runner, update your rn-harness.config file.');
  } else if (error instanceof EnvironmentInitializationError) {
    lines.push(`\n❌ Environment Initialization Error`);
    lines.push(`\nRunner: ${error.runnerName} (${error.platform})`);
    lines.push(`\nError: ${error.message}`);
    if (error.details) {
      lines.push(`\nDetails: ${error.details}`);
    }
    lines.push(`\nTroubleshooting steps:`);
    lines.push(
      `  • Verify that ${error.platform} development environment is properly set up`
    );
    lines.push(`  • Check that the app is built and ready for testing`);
    lines.push(`  • Ensure all required dependencies are installed`);
    if (error.platform === 'ios') {
      lines.push(`  • Verify Xcode and iOS Simulator are working correctly`);
    } else if (error.platform === 'android') {
      lines.push(`  • Verify Android SDK and emulator are working correctly`);
    }
    lines.push(`\nPlease check your environment configuration and try again.`);
  } else if (error instanceof TestExecutionError) {
    lines.push(`\n❌ Test Execution Error`);
    lines.push(`\nFile: ${error.testFile}`);
    if (error.testSuite) {
      lines.push(`\nSuite: ${error.testSuite}`);
    }
    if (error.testName) {
      lines.push(`\nTest: ${error.testName}`);
    }
    lines.push(`\nError: ${error.message}`);
    lines.push(`\nTroubleshooting steps:`);
    lines.push(`  • Check the test file syntax and logic`);
    lines.push(`  • Verify all test dependencies are available`);
    lines.push(`  • Ensure the app is in the expected state for the test`);
    lines.push(`  • Check device/emulator logs for additional error details`);
    lines.push(`\nPlease check your test file and try again.`);
  } else if (error instanceof RpcClientError) {
    lines.push(`\n❌ RPC Client Error`);
    lines.push(`\nError: ${error.message}`);
    if (error.bridgePort) {
      lines.push(`\nBridge Port: ${error.bridgePort}`);
    }
    if (error.connectionStatus) {
      lines.push(`\nConnection Status: ${error.connectionStatus}`);
    }
    lines.push(`\nTroubleshooting steps:`);
    lines.push(`  • Verify the React Native app is running and connected`);
    lines.push(`  • Check that the bridge port is not blocked by firewall`);
    lines.push(
      `  • Ensure the app has the React Native Harness runtime integrated`
    );
    lines.push(`  • Try restarting the app and test harness`);
    lines.push(`\nPlease check your bridge connection and try again.`);
  } else if (error instanceof AppNotInstalledError) {
    lines.push(`\n❌ App Not Installed`);
    const deviceType =
      error.platform === 'ios'
        ? 'simulator'
        : error.platform === 'android'
        ? 'emulator'
        : 'virtual device';
    lines.push(
      `\nThe app "${error.bundleId}" is not installed on ${deviceType} "${error.deviceName}".`
    );
    lines.push(`\nTo resolve this issue:`);
    if (error.platform === 'ios') {
      lines.push(
        `  • Build and install the app: npx react-native run-ios --simulator="${error.deviceName}"`
      );
      lines.push(
        `  • Or install from Xcode: Open ios/*.xcworkspace and run the project`
      );
    } else if (error.platform === 'android') {
      lines.push(`  • Build and install the app: npx react-native run-android`);
      lines.push(
        `  • Or build manually: ./gradlew assembleDebug && adb install android/app/build/outputs/apk/debug/app-debug.apk`
      );
    } else if (error.platform === 'vega') {
      lines.push(`  • Build the Vega app: npm run build:app`);
      lines.push(
        `  • Install the app: kepler device install-app -p <path-to-vpkg> --device "${error.deviceName}"`
      );
      lines.push(
        `  • Or use the combined command: kepler run-kepler <path-to-vpkg> "${error.bundleId}" -d "${error.deviceName}"`
      );
    }
    lines.push(`\nPlease install the app and try running the tests again.`);
  } else if (error instanceof BundlingFailedError) {
    lines.push(`\n❌ Test File Bundling Error`);
    lines.push(`\nFile: ${error.modulePath}`);
    lines.push(`\nError: ${error.reason}`);
    lines.push(`\nTroubleshooting steps:`);
    lines.push(`  • Check the test file syntax and imports`);
    lines.push(`  • Verify all imported modules exist and are accessible`);
    lines.push(`  • Ensure the Metro bundler configuration is correct`);
    lines.push(`  • Check for any circular dependencies in the test file`);
    lines.push(`  • Verify that all required packages are installed`);
    lines.push(`\nPlease fix the bundling issues and try again.`);
  } else if (error instanceof BridgeTimeoutError) {
    lines.push(`\n❌ Bridge Connection Timeout`);
    lines.push(
      `\nThe bridge connection timed out after ${error.timeout}ms while waiting for the "${error.runnerName}" (${error.platform}) runner to be ready.`
    );
    lines.push(`\nThis usually indicates that:`);
    lines.push(
      `  • The React Native app failed to load or connect to the bridge`
    );
    lines.push(`  • The app crashed during startup`);
    lines.push(
      `  • Network connectivity issues between the app and the test harness`
    );
    lines.push(`  • The app is taking longer than expected to initialize`);
    lines.push(`\nTo resolve this issue:`);
    lines.push(
      `  • Check that the app is properly installed and can start normally`
    );
    lines.push(
      `  • Verify that the app has the React Native Harness runtime integrated`
    );
    lines.push(`  • Check device/emulator logs for any startup errors`);
    lines.push(`  • Ensure the test harness bridge port (3001) is not blocked`);
    lines.push(
      `\nIf the app needs more time to start, consider increasing the timeout in the configuration.`
    );
  } else if (error instanceof MetroPortUnavailableError) {
    lines.push(`\n❌ Metro Port Unavailable`);
    lines.push(`\nPort ${error.port} is already in use or unavailable.`);
    lines.push(`\nThis usually indicates that:`);
    lines.push(`  • Another Metro bundler instance is already running`);
    lines.push(`  • Another application is using port ${error.port}`);
    lines.push(`  • The port is blocked by a firewall or security software`);
    lines.push(`\nTo resolve this issue:`);
    lines.push(`  • Stop any running Metro bundler instances`);
    lines.push(
      `  • Check for other applications using port ${error.port}: lsof -i :${error.port}`
    );
    lines.push(`  • Kill the process using the port: kill -9 <PID>`);
    lines.push(
      `  • Or use a different port by updating your Metro configuration`
    );
    lines.push(`\nPlease free up the port and try again.`);
  } else {
    // Re-throw the error to be handled by the caller
    throw error;
  }

  return lines.join('');
};
