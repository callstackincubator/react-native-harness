export default {
  runner: '@react-native-harness/jest',
  // Tests run serially on the device, so Jest only uses its workers to build
  // the haste map. On a cold cache or after any file change that starts a pool
  // of `availableParallelism() - 1` processes, which roughly doubles Jest's
  // CPU time without making the run faster.
  maxWorkers: 1,
  // Build and cache output never contains tests, but it can hold tens of
  // thousands of files. Jest checks these patterns before descending into a
  // directory, so its crawl skips them entirely. Jest appends a project's own
  // patterns to the preset's.
  modulePathIgnorePatterns: [
    '/\\.harness(/|$)',
    '/ios/(Pods|build)(/|$)',
    '/android/(build|\\.gradle|app/build|app/\\.cxx)(/|$)',
  ],
  // With the build output skipped, Jest's own crawl is cheaper than querying
  // watchman, which costs two CLI process spawns per run and still lists every
  // file. Metro keeps using watchman.
  watchman: false,
};
