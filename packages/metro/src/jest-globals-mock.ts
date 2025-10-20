// Mock module for @jest/globals imports
// This module throws immediately when imported to warn users about using Jest APIs

throw new Error(
  "Importing '@jest/globals' is not supported in Harness tests. Import from 'react-native-harness' instead."
);
