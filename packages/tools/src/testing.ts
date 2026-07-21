import { createFsFromVolume, Volume } from 'memfs';
import type { FileSystem } from './harness-context.js';

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
