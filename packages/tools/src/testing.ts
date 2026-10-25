import { createFsFromVolume, Volume } from 'memfs';
import type { ChildProcess } from 'node:child_process';
import type { Result, Subprocess } from 'nano-spawn';
import { SubprocessError } from 'nano-spawn';
import type { FileSystem, ProcessManager } from './harness-context.js';
import type { SpawnOptions } from './process-manager.js';

export const createInMemoryFileSystem = (): FileSystem => {
  const fs = createFsFromVolume(new Volume());

  return {
    appendFileSync: fs.appendFileSync.bind(fs),
    copyFileSync: fs.copyFileSync.bind(fs),
    createWriteStream: fs.createWriteStream.bind(fs),
    existsSync: fs.existsSync.bind(fs),
    mkdirSync: fs.mkdirSync.bind(fs),
    mkdtempSync: fs.mkdtempSync.bind(fs),
    readFileSync: fs.readFileSync.bind(fs),
    readdirSync: fs.readdirSync.bind(fs),
    realpathSync: fs.realpathSync.bind(fs),
    renameSync: fs.renameSync.bind(fs),
    rmSync: fs.rmSync.bind(fs),
    statSync: fs.statSync.bind(fs),
    unlinkSync: fs.unlinkSync.bind(fs),
    utimesSync: fs.utimesSync.bind(fs),
    writeFileSync: fs.writeFileSync.bind(fs),
    access: fs.promises.access.bind(fs.promises),
    cp: fs.promises.cp.bind(fs.promises),
    mkdir: fs.promises.mkdir.bind(fs.promises),
    mkdtemp: fs.promises.mkdtemp.bind(fs.promises),
    readFile: fs.promises.readFile.bind(fs.promises),
    readdir: fs.promises.readdir.bind(fs.promises),
    rename: fs.promises.rename.bind(fs.promises),
    rm: fs.promises.rm.bind(fs.promises),
    stat: fs.promises.stat.bind(fs.promises),
    writeFile: fs.promises.writeFile.bind(fs.promises),
  } as unknown as FileSystem;
};

export type FakeProcessResponse = {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
};

export type FakeProcessCall = {
  file: string;
  args: readonly string[];
  options: SpawnOptions | undefined;
};

type ArgsMatcher =
  | readonly string[]
  | ((args: readonly string[], call: FakeProcessCall) => boolean);

type FakeProcessHandler =
  | FakeProcessResponse
  | ((
      call: FakeProcessCall
    ) => FakeProcessResponse | Promise<FakeProcessResponse>);

export type FakeProcessManager = ProcessManager & {
  /** Every spawn request, in order, including unmatched ones. */
  calls: FakeProcessCall[];
  /**
   * Registers a canned response for `file` with exactly `args` (or args
   * accepted by the predicate). Later registrations win; `once` handlers are
   * consumed after their first match.
   */
  on(
    file: string,
    args: ArgsMatcher,
    handler: FakeProcessHandler,
    options?: { once?: boolean }
  ): FakeProcessManager;
};

const splitLines = (text: string): string[] =>
  text === '' ? [] : text.replace(/\r?\n$/, '').split(/\r?\n/);

/**
 * Argv-programmable fake process manager for tests. Responses are canned: the
 * fake does not honor `signal`, `timeout` or other spawn options, and errors
 * are not enriched with output tails like the real manager's.
 */
export const createFakeProcessManager = (): FakeProcessManager => {
  const calls: FakeProcessCall[] = [];
  const handlers: {
    file: string;
    args: ArgsMatcher;
    handler: FakeProcessHandler;
    once: boolean;
  }[] = [];

  const matches = (
    entry: (typeof handlers)[number],
    call: FakeProcessCall
  ): boolean =>
    entry.file === call.file &&
    (typeof entry.args === 'function'
      ? entry.args(call.args, call)
      : entry.args.length === call.args.length &&
        entry.args.every((arg, index) => arg === call.args[index]));

  const run = async (call: FakeProcessCall): Promise<Result> => {
    const command = [call.file, ...call.args].join(' ');
    let index = -1;
    for (let i = handlers.length - 1; i >= 0; i--) {
      if (matches(handlers[i], call)) {
        index = i;
        break;
      }
    }
    if (index === -1) {
      throw new Error(
        `FakeProcessManager: no handler registered for command: ${command}`
      );
    }
    const entry = handlers[index];
    if (entry.once) {
      handlers.splice(index, 1);
    }
    const response =
      typeof entry.handler === 'function'
        ? await entry.handler(call)
        : entry.handler;
    const stdout = response.stdout ?? '';
    const stderr = response.stderr ?? '';
    const result: Result = {
      stdout,
      stderr,
      output: [stdout, stderr].filter((part) => part !== '').join('\n'),
      command,
      durationMs: 0,
    };
    if (response.exitCode !== undefined && response.exitCode !== 0) {
      throw Object.assign(
        new SubprocessError(
          `Command failed with exit code ${response.exitCode}: ${command}`
        ),
        result,
        { exitCode: response.exitCode }
      );
    }
    return result;
  };

  const manager: FakeProcessManager = {
    calls,
    on(file, args, handler, options) {
      handlers.push({ file, args, handler, once: options?.once ?? false });
      return manager;
    },
    spawn(file, args, options) {
      const call: FakeProcessCall = { file, args: args ?? [], options };
      calls.push(call);
      const promise = run(call);
      // Avoid unhandled-rejection noise when callers only iterate.
      promise.catch(() => undefined);
      const lines = (pick: 'stdout' | 'stderr' | 'both') => ({
        async *[Symbol.asyncIterator]() {
          let result: Result;
          try {
            result = await promise;
          } catch (error) {
            result = error as Result;
          }
          if (pick !== 'stderr') yield* splitLines(result.stdout ?? '');
          if (pick !== 'stdout') yield* splitLines(result.stderr ?? '');
          if (!(result instanceof Error)) return;
          throw result;
        },
      });
      const nodeChildProcess = Promise.resolve({
        pid: undefined,
        kill: () => true,
        killed: false,
      } as unknown as ChildProcess);
      const subprocess = Object.assign(promise, {
        nodeChildProcess,
        stdout: lines('stdout'),
        stderr: lines('stderr'),
        [Symbol.asyncIterator]: lines('both')[Symbol.asyncIterator],
        pipe: () => {
          throw new Error('FakeProcessManager: pipe() is not supported');
        },
      });
      return subprocess as unknown as Subprocess;
    },
  };
  return manager;
};
