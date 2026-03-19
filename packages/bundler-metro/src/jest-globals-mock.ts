// Mock module for @jest/globals imports
// This module throws immediately to explain the supported import path.

throw new Error(
  "Importing '@jest/globals' is not supported in Harness tests. Import from 'react-native-harness' instead."
);
