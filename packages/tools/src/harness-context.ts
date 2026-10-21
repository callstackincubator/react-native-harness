import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import {
  createNodeProcessManager,
  type ProcessManager,
} from './process-manager.js';

export type { ProcessManager };

export type FileSystem = Pick<
  typeof fs,
  | 'appendFileSync'
  | 'copyFileSync'
  | 'createWriteStream'
  | 'existsSync'
  | 'mkdirSync'
  | 'mkdtempSync'
  | 'readFileSync'
  | 'readdirSync'
  | 'realpathSync'
  | 'renameSync'
  | 'rmSync'
  | 'statSync'
  | 'unlinkSync'
  | 'utimesSync'
  | 'writeFileSync'
> &
  Pick<
    typeof fsPromises,
    | 'access'
    | 'cp'
    | 'mkdir'
    | 'mkdtemp'
    | 'readFile'
    | 'readdir'
    | 'rename'
    | 'rm'
    | 'stat'
    | 'writeFile'
  >;

export type HarnessContext = {
  fs: FileSystem;
  process: ProcessManager;
};

const realFileSystem: FileSystem = {
  appendFileSync: fs.appendFileSync,
  copyFileSync: fs.copyFileSync,
  createWriteStream: fs.createWriteStream,
  existsSync: fs.existsSync,
  mkdirSync: fs.mkdirSync,
  mkdtempSync: fs.mkdtempSync,
  readFileSync: fs.readFileSync,
  readdirSync: fs.readdirSync,
  realpathSync: fs.realpathSync,
  renameSync: fs.renameSync,
  rmSync: fs.rmSync,
  statSync: fs.statSync,
  unlinkSync: fs.unlinkSync,
  utimesSync: fs.utimesSync,
  writeFileSync: fs.writeFileSync,
  access: fsPromises.access,
  cp: fsPromises.cp,
  mkdir: fsPromises.mkdir,
  mkdtemp: fsPromises.mkdtemp,
  readFile: fsPromises.readFile,
  readdir: fsPromises.readdir,
  rename: fsPromises.rename,
  rm: fsPromises.rm,
  stat: fsPromises.stat,
  writeFile: fsPromises.writeFile,
};

const defaultHarnessContext: HarnessContext = {
  fs: realFileSystem,
  process: createNodeProcessManager(),
};
const storage = new AsyncLocalStorage<HarnessContext>();

/**
 * Runs `fn` with the given context fields. Fields that are not provided are
 * inherited from the context currently in effect (or the real defaults).
 */
export const runWithHarnessContext = <T>(
  context: Partial<HarnessContext>,
  fn: () => T
): T => storage.run({ ...getHarnessContext(), ...context }, fn);

export const getHarnessContext = (): HarnessContext =>
  storage.getStore() ?? defaultHarnessContext;

export const getFs = (): FileSystem => getHarnessContext().fs;

export const getProcessManager = (): ProcessManager =>
  getHarnessContext().process;
