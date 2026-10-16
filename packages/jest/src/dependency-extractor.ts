// Jest reads and parses every file in the project to build a dependency graph
// for `--watch`, `--onlyChanged` and `--findRelatedTests`. Harness only reruns
// test files that change themselves (native changes need an app rebuild
// anyway), so the graph is never needed and extraction is skipped.
export const extract = (): Set<string> => new Set();

export const getCacheKey = (): string => 'react-native-harness-no-dependencies';
