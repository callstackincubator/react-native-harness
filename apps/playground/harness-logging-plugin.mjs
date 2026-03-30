const logWithDetails = (hookName, getDetails) => {
  return (ctx) => {
    const details = getDetails?.(ctx);
    const suffix = details ? ` ${details}` : '';
    ctx.logger.info(`${hookName}${suffix}`);
  };
};

export const harnessLoggingPlugin = () => ({
  name: 'playground-logging',
  hooks: {
    harness: {
      beforeCreation: logWithDetails(
        'harness.beforeCreation',
        (ctx) => `runner=${ctx.runner.name}`
      ),
      beforeDispose: logWithDetails(
        'harness.beforeDispose',
        (ctx) => `reason=${ctx.reason ?? 'normal'}`
      ),
    },
    run: {
      started: logWithDetails(
        'run.started',
        (ctx) => `runId=${ctx.runId} files=${ctx.testFiles.length}`
      ),
      finished: logWithDetails(
        'run.finished',
        (ctx) =>
          `runId=${ctx.runId} status=${ctx.status} duration=${ctx.duration}ms`
      ),
    },
    runtime: {
      ready: logWithDetails(
        'runtime.ready',
        (ctx) => `runId=${ctx.runId} device=${ctx.device.platform}`
      ),
      disconnected: logWithDetails(
        'runtime.disconnected',
        (ctx) => `runId=${ctx.runId} reason=${ctx.reason ?? 'unknown'}`
      ),
    },
    metro: {
      initialized: logWithDetails(
        'metro.initialized',
        (ctx) => `runId=${ctx.runId} port=${ctx.port}`
      ),
      bundleStarted: logWithDetails(
        'metro.bundleStarted',
        (ctx) => `runId=${ctx.runId} target=${ctx.target} file=${ctx.file}`
      ),
      bundleFinished: logWithDetails(
        'metro.bundleFinished',
        (ctx) =>
          `runId=${ctx.runId} target=${ctx.target} file=${ctx.file} duration=${ctx.duration}ms`
      ),
      bundleFailed: logWithDetails(
        'metro.bundleFailed',
        (ctx) =>
          `runId=${ctx.runId} target=${ctx.target} file=${ctx.file} error=${ctx.error}`
      ),
      clientLog: logWithDetails(
        'metro.clientLog',
        (ctx) => `runId=${ctx.runId} level=${ctx.level}`
      ),
    },
    app: {
      started: logWithDetails(
        'app.started',
        (ctx) => `runId=${ctx.runId} testFile=${ctx.testFile ?? 'n/a'}`
      ),
      exited: logWithDetails(
        'app.exited',
        (ctx) => `runId=${ctx.runId} testFile=${ctx.testFile ?? 'n/a'}`
      ),
      possibleCrash: logWithDetails(
        'app.possibleCrash',
        (ctx) => `runId=${ctx.runId} testFile=${ctx.testFile ?? 'n/a'}`
      ),
    },
    collection: {
      started: logWithDetails(
        'collection.started',
        (ctx) => `runId=${ctx.runId} file=${ctx.file}`
      ),
      finished: logWithDetails(
        'collection.finished',
        (ctx) =>
          `runId=${ctx.runId} file=${ctx.file} totalTests=${ctx.totalTests}`
      ),
    },
    testFile: {
      started: logWithDetails(
        'testFile.started',
        (ctx) => `runId=${ctx.runId} file=${ctx.file}`
      ),
      finished: logWithDetails(
        'testFile.finished',
        (ctx) =>
          `runId=${ctx.runId} file=${ctx.file} status=${ctx.status} duration=${ctx.duration}ms`
      ),
    },
    suite: {
      started: logWithDetails(
        'suite.started',
        (ctx) => `runId=${ctx.runId} suite=${ctx.name}`
      ),
      finished: logWithDetails(
        'suite.finished',
        (ctx) =>
          `runId=${ctx.runId} suite=${ctx.name} status=${ctx.status} duration=${ctx.duration}ms`
      ),
    },
    test: {
      started: logWithDetails(
        'test.started',
        (ctx) => `runId=${ctx.runId} suite=${ctx.suite} test=${ctx.name}`
      ),
      finished: logWithDetails(
        'test.finished',
        (ctx) =>
          `runId=${ctx.runId} suite=${ctx.suite} test=${ctx.name} status=${ctx.status} duration=${ctx.duration}ms`
      ),
    },
  },
});
