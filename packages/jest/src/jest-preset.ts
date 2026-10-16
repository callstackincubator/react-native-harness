export default {
  runner: '@react-native-harness/jest',
  // Tests run serially on the device, so Jest only uses its workers to build
  // the haste map. On a cold cache or after any file change that starts a pool
  // of `availableParallelism() - 1` processes, which roughly doubles Jest's
  // CPU time without making the run faster.
  maxWorkers: 1,
  // Harness doesn't depend on watchman; Jest and Metro crawl with Node instead.
  watchman: false,
};
